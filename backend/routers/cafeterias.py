"""Cafeteria layer — the grouping tier between a Site and its Vendors.

Hierarchy:  Client (Company) → City → Site → **Cafeteria** → Vendor

A Cafeteria is a named dining area inside a Site (e.g. "Tower A Food Court",
"Ground Floor Cafe"). Vendors are mapped to a Site AND assigned to a Cafeteria
within that Site via the `cafeteria_id` field on `vendor_site_mappings`.

To keep existing site-level routing 100% intact, every Site gets a default
"Main Cafeteria" and all pre-existing vendor mappings are auto-migrated onto it
(see `ensure_default_cafeterias`). Nothing that filters vendors/menus by
`site_id` changes — the cafeteria is purely an additional grouping label.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

DEFAULT_CAFETERIA_NAME = "Main Cafeteria"


def _can_access_site(user: dict, site_id: str) -> bool:
    role = user.get("role")
    if role == "master_admin":
        return True
    if role == "super_admin":
        return site_id in (user.get("assigned_sites") or [])
    if role == "site_admin":
        return user.get("site_id") == site_id
    return False


async def _default_cafeteria_id(db, site_id: str) -> str:
    """Return the site's default cafeteria id, creating it if missing."""
    existing = await db.cafeterias.find_one({"site_id": site_id, "is_default": True})
    if existing:
        return str(existing["_id"])
    res = await db.cafeterias.insert_one({
        "site_id": site_id,
        "name": DEFAULT_CAFETERIA_NAME,
        "description": "Default cafeteria (auto-created)",
        "is_active": True,
        "is_default": True,
        "created_at": datetime.now(timezone.utc),
        "created_by": "system",
    })
    return str(res.inserted_id)


async def ensure_default_cafeterias(db) -> Dict[str, int]:
    """Idempotent auto-migration.

    1. Every Site gets a default "Main Cafeteria".
    2. Every vendor_site_mapping without a cafeteria_id is pinned to its
       site's default cafeteria so existing routing keeps working.

    Safe to run on every startup — does nothing once data is migrated.
    """
    try:
        await db.cafeterias.create_index([("site_id", 1)])
        await db.cafeterias.create_index([("site_id", 1), ("is_default", 1)])
    except Exception:
        pass

    stats = {"cafeterias_created": 0, "mappings_migrated": 0}

    sites = await db.sites.find({}, {"_id": 1}).to_list(100000)
    for s in sites:
        sid = str(s["_id"])
        existing = await db.cafeterias.find_one({"site_id": sid, "is_default": True})
        if existing:
            default_id = str(existing["_id"])
        else:
            default_id = await _default_cafeteria_id(db, sid)
            stats["cafeterias_created"] += 1

        res = await db.vendor_site_mappings.update_many(
            {"site_id": sid, "$or": [{"cafeteria_id": None}, {"cafeteria_id": {"$exists": False}}]},
            {"$set": {"cafeteria_id": default_id}},
        )
        stats["mappings_migrated"] += res.modified_count

    return stats


def _serialize(caf: dict) -> dict:
    out = {**caf}
    out["id"] = str(out.pop("_id"))
    if isinstance(out.get("created_at"), datetime):
        out["created_at"] = out["created_at"].isoformat()
    return out


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    @r.get("/sites/{site_id}/cafeterias")
    async def list_cafeterias(site_id: str, user: dict = Depends(get_current_user)):
        """List cafeterias for a site. Employees of the site can read too."""
        if not (_can_access_site(user, site_id) or
                (user.get("role") == "employee" and user.get("site_id") == site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        # Ensure the site always has at least a default cafeteria on read.
        await _default_cafeteria_id(db, site_id)
        cafs = await db.cafeterias.find({"site_id": site_id}).sort([("is_default", -1), ("name", 1)]).to_list(500)
        out = []
        for c in cafs:
            doc = _serialize(c)
            doc["vendor_count"] = await db.vendor_site_mappings.count_documents(
                {"site_id": site_id, "cafeteria_id": doc["id"], "status": "active"}
            )
            out.append(doc)
        return out

    @r.post("/sites/{site_id}/cafeterias")
    async def create_cafeteria(site_id: str, data: Dict[str, Any], user: dict = Depends(get_current_user)):
        if not _can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Cafeteria name is required")
        dup = await db.cafeterias.find_one({"site_id": site_id, "name": name})
        if dup:
            raise HTTPException(status_code=400, detail="A cafeteria with this name already exists at this site")
        # Guarantee a default exists first so the very first custom cafeteria
        # is never accidentally treated as the default.
        await _default_cafeteria_id(db, site_id)
        res = await db.cafeterias.insert_one({
            "site_id": site_id,
            "name": name,
            "description": (data.get("description") or "").strip(),
            "is_active": True,
            "is_default": False,
            "created_at": datetime.now(timezone.utc),
            "created_by": user.get("id"),
        })
        created = await db.cafeterias.find_one({"_id": res.inserted_id})
        return _serialize(created)

    @r.patch("/cafeterias/{cafeteria_id}")
    async def update_cafeteria(cafeteria_id: str, updates: Dict[str, Any], user: dict = Depends(get_current_user)):
        caf = await db.cafeterias.find_one({"_id": safe_objectid(cafeteria_id, "Cafeteria")})
        if not caf:
            raise HTTPException(status_code=404, detail="Cafeteria not found")
        if not _can_access_site(user, caf["site_id"]):
            raise HTTPException(status_code=403, detail="Access denied")
        allowed = {"name", "description", "is_active"}
        cleaned = {k: v for k, v in updates.items() if k in allowed}
        if "name" in cleaned:
            cleaned["name"] = (cleaned["name"] or "").strip()
            if not cleaned["name"]:
                raise HTTPException(status_code=400, detail="Cafeteria name cannot be empty")
            dup = await db.cafeterias.find_one({
                "site_id": caf["site_id"], "name": cleaned["name"],
                "_id": {"$ne": caf["_id"]},
            })
            if dup:
                raise HTTPException(status_code=400, detail="Another cafeteria at this site already uses that name")
        # The default cafeteria can be renamed but never deactivated.
        if caf.get("is_default") and cleaned.get("is_active") is False:
            raise HTTPException(status_code=400, detail="The default cafeteria cannot be deactivated")
        if not cleaned:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        await db.cafeterias.update_one({"_id": caf["_id"]}, {"$set": cleaned})
        updated = await db.cafeterias.find_one({"_id": caf["_id"]})
        return _serialize(updated)

    @r.delete("/cafeterias/{cafeteria_id}")
    async def delete_cafeteria(cafeteria_id: str, user: dict = Depends(get_current_user)):
        """Delete a cafeteria. The default cafeteria cannot be deleted. Any
        vendors assigned to the deleted cafeteria are moved back to the site's
        default cafeteria so no mapping is left orphaned."""
        caf = await db.cafeterias.find_one({"_id": safe_objectid(cafeteria_id, "Cafeteria")})
        if not caf:
            raise HTTPException(status_code=404, detail="Cafeteria not found")
        if not _can_access_site(user, caf["site_id"]):
            raise HTTPException(status_code=403, detail="Access denied")
        if caf.get("is_default"):
            raise HTTPException(status_code=400, detail="The default cafeteria cannot be deleted")
        default_id = await _default_cafeteria_id(db, caf["site_id"])
        reassigned = await db.vendor_site_mappings.update_many(
            {"site_id": caf["site_id"], "cafeteria_id": cafeteria_id},
            {"$set": {"cafeteria_id": default_id}},
        )
        await db.cafeterias.delete_one({"_id": caf["_id"]})
        return {
            "message": f"Cafeteria '{caf.get('name')}' deleted",
            "vendors_reassigned_to_default": reassigned.modified_count,
        }

    @r.patch("/sites/{site_id}/vendors/{vendor_id}/cafeteria")
    async def move_vendor_to_cafeteria(site_id: str, vendor_id: str, payload: Dict[str, Any],
                                       user: dict = Depends(get_current_user)):
        """Move a mapped vendor into a different cafeteria within the same site."""
        if not _can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        cafeteria_id = (payload or {}).get("cafeteria_id")
        if not cafeteria_id:
            raise HTTPException(status_code=400, detail="cafeteria_id is required")
        caf = await db.cafeterias.find_one({"_id": safe_objectid(cafeteria_id, "Cafeteria")})
        if not caf or caf["site_id"] != site_id:
            raise HTTPException(status_code=404, detail="Cafeteria not found at this site")
        mapping = await db.vendor_site_mappings.find_one({"vendor_id": vendor_id, "site_id": site_id})
        if not mapping:
            raise HTTPException(status_code=404, detail="Vendor is not mapped to this site")
        await db.vendor_site_mappings.update_one(
            {"_id": mapping["_id"]}, {"$set": {"cafeteria_id": cafeteria_id}}
        )
        return {"message": "Vendor moved", "cafeteria_id": cafeteria_id, "cafeteria_name": caf.get("name")}

    return r
