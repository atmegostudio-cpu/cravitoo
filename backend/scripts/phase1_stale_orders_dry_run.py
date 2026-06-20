"""Stale-order backfill — DRY RUN ONLY.

Analyses the orders collection and reports which rows WOULD be expired by the
Phase 1 cutoff logic.  Performs zero writes.  Backup and rollback procedures
are printed at the end.

Usage:
    MONGO_URL="..." DB_NAME="..." python phase1_stale_orders_dry_run.py

The script also accepts:
    --threshold-hours N      override the 48h staleness threshold
    --target-status STATUS   override the proposed new status (default: expired)

Production usage notes
----------------------
- This script is **READ-ONLY**.  Even if `--apply` is passed it will refuse —
  see the assertion at the bottom of `main()` — the file does not contain any
  write path. Use the documented Mongo backfill command in PHASE1_REPORT.md if
  you decide to apply it.
- Run from a host that has network access to the production MongoDB.  No
  application code is imported.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from motor.motor_asyncio import AsyncIOMotorClient

TERMINAL = {"completed", "cancelled", "expired", "no_show", "rejected"}


async def analyse(mongo_url: str, db_name: str, threshold_hours: int, target_status: str) -> Dict:
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)

    # Status breakdown of ALL orders (one full pass via aggregation)
    breakdown_cur = db.orders.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ])
    breakdown = {row["_id"] or "<null>": row["count"] async for row in breakdown_cur}

    # Stale (non-terminal AND older than cutoff)
    stale_filter = {
        "status": {"$nin": list(TERMINAL)},
        "created_at": {"$lt": cutoff},
    }
    stale_total = await db.orders.count_documents(stale_filter)

    # Stale per status
    stale_by_status_cur = db.orders.aggregate([
        {"$match": stale_filter},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ])
    stale_by_status = {row["_id"]: row["count"] async for row in stale_by_status_cur}

    # Orders that LOOK genuinely active despite being stale (have payment_id /
    # razorpay_payment_id / pickup_qr that has been scanned recently).  These
    # are the ones the operator should investigate manually before backfilling.
    active_looking_filter = {
        **stale_filter,
        "$or": [
            {"payment_status": "paid"},
            {"razorpay_payment_id": {"$exists": True, "$ne": None}},
            {"updated_at": {"$gt": cutoff}},
            {"status_updated_at": {"$gt": cutoff}},
        ],
    }
    active_looking = await db.orders.count_documents(active_looking_filter)

    # Sample stale orders (first 10, oldest first) for the operator to spot-check
    sample_cur = (
        db.orders.find(
            stale_filter,
            projection={
                "_id": 1,
                "user_id": 1,
                "vendor_id": 1,
                "status": 1,
                "created_at": 1,
                "payment_status": 1,
                "total_amount": 1,
            },
        )
        .sort("created_at", 1)
        .limit(10)
    )
    samples: List[Dict] = []
    async for row in sample_cur:
        samples.append({
            "id": str(row["_id"]),
            "status": row.get("status"),
            "created_at": row.get("created_at"),
            "age_hours": (datetime.now(timezone.utc) - row["created_at"].replace(tzinfo=timezone.utc)).total_seconds() / 3600
                if isinstance(row.get("created_at"), datetime) else None,
            "payment_status": row.get("payment_status"),
            "total_amount": row.get("total_amount"),
        })

    client.close()
    return {
        "threshold_hours": threshold_hours,
        "cutoff": cutoff,
        "target_status": target_status,
        "total_orders": sum(breakdown.values()),
        "breakdown_all": breakdown,
        "stale_total": stale_total,
        "stale_by_status": stale_by_status,
        "active_looking_in_stale_set": active_looking,
        "samples_oldest_first": samples,
    }


def print_report(r: Dict) -> None:
    sep = "─" * 70
    print(sep)
    print(f"  Stale-Order Backfill — DRY RUN ({datetime.now(timezone.utc).isoformat()})")
    print(sep)
    print(f"  Cutoff threshold     : {r['threshold_hours']}h before now")
    print(f"  Cutoff timestamp     : {r['cutoff'].isoformat()}")
    print(f"  Proposed new status  : {r['target_status']}")
    print(f"  Total orders in DB   : {r['total_orders']:,}")
    print()
    print("  Full status breakdown")
    for st, n in sorted(r["breakdown_all"].items(), key=lambda x: -x[1]):
        marker = "  (terminal)" if st in TERMINAL else ""
        print(f"      {st:<14}  {n:>6,}{marker}")
    print()
    print(f"  STALE orders (non-terminal AND >{r['threshold_hours']}h old): {r['stale_total']:,}")
    if r["stale_by_status"]:
        for st, n in sorted(r["stale_by_status"].items(), key=lambda x: -x[1]):
            print(f"      {st:<14}  {n:>6,}")
    else:
        print("      (none — nothing to back-fill)")
    print()
    print(f"  Looks-active-despite-stale (payment-paid OR updated <{r['threshold_hours']}h ago):")
    print(f"      {r['active_looking_in_stale_set']:,} order(s) require operator review BEFORE bulk update.")
    print()
    if r["samples_oldest_first"]:
        print("  Oldest 10 stale orders (spot-check candidates):")
        for s in r["samples_oldest_first"]:
            print(f"      {s['id']}  {s['status']:<10}  "
                  f"age={s['age_hours']:.1f}h  pay={s['payment_status']!s}  "
                  f"₹{s['total_amount']}")
    print(sep)
    print("  Backup procedure (BEFORE applying):")
    print("    mongodump --uri='$MONGO_URL' --db=$DB_NAME --collection=orders \\")
    print("              --query='{\"status\":{\"$nin\":[\"completed\",\"cancelled\",\"expired\",\"no_show\",\"rejected\"]}}' \\")
    print("              --out=/backups/orders-pre-backfill-$(date +%Y%m%d-%H%M)")
    print()
    print("  Apply procedure (only after operator review):")
    print("    db.orders.updateMany(")
    print("      { status: { $in: ['pending','confirmed','preparing','ready'] },")
    print(f"        created_at: {{ $lt: new Date('{r['cutoff'].isoformat()}') }} }},")
    print(f"      {{ $set: {{ status: '{r['target_status']}', status_updated_at: new Date(),")
    print("                expired_by: 'phase1_backfill', expired_at: new Date() } }")
    print("    );")
    print()
    print("  Rollback procedure (if the backfill mislabels any order):")
    print("    mongorestore --uri='$MONGO_URL' --db=$DB_NAME --collection=orders \\")
    print("                 --drop /backups/orders-pre-backfill-<TIMESTAMP>/$DB_NAME/orders.bson")
    print()
    print("  Alternatively, undo by tag:")
    print(f"    db.orders.updateMany(")
    print(f"      {{ expired_by: 'phase1_backfill' }},")
    print(f"      {{ $unset: {{ expired_by: '', expired_at: '' }},")
    print(f"        $set:   {{ status: '<previous_status>' }} }}")
    print("    );")
    print("    (preserve a CSV of (id, previous_status) BEFORE running the apply step)")
    print(sep)
    print()
    if r["active_looking_in_stale_set"] > 0:
        print(f"  ⚠️  {r['active_looking_in_stale_set']} stale orders look genuinely active. DO NOT bulk-apply.")
        print("      Triage them manually first, then re-run the dry-run.")
    else:
        print("  ✅ No active-looking stale orders detected — backfill is safe.")
    print(sep)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--threshold-hours", type=int, default=48)
    p.add_argument("--target-status", default="expired")
    p.add_argument("--apply", action="store_true", help="(disabled — read-only by design)")
    args = p.parse_args()

    assert not args.apply, "This script is read-only. To apply, use the Mongo command in the printed report."

    mongo_url = os.environ.get("MONGO_URL") or sys.exit("MONGO_URL required")
    db_name = os.environ.get("DB_NAME") or sys.exit("DB_NAME required")
    r = asyncio.run(analyse(mongo_url, db_name, args.threshold_hours, args.target_status))
    print_report(r)


if __name__ == "__main__":
    main()
