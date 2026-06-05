"""
Master Admin Broadcast Announcements (iter19).

Sends a single message to many users at once via Expo Push Notifications
(free, unlimited) and optionally email. Used for platform-wide outages,
feature launches, holiday menu changes, etc.

Each recipient gets:
  - An in-app `notification` record (visible in the existing NotificationBell)
  - A push notification (if they have a registered Expo token)
  - Optionally, a broadcast email (only if marketing_email pref is on)

A single `broadcasts` collection stores the master record + delivery stats
for the admin history view.

Endpoints:
  POST  /api/admin/broadcasts   — create + fan out a broadcast
  GET   /api/admin/broadcasts   — admin: list past broadcasts
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import email_service

logger = logging.getLogger(__name__)

VALID_AUDIENCES = {"all", "role", "site", "city"}
VALID_ROLES = {"employee", "vendor", "site_admin", "city_admin", "super_admin", "corporate_admin"}


class BroadcastCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    message: str = Field(..., min_length=3, max_length=4000)
    audience: str = Field(..., description="all | role | site | city")
    target_role: Optional[str] = Field(None, description="when audience=role")
    target_site_id: Optional[str] = Field(None, description="when audience=site")
    target_city_id: Optional[str] = Field(None, description="when audience=city")
    send_push: bool = True
    send_email: bool = False  # default off to conserve Resend quota


def make_router(db, safe_objectid, get_current_user, create_notification):
    r = APIRouter()

    async def _build_user_filter(data: BroadcastCreate) -> Dict[str, Any]:
        if data.audience not in VALID_AUDIENCES:
            raise HTTPException(status_code=400, detail=f"audience must be one of {VALID_AUDIENCES}")
        if data.audience == "all":
            return {}
        if data.audience == "role":
            if not data.target_role or data.target_role not in VALID_ROLES:
                raise HTTPException(status_code=400, detail=f"target_role required, one of {VALID_ROLES}")
            return {"role": data.target_role}
        if data.audience == "site":
            if not data.target_site_id:
                raise HTTPException(status_code=400, detail="target_site_id required")
            site = await db.sites.find_one({"_id": safe_objectid(data.target_site_id, "Site")})
            if not site:
                raise HTTPException(status_code=404, detail="Site not found")
            return {"site_id": data.target_site_id}
        if data.audience == "city":
            if not data.target_city_id:
                raise HTTPException(status_code=400, detail="target_city_id required")
            return {"city_id": data.target_city_id}
        return {}

    @r.post("/admin/broadcasts")
    async def create_broadcast(data: BroadcastCreate, user: dict = Depends(get_current_user)):
        """Master Admin sends an announcement to a set of users.
        Default channel: Expo Push (free, unlimited) + in-app bell.
        Email is opt-in per user via notification_preferences.marketing_email."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master admin only")

        user_filter = await _build_user_filter(data)

        # Persist the broadcast record first so we can audit even if fan-out partially fails
        now_utc = datetime.now(timezone.utc)
        broadcast_doc = {
            "title": data.title.strip(),
            "message": data.message.strip(),
            "audience": data.audience,
            "target_role": data.target_role,
            "target_site_id": data.target_site_id,
            "target_city_id": data.target_city_id,
            "send_push": bool(data.send_push),
            "send_email": bool(data.send_email),
            "created_by": user["id"],
            "created_by_email": user.get("email"),
            "created_at": now_utc,
            "delivery_stats": {"recipients": 0, "in_app": 0, "email_sent": 0, "email_skipped": 0},
        }
        res = await db.broadcasts.insert_one(broadcast_doc)
        broadcast_id = str(res.inserted_id)

        # Fan-out
        in_app_count = 0
        email_sent = 0
        email_skipped = 0
        recipients = 0

        cursor = db.users.find(
            user_filter,
            {"_id": 1, "email": 1, "name": 1, "expo_push_token": 1, "notification_preferences": 1},
        ).limit(5000)
        async for u in cursor:
            uid = str(u["_id"])
            recipients += 1

            # In-app notification (also fires push) — uses the existing notification
            # plumbing so the bell + Expo flow is identical to every other alert.
            if data.send_push:
                try:
                    await create_notification(
                        uid,
                        data.title.strip(),
                        data.message.strip(),
                        notif_type="broadcast",
                        push_data={"broadcast_id": broadcast_id, "type": "broadcast"},
                    )
                    in_app_count += 1
                except Exception as e:
                    logger.warning(f"Broadcast in-app/push to {uid} failed: {e}")

            # Email — respects user's `marketing_email` preference
            if data.send_email and u.get("email"):
                prefs = u.get("notification_preferences") or {}
                if prefs.get("marketing_email", False):
                    try:
                        html, text = email_service.render_broadcast_email(
                            name=u.get("name") or u["email"],
                            title=data.title.strip(),
                            message=data.message.strip(),
                            sender=user.get("name") or "Cravitoo Admin",
                        )
                        if email_service.send_email(u["email"], data.title.strip()[:80], html, text):
                            email_sent += 1
                    except Exception as e:
                        logger.warning(f"Broadcast email to {u['email']} failed: {e}")
                else:
                    email_skipped += 1

        # Update delivery stats
        stats = {
            "recipients": recipients,
            "in_app": in_app_count,
            "email_sent": email_sent,
            "email_skipped": email_skipped,
        }
        await db.broadcasts.update_one({"_id": res.inserted_id}, {"$set": {"delivery_stats": stats}})

        return {
            "id": broadcast_id,
            "title": broadcast_doc["title"],
            "audience": data.audience,
            "delivery_stats": stats,
            "created_at": now_utc.isoformat(),
        }

    @r.get("/admin/broadcasts")
    async def list_broadcasts(limit: int = Query(50, ge=1, le=200), user: dict = Depends(get_current_user)):
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master admin only")
        cursor = db.broadcasts.find({}).sort("created_at", -1).limit(limit)
        out = []
        async for b in cursor:
            out.append({
                "id": str(b["_id"]),
                "title": b.get("title"),
                "message": b.get("message"),
                "audience": b.get("audience"),
                "target_role": b.get("target_role"),
                "target_site_id": b.get("target_site_id"),
                "target_city_id": b.get("target_city_id"),
                "send_push": b.get("send_push", True),
                "send_email": b.get("send_email", False),
                "created_by_email": b.get("created_by_email"),
                "created_at": b.get("created_at").isoformat() if b.get("created_at") else None,
                "delivery_stats": b.get("delivery_stats", {}),
            })
        return out

    return r
