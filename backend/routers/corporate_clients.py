"""
Corporate Clients router (PDF Module 2).

Extends the `companies` collection with a Draft → Review → Approved → Active lifecycle.
Master Admin (and existing super_admin) can list, create, transition lifecycle, and
add billing contact details.

Endpoints:
  GET    /api/master/corporate-clients
  POST   /api/master/corporate-clients
  PATCH  /api/master/corporate-clients/{id}
  POST   /api/master/corporate-clients/{id}/lifecycle   body: {to: 'review'|'approved'|'active'|'draft'}
  DELETE /api/master/corporate-clients/{id}

`approved` transition sends a Welcome email (with login link) to billing_contact_email
or contact_email (whichever is set).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger(__name__)


LIFECYCLE_ORDER = ["draft", "review", "approved", "active"]
# Allowed transitions
LIFECYCLE_TRANSITIONS: Dict[str, set] = {
    "draft":    {"review"},
    "review":   {"draft", "approved"},
    "approved": {"review", "active"},
    "active":   {"approved"},  # rollback allowed
}


class CorporateClientCreate(BaseModel):
    name: str
    address: str
    contact_email: EmailStr
    contact_phone: str
    billing_contact_name: Optional[str] = None
    billing_contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None


class CorporateClientUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city_id: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    billing_contact_name: Optional[str] = None
    billing_contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None


class LifecycleTransition(BaseModel):
    to: str = Field(..., description="One of draft, review, approved, active")
    remarks: Optional[str] = None


def _is_master(user: dict) -> bool:
    return user["role"] in ("master_admin", "super_admin")


def _doc_to_dict(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {**doc}
    out["id"] = str(out.pop("_id"))
    for k in ("created_at", "approved_at", "activated_at", "lifecycle_updated_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    if not out.get("lifecycle_status"):
        # Legacy companies default to 'active' so they keep working
        out["lifecycle_status"] = "active"
    return out


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    def _resolve_public_base(request: Request) -> str:
        base = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
        if base:
            return base
        hdrs = request.headers
        origin = (hdrs.get("origin") or "").rstrip("/")
        if origin:
            return origin
        fwd_host = hdrs.get("x-forwarded-host")
        if fwd_host:
            proto = hdrs.get("x-forwarded-proto", "https")
            return f"{proto}://{fwd_host.split(',')[0].strip()}"
        return str(request.base_url).rstrip("/")

    async def _provision_corporate_admin(client: Dict[str, Any], actor: dict, request: Request) -> Dict[str, Any]:
        """Create/refresh the corporate_admin login user for this client and email
        a single-use set-password magic link. Reuses the existing magic-link flow
        (vendor_magic_links + /auth/magic/{token}). Idempotent + safe to resend."""
        email = (client.get("billing_contact_email") or client.get("contact_email") or "").strip().lower()
        if not email or "@" not in email:
            return {"skipped": True, "reason": "This client has no valid billing/contact email to send access to."}
        company_id = str(client["_id"])
        name = client.get("billing_contact_name") or client.get("contact_name") or client.get("name") or "there"

        existing = await db.users.find_one({"email": email})
        if existing and existing.get("role") in ("master_admin", "super_admin"):
            return {"skipped": True, "reason": f"{email} already belongs to a {existing.get('role')} account."}

        if existing:
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": {"role": "corporate_admin", "company_id": company_id, "is_active": True}},
            )
            admin_user_id = str(existing["_id"])
        else:
            import bcrypt as _bc
            placeholder = _bc.hashpw(secrets.token_urlsafe(24).encode(), _bc.gensalt()).decode()
            ins = await db.users.insert_one({
                "email": email,
                "password_hash": placeholder,
                "name": name,
                "role": "corporate_admin",
                "company_id": company_id,
                "is_active": True,
                "failed_attempts": 0,
                "created_at": datetime.now(timezone.utc),
                "created_via": "corporate_client_approval",
            })
            admin_user_id = str(ins.inserted_id)

        token = secrets.token_urlsafe(32)
        await db.vendor_magic_links.insert_one({
            "token": token,
            "vendor_user_id": admin_user_id,
            "vendor_id": None,
            "email": email,
            "purpose": "onboarding",
            "expires_at": None,
            "used_at": None,
            "created_by_admin": actor.get("id"),
            "created_at": datetime.now(timezone.utc),
        })
        magic_url = f"{_resolve_public_base(request)}/auth/magic/{token}"
        delivered = False
        try:
            import email_service as _es
            html, text = _es.render_corporate_admin_invite_email(
                name=name, company_name=client.get("name") or "your company", magic_url=magic_url,
            )
            res = _es.send_email(email, "Your Cravitoo admin access — set your password", html, text)
            delivered = bool(res[0]) if isinstance(res, tuple) else bool(res)
        except Exception as e:
            logger.warning(f"Corporate admin invite email failed for {email}: {e}")
        return {"skipped": False, "admin_email": email, "magic_url": magic_url,
                "token": token, "email_delivered": delivered}

    @r.get("/master/corporate-clients")
    async def list_clients(user: dict = Depends(get_current_user)):
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can view corporate clients")
        clients = await db.companies.find().sort("created_at", -1).to_list(500)
        return [_doc_to_dict(c) for c in clients]

    @r.post("/master/corporate-clients")
    async def create_client(data: CorporateClientCreate, user: dict = Depends(get_current_user)):
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can create corporate clients")
        # Duplicate name guard (case-insensitive)
        existing = await db.companies.find_one({"name": {"$regex": f"^{data.name.strip()}$", "$options": "i"}})
        if existing:
            raise HTTPException(status_code=400, detail=f"A corporate client named '{data.name}' already exists")
        now = datetime.now(timezone.utc)
        doc = {
            **data.model_dump(),
            "status": "active",  # legacy field kept for back-compat
            "lifecycle_status": "draft",
            "created_at": now,
            "lifecycle_updated_at": now,
            "lifecycle_history": [{"to": "draft", "by": user.get("id"), "by_name": user.get("name"), "at": now.isoformat()}],
        }
        result = await db.companies.insert_one(doc)
        return _doc_to_dict({"_id": result.inserted_id, **doc})

    @r.patch("/master/corporate-clients/{client_id}")
    async def update_client(client_id: str, data: CorporateClientUpdate, user: dict = Depends(get_current_user)):
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can edit corporate clients")
        update = {k: v for k, v in data.model_dump().items() if v is not None}
        if not update:
            raise HTTPException(status_code=400, detail="No fields to update")
        result = await db.companies.update_one(
            {"_id": safe_objectid(client_id, "Company")},
            {"$set": {**update, "updated_at": datetime.now(timezone.utc)}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Corporate client not found")
        client = await db.companies.find_one({"_id": safe_objectid(client_id, "Company")})
        return _doc_to_dict(client)

    @r.post("/master/corporate-clients/{client_id}/lifecycle")
    async def transition_lifecycle(client_id: str, payload: LifecycleTransition, request: Request, user: dict = Depends(get_current_user)):
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can change client lifecycle")
        target = payload.to.lower().strip()
        if target not in LIFECYCLE_ORDER:
            raise HTTPException(status_code=400, detail=f"`to` must be one of: {LIFECYCLE_ORDER}")

        client = await db.companies.find_one({"_id": safe_objectid(client_id, "Company")})
        if not client:
            raise HTTPException(status_code=404, detail="Corporate client not found")
        current = client.get("lifecycle_status", "active")
        if target == current:
            return {"message": f"Client is already '{current}'", "lifecycle_status": current}
        legal_next = LIFECYCLE_TRANSITIONS.get(current, set())
        if target not in legal_next:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{current}' to '{target}'. Valid next states: {sorted(legal_next)}",
            )

        now = datetime.now(timezone.utc)
        update: Dict[str, Any] = {
            "lifecycle_status": target,
            "lifecycle_updated_at": now,
        }
        if target == "approved":
            update["approved_at"] = now
            update["approved_by"] = user.get("id")
        if target == "active":
            update["activated_at"] = now
        history_entry = {
            "to": target,
            "by": user.get("id"),
            "by_name": user.get("name"),
            "remarks": payload.remarks or "",
            "at": now.isoformat(),
        }
        await db.companies.update_one(
            {"_id": client["_id"]},
            {"$set": update, "$push": {"lifecycle_history": history_entry}},
        )

        # On 'approved': provision the Corporate Admin login + email a one-time
        # set-password link (reuses the existing magic-link flow). This replaces
        # the old welcome email that created no account.
        provision = None
        if target == "approved":
            provision = await _provision_corporate_admin(client, user, request)

        resp: Dict[str, Any] = {
            "message": f"Lifecycle moved to '{target}'",
            "lifecycle_status": target,
        }
        if provision is not None:
            resp["admin_provisioned"] = not provision.get("skipped")
            resp["email_delivered"] = provision.get("email_delivered", False)
            resp["welcome_email_sent"] = provision.get("email_delivered", False)  # back-compat
            if provision.get("skipped"):
                resp["provision_skipped_reason"] = provision.get("reason")
            else:
                resp["admin_email"] = provision.get("admin_email")
                resp["magic_url"] = provision.get("magic_url")
                resp["token"] = provision.get("token")
        return resp

    @r.post("/master/corporate-clients/{client_id}/resend-admin-invite")
    async def resend_admin_invite(client_id: str, request: Request, user: dict = Depends(get_current_user)):
        """Re-issue the Corporate Admin set-password link and email it again.
        Also returns the link so the master can copy it directly (Master only)."""
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can resend admin invites")
        client = await db.companies.find_one({"_id": safe_objectid(client_id, "Company")})
        if not client:
            raise HTTPException(status_code=404, detail="Corporate client not found")
        result = await _provision_corporate_admin(client, user, request)
        if result.get("skipped"):
            raise HTTPException(status_code=400, detail=result.get("reason") or "Could not create the admin account")
        return {"success": True, **result}

    @r.delete("/master/corporate-clients/{client_id}")
    async def delete_client(
        client_id: str,
        cascade: bool = False,
        user: dict = Depends(get_current_user),
    ):
        """Hard-delete a corporate client.

        - Default behaviour blocks deletion if employees are still linked.
        - Pass `?cascade=true` to also delete linked employees, sites and
          the client's data. Master Admin only.
        """
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can delete corporate clients")
        client = await db.companies.find_one({"_id": safe_objectid(client_id, "Company")})
        if not client:
            raise HTTPException(status_code=404, detail="Corporate client not found")

        emp_count = await db.users.count_documents({"company_id": client_id})
        if emp_count > 0 and not cascade:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot delete: {emp_count} employees are still linked. "
                    "Re-issue the request with ?cascade=true to hard-delete them."
                ),
            )

        removed: Dict[str, int] = {}
        if cascade:
            removed["users"] = (await db.users.delete_many({"company_id": client_id})).deleted_count
            # Cascade sites belonging to this company — reuse orders/mappings cleanup
            site_ids = [str(s["_id"]) async for s in db.sites.find({"company_id": client_id}, {"_id": 1})]
            if site_ids:
                order_ids = [str(o["_id"]) async for o in db.orders.find(
                    {"site_id": {"$in": site_ids}}, {"_id": 1}
                )]
                if order_ids:
                    removed["order_status_history"] = (await db.order_status_history.delete_many(
                        {"order_id": {"$in": order_ids}}
                    )).deleted_count
                    removed["payment_transactions"] = (await db.payment_transactions.delete_many(
                        {"order_id": {"$in": order_ids}}
                    )).deleted_count
                removed["orders"] = (await db.orders.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["reservations"] = (await db.reservations.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["pre_order_reservations"] = (await db.pre_order_reservations.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["menu_items"] = (await db.menu_items.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["vendor_site_mappings"] = (await db.vendor_site_mappings.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["meal_schedules"] = (await db.meal_schedules.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["vendor_onboarding"] = (await db.vendor_onboarding.delete_many(
                    {"site_id": {"$in": site_ids}}
                )).deleted_count
                removed["sites"] = (await db.sites.delete_many(
                    {"company_id": client_id}
                )).deleted_count
            removed["allowed_domains"] = (await db.allowed_domains.delete_many(
                {"company_id": client_id}
            )).deleted_count
            removed["invoices"] = (await db.invoices.delete_many(
                {"client_id": client_id}
            )).deleted_count

        result = await db.companies.delete_one({"_id": client["_id"]})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Corporate client not found")
        return {"ok": True, "removed": removed}

    return r
