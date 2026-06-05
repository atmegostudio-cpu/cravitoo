"""
Meal Reservation routes (iter15).

Endpoints:
  GET    /api/reservations/availability        — employee sees 4 meal slots for tomorrow
  POST   /api/reservations                     — employee creates a reservation
  GET    /api/reservations/my                  — employee's history
  DELETE /api/reservations/{id}                — employee/vendor cancels before cutoff
  POST   /api/reservations/{id}/consume        — vendor marks as consumed
  GET    /api/reservations/vendor/counts       — vendor head-count + customer list
  GET    /api/reservations/admin/summary       — site/master admin aggregated totals
  GET    /api/sites/{id}/reservation-settings  — read per-site toggle + cutoff config
  PATCH  /api/sites/{id}/reservation-settings  — master/site admin toggles

This module is intentionally a `make_router(...)` factory so it can receive
the shared `db`, `safe_objectid`, `get_current_user`, `create_notification`
from server.py — avoiding circular imports.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

MEAL_PERIODS = ["breakfast", "lunch", "snacks", "dinner"]
DEFAULT_RESERVATION_SETTINGS: Dict[str, Any] = {
    "breakfast": {"enabled": True, "cutoff_hour": 20, "cutoff_minute": 0},
    "lunch":     {"enabled": True, "cutoff_hour": 20, "cutoff_minute": 0},
    "snacks":    {"enabled": True, "cutoff_hour": 20, "cutoff_minute": 0},
    "dinner":    {"enabled": True, "cutoff_hour": 20, "cutoff_minute": 0},
}


class ReservationCreate(BaseModel):
    vendor_id: str
    meal_period: str
    delivery_date: Optional[str] = None


class ReservationSettingsUpdate(BaseModel):
    breakfast_enabled: Optional[bool] = None
    lunch_enabled: Optional[bool] = None
    snacks_enabled: Optional[bool] = None
    dinner_enabled: Optional[bool] = None
    cutoff_hour: Optional[int] = None


def _now_ist() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def _get_site_reservation_settings(site_doc: Dict[str, Any]) -> Dict[str, Any]:
    settings = {k: dict(v) for k, v in DEFAULT_RESERVATION_SETTINGS.items()}
    if site_doc and isinstance(site_doc.get("reservation_settings"), dict):
        for meal, cfg in site_doc["reservation_settings"].items():
            if meal in settings and isinstance(cfg, dict):
                settings[meal] = {**settings[meal], **cfg}
    return settings


def _cutoff_for_delivery_date(delivery_date: datetime, meal_cfg: Dict[str, Any]) -> datetime:
    day_before = delivery_date - timedelta(days=1)
    cutoff_ist = datetime(
        day_before.year, day_before.month, day_before.day,
        meal_cfg.get("cutoff_hour", 20), meal_cfg.get("cutoff_minute", 0),
        tzinfo=timezone.utc,
    )
    return cutoff_ist - timedelta(hours=5, minutes=30)


def _parse_delivery_date(date_str: Optional[str]) -> datetime:
    if not date_str:
        tomorrow = (_now_ist() + timedelta(days=1)).date()
    else:
        try:
            tomorrow = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="delivery_date must be in YYYY-MM-DD format")
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, tzinfo=timezone.utc) - timedelta(hours=5, minutes=30)


def make_router(db, safe_objectid, get_current_user, create_notification):
    """Build the reservations APIRouter with injected dependencies."""
    r = APIRouter()

    @r.get("/reservations/availability")
    async def get_reservation_availability(user: dict = Depends(get_current_user)):
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees can reserve meals")
        site_id = user.get("site_id")
        if not site_id:
            raise HTTPException(status_code=400, detail="No site assigned to your account. Contact your admin.")

        site_doc = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site_doc:
            raise HTTPException(status_code=404, detail="Site not found")

        settings = _get_site_reservation_settings(site_doc)
        delivery_date = _parse_delivery_date(None)
        now_utc = datetime.now(timezone.utc)

        mappings = await db.vendor_site_mappings.find({"site_id": site_id}).to_list(200)
        vendor_ids = [m["vendor_id"] for m in mappings]
        vendor_id_objs = []
        for vid in vendor_ids:
            try:
                vendor_id_objs.append(safe_objectid(vid, "Vendor"))
            except Exception:
                continue
        vendors_list = []
        if vendor_id_objs:
            vendors_cursor = db.vendors.find({"_id": {"$in": vendor_id_objs}, "status": "active"})
            async for v in vendors_cursor:
                vendors_list.append({"id": str(v["_id"]), "name": v.get("name", "Vendor")})

        existing = await db.reservations.find({
            "employee_id": user["id"],
            "delivery_date": delivery_date,
            "status": "reserved",
        }).to_list(10)
        existing_by_meal: Dict[str, Dict[str, Any]] = {}
        for rec in existing:
            existing_by_meal[rec["meal_period"]] = {
                "id": str(rec["_id"]),
                "vendor_id": rec.get("vendor_id"),
                "vendor_name": next((v["name"] for v in vendors_list if v["id"] == rec.get("vendor_id")), ""),
            }

        out = []
        for meal in MEAL_PERIODS:
            cfg = settings.get(meal, {})
            cutoff_at = _cutoff_for_delivery_date(delivery_date, cfg)
            if cutoff_at.tzinfo is None:
                cutoff_at = cutoff_at.replace(tzinfo=timezone.utc)
            out.append({
                "meal_period": meal,
                "enabled": bool(cfg.get("enabled", True)),
                "cutoff_at": cutoff_at.isoformat(),
                "cutoff_passed": now_utc >= cutoff_at,
                "delivery_date": delivery_date.date().isoformat(),
                "already_reserved": existing_by_meal.get(meal),
                "eligible_vendors": vendors_list,
            })

        return {"date": delivery_date.date().isoformat(), "site_id": site_id, "meals": out}

    @r.post("/reservations")
    async def create_reservation(data: ReservationCreate, user: dict = Depends(get_current_user)):
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees can reserve meals")
        if data.meal_period not in MEAL_PERIODS:
            raise HTTPException(status_code=400, detail=f"meal_period must be one of {MEAL_PERIODS}")

        site_id = user.get("site_id")
        if not site_id:
            raise HTTPException(status_code=400, detail="No site assigned to your account")

        site_doc = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site_doc:
            raise HTTPException(status_code=404, detail="Site not found")

        settings = _get_site_reservation_settings(site_doc)
        meal_cfg = settings.get(data.meal_period, {})
        if not meal_cfg.get("enabled", True):
            raise HTTPException(status_code=400, detail=f"Reservations for {data.meal_period} are currently disabled by your site admin")

        delivery_date = _parse_delivery_date(data.delivery_date)
        tomorrow = _parse_delivery_date(None)
        if delivery_date != tomorrow:
            raise HTTPException(status_code=400, detail="Reservations are only accepted for the next day")

        cutoff_at = _cutoff_for_delivery_date(delivery_date, meal_cfg)
        now_utc = datetime.now(timezone.utc)
        if now_utc >= cutoff_at:
            raise HTTPException(status_code=400, detail=f"Cutoff for {data.meal_period} has passed (was {cutoff_at.isoformat()})")

        existing = await db.reservations.find_one({
            "employee_id": user["id"],
            "delivery_date": delivery_date,
            "meal_period": data.meal_period,
            "status": "reserved",
        })
        if existing:
            raise HTTPException(status_code=409, detail=f"You already have a {data.meal_period} reservation for {delivery_date.date().isoformat()}")

        mapping = await db.vendor_site_mappings.find_one({"site_id": site_id, "vendor_id": data.vendor_id})
        if not mapping:
            raise HTTPException(status_code=400, detail="Selected vendor is not available at your site")

        vendor_doc = await db.vendors.find_one({"_id": safe_objectid(data.vendor_id, "Vendor")})
        vendor_name = (vendor_doc or {}).get("name", "Vendor")

        pickup_token = f"CRAVITOO-RESERVATION-{secrets.token_hex(8)}"

        doc = {
            "employee_id": user["id"],
            "employee_email": user["email"],
            "employee_name": user.get("name"),
            "vendor_id": data.vendor_id,
            "vendor_name": vendor_name,
            "site_id": site_id,
            "meal_period": data.meal_period,
            "delivery_date": delivery_date,
            "cutoff_at": cutoff_at,
            "status": "reserved",
            "pickup_qr": pickup_token,
            "created_at": now_utc,
        }
        result = await db.reservations.insert_one(doc)
        reservation_id = str(result.inserted_id)

        try:
            await create_notification(
                user_id=user["id"],
                title=f"✅ {data.meal_period.title()} reserved",
                message=f"Your {data.meal_period} for {delivery_date.date().isoformat()} is reserved with {vendor_name}.",
                notif_type="reservation_confirmed",
                push_data={"screen": "Reservations", "reservation_id": reservation_id},
            )
        except Exception as e:
            logger.warning(f"Reservation notify employee failed: {e}")

        return {
            "id": reservation_id,
            "meal_period": data.meal_period,
            "delivery_date": delivery_date.date().isoformat(),
            "vendor_id": data.vendor_id,
            "vendor_name": vendor_name,
            "cutoff_at": cutoff_at.isoformat(),
            "status": "reserved",
            "pickup_qr": pickup_token,
        }

    @r.get("/reservations/my")
    async def list_my_reservations(
        status: Optional[str] = Query(None),
        user: dict = Depends(get_current_user),
    ):
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees can list reservations")
        query: Dict[str, Any] = {"employee_id": user["id"]}
        if status and status != "all":
            query["status"] = status
        docs = await db.reservations.find(query).sort("delivery_date", -1).to_list(200)
        out = []
        for d in docs:
            d["id"] = str(d.pop("_id"))
            for k in ("delivery_date", "cutoff_at", "created_at", "consumed_at", "cancelled_at"):
                if isinstance(d.get(k), datetime):
                    d[k] = d[k].isoformat()
            out.append(d)
        return out

    @r.delete("/reservations/{reservation_id}")
    async def cancel_reservation(reservation_id: str, user: dict = Depends(get_current_user)):
        doc = await db.reservations.find_one({"_id": safe_objectid(reservation_id, "Reservation")})
        if not doc:
            raise HTTPException(status_code=404, detail="Reservation not found")
        if user["role"] == "employee" and doc.get("employee_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Not your reservation")
        if doc.get("status") != "reserved":
            raise HTTPException(status_code=400, detail=f"Reservation already {doc.get('status')}")
        now_utc = datetime.now(timezone.utc)
        cutoff = doc.get("cutoff_at")
        if isinstance(cutoff, datetime) and cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
        if cutoff and now_utc >= cutoff:
            raise HTTPException(status_code=400, detail="Cutoff has passed — cancellation no longer allowed")
        await db.reservations.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "cancelled", "cancelled_at": now_utc, "cancelled_by": user["id"]}},
        )
        return {"ok": True}

    @r.post("/reservations/{reservation_id}/consume")
    async def consume_reservation(reservation_id: str, user: dict = Depends(get_current_user)):
        if user["role"] not in ("vendor", "master_admin", "site_admin"):
            raise HTTPException(status_code=403, detail="Only vendor / admin can mark consumed")
        doc = await db.reservations.find_one({"_id": safe_objectid(reservation_id, "Reservation")})
        if not doc:
            raise HTTPException(status_code=404, detail="Reservation not found")
        if user["role"] == "vendor" and doc.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Not your reservation")
        if doc.get("status") != "reserved":
            raise HTTPException(status_code=400, detail=f"Reservation already {doc.get('status')}")
        now_utc = datetime.now(timezone.utc)
        await db.reservations.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "consumed", "consumed_at": now_utc, "consumed_by": user["id"]}},
        )
        return {"ok": True}

    @r.get("/reservations/vendor/counts")
    async def vendor_reservation_counts(
        date: Optional[str] = Query(None),
        user: dict = Depends(get_current_user),
    ):
        if user["role"] != "vendor":
            raise HTTPException(status_code=403, detail="Only vendors can view this")
        vendor_id = user.get("vendor_id")
        if not vendor_id:
            raise HTTPException(status_code=400, detail="No vendor record linked to this account")
        delivery_date = _parse_delivery_date(date)
        pipeline = [
            {"$match": {"vendor_id": vendor_id, "delivery_date": delivery_date, "status": {"$in": ["reserved", "consumed"]}}},
            {"$group": {"_id": "$meal_period", "count": {"$sum": 1}, "consumed": {"$sum": {"$cond": [{"$eq": ["$status", "consumed"]}, 1, 0]}}}},
        ]
        counts: Dict[str, Dict[str, int]] = {m: {"reserved": 0, "consumed": 0} for m in MEAL_PERIODS}
        async for row in db.reservations.aggregate(pipeline):
            meal = row["_id"]
            if meal in counts:
                counts[meal]["reserved"] = row["count"]
                counts[meal]["consumed"] = row["consumed"]
        reservations_list = await db.reservations.find(
            {"vendor_id": vendor_id, "delivery_date": delivery_date, "status": "reserved"},
            {"employee_name": 1, "employee_email": 1, "meal_period": 1, "pickup_qr": 1, "created_at": 1},
        ).to_list(1000)
        for rec in reservations_list:
            rec["id"] = str(rec.pop("_id"))
            if isinstance(rec.get("created_at"), datetime):
                rec["created_at"] = rec["created_at"].isoformat()
        return {
            "date": delivery_date.date().isoformat(),
            "vendor_id": vendor_id,
            "counts": counts,
            "total": sum(c["reserved"] for c in counts.values()),
            "reservations": reservations_list,
        }

    @r.get("/reservations/admin/summary")
    async def admin_reservation_summary(
        date: Optional[str] = Query(None),
        user: dict = Depends(get_current_user),
    ):
        if user["role"] not in ("master_admin", "site_admin", "super_admin", "city_admin"):
            raise HTTPException(status_code=403, detail="Not authorised")
        delivery_date = _parse_delivery_date(date)
        base_match: Dict[str, Any] = {"delivery_date": delivery_date, "status": {"$in": ["reserved", "consumed"]}}
        if user["role"] == "site_admin" and user.get("site_id"):
            base_match["site_id"] = user["site_id"]
        pipeline = [
            {"$match": base_match},
            {"$group": {
                "_id": {"site_id": "$site_id", "vendor_id": "$vendor_id", "meal_period": "$meal_period"},
                "count": {"$sum": 1},
                "consumed": {"$sum": {"$cond": [{"$eq": ["$status", "consumed"]}, 1, 0]}},
            }},
        ]
        rows = []
        async for rec in db.reservations.aggregate(pipeline):
            rows.append({
                "site_id": rec["_id"]["site_id"],
                "vendor_id": rec["_id"]["vendor_id"],
                "meal_period": rec["_id"]["meal_period"],
                "reserved": rec["count"],
                "consumed": rec["consumed"],
            })
        total_by_meal = {m: 0 for m in MEAL_PERIODS}
        for rec in rows:
            total_by_meal[rec["meal_period"]] = total_by_meal.get(rec["meal_period"], 0) + rec["reserved"]
        return {
            "date": delivery_date.date().isoformat(),
            "total_reservations": sum(total_by_meal.values()),
            "by_meal": total_by_meal,
            "breakdown": rows,
        }

    @r.get("/sites/{site_id}/reservation-settings")
    async def get_reservation_settings(site_id: str, user: dict = Depends(get_current_user)):
        if user["role"] not in ("master_admin", "site_admin", "super_admin", "city_admin"):
            raise HTTPException(status_code=403, detail="Not authorised")
        if user["role"] == "site_admin" and user.get("site_id") != site_id:
            raise HTTPException(status_code=403, detail="Not your site")
        site_doc = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site_doc:
            raise HTTPException(status_code=404, detail="Site not found")
        return {
            "site_id": site_id,
            "site_name": site_doc.get("name"),
            "settings": _get_site_reservation_settings(site_doc),
        }

    @r.patch("/sites/{site_id}/reservation-settings")
    async def update_reservation_settings(
        site_id: str,
        data: ReservationSettingsUpdate,
        user: dict = Depends(get_current_user),
    ):
        if user["role"] not in ("master_admin", "site_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only Master / Site Admin can change reservation settings")
        if user["role"] == "site_admin" and user.get("site_id") != site_id:
            raise HTTPException(status_code=403, detail="Not your site")

        site_doc = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site_doc:
            raise HTTPException(status_code=404, detail="Site not found")

        settings = _get_site_reservation_settings(site_doc)
        toggle_map = {
            "breakfast_enabled": "breakfast",
            "lunch_enabled": "lunch",
            "snacks_enabled": "snacks",
            "dinner_enabled": "dinner",
        }
        for field, meal in toggle_map.items():
            val = getattr(data, field)
            if val is not None:
                settings[meal] = {**settings[meal], "enabled": bool(val)}
        if data.cutoff_hour is not None:
            if not (0 <= data.cutoff_hour <= 23):
                raise HTTPException(status_code=400, detail="cutoff_hour must be 0-23")
            for meal in MEAL_PERIODS:
                settings[meal] = {**settings[meal], "cutoff_hour": data.cutoff_hour}

        await db.sites.update_one(
            {"_id": safe_objectid(site_id, "Site")},
            {"$set": {"reservation_settings": settings, "reservation_settings_updated_at": datetime.now(timezone.utc), "reservation_settings_updated_by": user["id"]}},
        )
        return {"ok": True, "settings": settings}

    return r
