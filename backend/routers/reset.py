"""Reset to Blank State — Master-Admin-only wipe endpoint.

Wipes every user-facing collection while preserving:
  * The master admin login (email == ADMIN_EMAIL, default admin@cravitoo.com)
  * A single row in `allowed_domains` for the master admin's own domain
    (default "cravitoo.com") so employee signup remains functional
  * The `admins`-style audit_log entries for the reset itself

Every row deleted is COPIED into `_reset_backup_<ts>` beforehand so a botched
reset can be rolled back with a one-liner mongosh command that the response
returns to the caller.

Auth: master_admin ONLY. This endpoint is available in every environment
(unlike /admin/demo/* which is 404 in production) — it exists precisely so
operators can rebuild the app for a new client on production.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException


# Collections we clear out (anything user-owned, business, or transactional).
# Ordered so parents come before children — Mongo doesn't enforce FKs but
# this keeps the audit trail readable.
COLLECTIONS_TO_WIPE = [
    "orders", "order_status_history",
    "reservations", "pre_order_reservations",
    "payment_transactions",
    "invoices",
    "notifications", "notification_prefs",
    "menu_items", "menu_categories", "menu_change_requests",
    "vendor_site_mappings", "meal_schedules",
    "vendor_onboarding",
    "favorites",
    "vendors",
    "sites",
    "companies",
    "cities",
    "allowed_domains",
    "otp_codes",
    "audit_log",   # cleared last, the reset row itself is added AFTER
    "users",       # cleared last; master admin is re-inserted from snapshot
]


def make_router(db, get_current_user):
    r = APIRouter()

    @r.post("/admin/reset-to-blank")
    async def reset_to_blank(
        confirm: str,
        keep_domain: str = "cravitoo.com",
        user: dict = Depends(get_current_user)
    ):
        """Wipe the DB. Requires `?confirm=I_UNDERSTAND_THIS_DELETES_EVERYTHING`.

        Returns the backup-collection name for rollback.
        """
        if user.get("role") not in ("master_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only master admin can reset the app")
        if confirm != "I_UNDERSTAND_THIS_DELETES_EVERYTHING":
            raise HTTPException(
                status_code=400,
                detail="Missing confirmation phrase — refuse to reset without explicit confirm string"
            )

        admin_email = (os.environ.get("ADMIN_EMAIL") or "admin@cravitoo.com").lower()
        # Snapshot the master admin's user doc so we can reinsert it verbatim.
        admin_doc = await db.users.find_one({"email": admin_email})
        if not admin_doc:
            raise HTTPException(
                status_code=500,
                detail=f"Master admin '{admin_email}' not found — refusing to reset (would lock you out)"
            )

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_coll = f"_reset_backup_{ts}"
        counts: Dict[str, int] = {}

        # For each collection: (1) copy every row into the backup, (2) drop.
        for coll in COLLECTIONS_TO_WIPE:
            rows = await db[coll].find({}).to_list(100000)
            if rows:
                payload = [{"_source": coll, "_doc": row} for row in rows]
                await db[backup_coll].insert_many(payload)
            deleted = await db[coll].delete_many({})
            counts[coll] = deleted.deleted_count

        # Restore the master admin row so login stays functional.
        await db.users.insert_one(admin_doc)

        # Restore a single allowed_domains row so employees can still register
        # from the master admin's own domain (defaults to cravitoo.com).
        if keep_domain and keep_domain.strip():
            await db.allowed_domains.insert_one({
                "domain": keep_domain.strip().lower(),
                "is_active": True,
                "created_at": datetime.now(timezone.utc),
                "note": f"Preserved during app reset at {ts}",
            })

        # New, fresh audit log entry for the reset itself.
        await db.audit_log.insert_one({
            "user_id": str(admin_doc.get("_id")),
            "user_email": admin_email,
            "user_role": user.get("role"),
            "entity_type": "system",
            "entity_id": "app_reset",
            "action": "reset_to_blank",
            "details": {
                "counts": counts,
                "backup_collection": backup_coll,
                "kept_admin": admin_email,
                "kept_domain": keep_domain,
            },
            "created_at": datetime.now(timezone.utc),
        })

        rollback_hint = (
            f"db.{backup_coll}.find().forEach("
            f"r => db.getCollection(r._source).insertOne(r._doc));"
        )
        return {
            "ok": True,
            "message": f"App reset to blank. Kept {admin_email} + domain '{keep_domain}'.",
            "backup_collection": backup_coll,
            "counts": counts,
            "rollback_hint": rollback_hint,
        }

    @r.get("/admin/reset-preview")
    async def reset_preview(user: dict = Depends(get_current_user)):
        """Read-only preview — show what the reset would delete."""
        if user.get("role") not in ("master_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only master admin")
        counts: Dict[str, int] = {}
        for coll in COLLECTIONS_TO_WIPE:
            counts[coll] = await db[coll].count_documents({})
        return {"would_delete": counts, "total": sum(counts.values())}

    return r
