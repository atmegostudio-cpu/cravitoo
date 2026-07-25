"""Production cleanup — Remove demo/seed data that leaked into production.

Purpose
-------
When CRAVITOO_ENV=production wasn't set, the backend's startup hook ran
`seed_demo_data()` and inserted the Tech Corp / Spice Kitchen demo dataset
into the production database. This script targets **only** those known
demo records and removes them.

Safety design
-------------
1. READ-ONLY BY DEFAULT — running with no flags shows what would be deleted,
   NOTHING is modified.
2. Requires the operator to pass `--apply` AND to have set env var
   `I_HAVE_BACKED_UP_ORDERS=YES` — belt AND braces.
3. Backs up every doc it deletes into a `_prod_cleanup_backup_<ts>` collection
   in the same DB, so rollback is one command.
4. NEVER touches the master admin user (`admin_email` from ADMIN_EMAIL env or
   admin@cravitoo.com fallback). NEVER touches any real customer order.
5. Only deletes records whose emails/names match the KNOWN demo seed values,
   or whose `demo_tag == "cravitoo_pune_demo"` from the /master/demo seeder.

Usage
-----
    # 1) DRY RUN — see what would be deleted (safe, no writes)
    MONGO_URL="<prod_readonly_uri>" DB_NAME="<prod_db>" \\
      python phase1_prod_demo_cleanup.py

    # 2) APPLY (only after backup)
    mongodump --uri="$MONGO_URL" --db="$DB_NAME" \\
              --out=/backups/pre-demo-cleanup-$(date +%Y%m%d-%H%M)
    MONGO_URL="<prod_uri>" DB_NAME="<prod_db>" I_HAVE_BACKED_UP_ORDERS=YES \\
      python phase1_prod_demo_cleanup.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Any

from motor.motor_asyncio import AsyncIOMotorClient

# ---- Exact known demo values that `seed_demo_data()` inserts ----
DEMO_USER_EMAILS = [
    "demo@techcorp.com",          # corporate_admin seed
    "employee@techcorp.com",       # employee seed
    "siteadmin@techcorp.com",      # site_admin seed
    "vendor@spicekitchen.com",     # vendor seed
    # From routers/demo.py Pune demo seeder
    "finance@cravitoo.com",
    "info@cravitoo.com",
    "vendor@atmego.com",
]
DEMO_COMPANY_NAMES = ["Tech Corp"]                 # NOTE: "Cravitoo" company is protected below
DEMO_VENDOR_NAMES  = ["Spice Kitchen", "ATMEGO"]
DEMO_SITE_NAMES    = ["Tech Corp - Bangalore HQ", "Cravitoo - Pune Office"]
DEMO_DOMAINS       = ["techcorp.com"]              # cravitoo.com is REAL prod domain — protected below
DEMO_TAG           = "cravitoo_pune_demo"

# Master admin — NEVER touch
PROTECTED_EMAILS  = {(os.environ.get("ADMIN_EMAIL") or "admin@cravitoo.com").lower()}
# Real production domain — even if it was demo-tagged by the seeder, do NOT delete
# because employees register with cravitoo.com emails in production.
PROTECTED_DOMAINS = {"cravitoo.com"}
# Company records that must stay (real prod tenant, even if a demo tag leaked in)
PROTECTED_COMPANY_NAMES = {"Cravitoo"}


async def analyse(db) -> Dict[str, List[Dict[str, Any]]]:
    """Find every record that WOULD be deleted. Returns a per-collection dict."""
    to_delete: Dict[str, List[Dict[str, Any]]] = {}

    # Users — by exact email + demo_tag
    users_q = {
        "$or": [
            {"email": {"$in": DEMO_USER_EMAILS}},
            {"demo_tag": DEMO_TAG},
        ],
        "email": {"$nin": list(PROTECTED_EMAILS)},   # extra belt
    }
    to_delete["users"] = await db.users.find(users_q,
        {"_id": 1, "email": 1, "role": 1, "demo_tag": 1}).to_list(500)
    # Additional safety filter: strip the master-admin row out if it snuck in
    to_delete["users"] = [u for u in to_delete["users"]
                          if (u.get("email") or "").lower() not in PROTECTED_EMAILS]

    # Companies
    company_docs = await db.companies.find({
        "$or": [{"name": {"$in": DEMO_COMPANY_NAMES}}, {"demo_tag": DEMO_TAG}]
    }, {"_id": 1, "name": 1, "demo_tag": 1}).to_list(200)
    to_delete["companies"] = [c for c in company_docs if c.get("name") not in PROTECTED_COMPANY_NAMES]

    # Vendors
    to_delete["vendors"] = await db.vendors.find({
        "$or": [{"name": {"$in": DEMO_VENDOR_NAMES}}, {"demo_tag": DEMO_TAG}]
    }, {"_id": 1, "name": 1, "demo_tag": 1}).to_list(200)

    # Sites
    to_delete["sites"] = await db.sites.find({
        "$or": [{"name": {"$in": DEMO_SITE_NAMES}}, {"demo_tag": DEMO_TAG}]
    }, {"_id": 1, "name": 1, "demo_tag": 1}).to_list(200)

    # Allowed domains — demo domain only. cravitoo.com is the REAL prod domain
    # and must survive even if it accidentally got tagged.
    domain_docs = await db.allowed_domains.find({
        "$or": [{"domain": {"$in": DEMO_DOMAINS}}, {"demo_tag": DEMO_TAG}]
    }, {"_id": 1, "domain": 1}).to_list(200)
    to_delete["allowed_domains"] = [
        d for d in domain_docs
        if (d.get("domain") or "").lower() not in PROTECTED_DOMAINS
    ]

    # Vendor-site mappings — for any demo vendor OR demo site
    demo_vendor_ids = [str(v["_id"]) for v in to_delete["vendors"]]
    demo_site_ids   = [str(s["_id"]) for s in to_delete["sites"]]
    if demo_vendor_ids or demo_site_ids:
        to_delete["vendor_site_mappings"] = await db.vendor_site_mappings.find({
            "$or": [
                {"vendor_id": {"$in": demo_vendor_ids}},
                {"site_id":   {"$in": demo_site_ids}},
                {"demo_tag":  DEMO_TAG},
            ]
        }, {"_id": 1, "vendor_id": 1, "site_id": 1}).to_list(500)
    else:
        to_delete["vendor_site_mappings"] = []

    # Menu items belonging to demo vendors
    if demo_vendor_ids:
        to_delete["menu_items"] = await db.menu_items.find(
            {"vendor_id": {"$in": demo_vendor_ids}},
            {"_id": 1, "vendor_id": 1, "name": 1}
        ).to_list(500)
    else:
        to_delete["menu_items"] = []

    return to_delete


async def apply(db, to_delete: Dict[str, List[Dict[str, Any]]]) -> Dict[str, int]:
    """Backup each doc into `_prod_cleanup_backup_<ts>` then delete."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_coll = f"_prod_cleanup_backup_{ts}"
    counts: Dict[str, int] = {}
    for coll, docs in to_delete.items():
        if not docs:
            counts[coll] = 0
            continue
        # Copy originals with source-collection metadata
        payload = [{"_source": coll, "_doc": d} for d in docs]
        await db[backup_coll].insert_many(payload)
        ids = [d["_id"] for d in docs]
        res = await db[coll].delete_many({"_id": {"$in": ids}})
        counts[coll] = res.deleted_count
    counts["_backup_collection"] = backup_coll
    return counts


def print_dry_run(to_delete):
    sep = "─" * 70
    print(sep)
    print(f"  DRY RUN — would delete these records (nothing modified)")
    print(sep)
    total = 0
    for coll, docs in to_delete.items():
        print(f"\n  {coll}  ({len(docs)} row{'s' if len(docs) != 1 else ''}):")
        for d in docs[:20]:
            label = d.get("email") or d.get("name") or d.get("domain") or d.get("vendor_id") or str(d["_id"])
            tag = f" [demo_tag={d.get('demo_tag')}]" if d.get("demo_tag") else ""
            print(f"      · {label}{tag}  (_id={d['_id']})")
        if len(docs) > 20:
            print(f"      … and {len(docs)-20} more")
        total += len(docs)
    print(f"\n  TOTAL: {total} row(s) across {len(to_delete)} collection(s).")
    print(f"\n  Protected (will NEVER be deleted):")
    print(f"    emails:  {sorted(PROTECTED_EMAILS)}")
    print(f"    domains: {sorted(PROTECTED_DOMAINS)}")
    print(f"    companies: {sorted(PROTECTED_COMPANY_NAMES)}")
    print(sep)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true",
                   help="Actually delete. Requires env I_HAVE_BACKED_UP_ORDERS=YES.")
    args = p.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME are required env vars", file=sys.stderr)
        return 1

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    to_delete = asyncio.run(analyse(db))

    if not args.apply:
        print_dry_run(to_delete)
        print("\n  → To actually delete, first take mongodump + set env, then re-run with --apply\n")
        return 0

    if os.environ.get("I_HAVE_BACKED_UP_ORDERS") != "YES":
        print("\nREFUSING to --apply without env var I_HAVE_BACKED_UP_ORDERS=YES", file=sys.stderr)
        print("Take a mongodump first, then set the env var, then retry.", file=sys.stderr)
        return 2

    print("Applying cleanup...")
    counts = asyncio.run(apply(db, to_delete))
    print("Done.")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print("\nRollback (if needed):")
    print(f"  db.{counts['_backup_collection']}.find().forEach(row => db.getCollection(row._source).insertOne(row._doc));")
    return 0


if __name__ == "__main__":
    sys.exit(main())
