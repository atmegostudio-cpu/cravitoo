"""Admin router — master-admin vendor management, data-integrity repair tools,
and vendor onboarding resend / email-log.

Extracted from server.py (Jun 2026 refactor). Shared primitives are injected
via make_router(...) so behaviour is identical to the inline routes it replaces.
"""
from __future__ import annotations

import os
import io
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from pydantic import BaseModel, EmailStr
from models import CityAdminCreate

logger = logging.getLogger(__name__)


class _ResendOnboardingBody(BaseModel):
    email: Optional[str] = None   # override / fill-in


class _TestEmailBody(BaseModel):
    to: EmailStr


def _generate_magic_token() -> str:
    return secrets.token_urlsafe(32)


def make_router(db, safe_objectid, get_current_user, is_master_admin, audit_log,
                is_master_or_super=None, hash_password=None):
    r = APIRouter()

    async def _log_vendor_email(vendor_id: str, email: str, subject: str,
                                status: str, message_id: Optional[str],
                                error: Optional[str], sent_by_admin: str):
        await db.vendor_email_log.insert_one({
            "vendor_id": vendor_id,
            "email": email,
            "subject": subject,
            "status": status,             # 'sent' | 'failed' | 'no_email_on_file'
            "message_id": message_id,
            "error": error,
            "sent_by_admin": sent_by_admin,
            "created_at": datetime.now(timezone.utc),
        })

    @r.patch("/admin/vendors/{vendor_id}/commission")
    async def set_vendor_commission(vendor_id: str, payload: Dict[str, Any], user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        pct = payload.get("commission_pct")
        if pct is None or not isinstance(pct, (int, float)) or pct < 0 or pct > 50:
            raise HTTPException(status_code=400, detail="commission_pct must be between 0 and 50")
        await db.vendors.update_one({"_id": safe_objectid(vendor_id, "Vendor")}, {"$set": {"commission_pct": float(pct)}})
        return {"vendor_id": vendor_id, "commission_pct": float(pct)}

    @r.patch("/admin/vendors/{vendor_id}")
    async def update_vendor(vendor_id: str, payload: Dict[str, Any], user: dict = Depends(get_current_user)):
        """Master admin edits vendor profile (name, cuisine, contact, address, status)."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        allowed = {"name", "description", "cuisine_type", "phone", "email", "address",
                   "status", "commission_pct", "image_url"}
        cleaned = {k: v for k, v in payload.items() if k in allowed}
        if not cleaned:
            raise HTTPException(status_code=400, detail="No valid fields")
        if "commission_pct" in cleaned:
            v = float(cleaned["commission_pct"])
            if v < 0 or v > 50:
                raise HTTPException(status_code=400, detail="commission_pct must be between 0 and 50")
            cleaned["commission_pct"] = v
        if "status" in cleaned and cleaned["status"] not in ("active", "inactive", "suspended"):
            raise HTTPException(status_code=400, detail="status must be active|inactive|suspended")
        # Mirror canonical (`email`/`phone`) into legacy (`contact_email`/`contact_phone`)
        # so older readers stay consistent after an edit.
        if "email" in cleaned:
            cleaned["contact_email"] = cleaned["email"]
        if "phone" in cleaned:
            cleaned["contact_phone"] = cleaned["phone"]
        await db.vendors.update_one({"_id": safe_objectid(vendor_id, "Vendor")}, {"$set": cleaned})

        # Cascade status → vendor_site_mappings. Suspending or inactivating a
        # vendor must remove them from every site's vendor list. Reactivating
        # restores their mappings. Without this, a stale mapping row (created
        # months ago or by the demo seed) can keep an "unassigned" vendor
        # appearing under a site.
        if "status" in cleaned:
            new_status = cleaned["status"]
            if new_status in ("inactive", "suspended"):
                await db.vendor_site_mappings.update_many(
                    {"vendor_id": vendor_id, "status": "active"},
                    {"$set": {"status": "inactive",
                              "deactivated_at": datetime.now(timezone.utc),
                              "deactivated_by": user["id"]}},
                )
            elif new_status == "active":
                await db.vendor_site_mappings.update_many(
                    {"vendor_id": vendor_id, "status": "inactive"},
                    {"$set": {"status": "active"},
                     "$unset": {"deactivated_at": "", "deactivated_by": ""}},
                )

        await audit_log(user, "vendor", vendor_id, "updated", cleaned)
        return {"message": "Vendor updated"}

    @r.post("/admin/vendor-site-mappings/sanitize")
    async def sanitize_vendor_site_mappings(user: dict = Depends(get_current_user)):
        """One-shot cleanup: marks every mapping pointing to a non-existent or
        non-active vendor as 'inactive'. Safe to call multiple times.
        Returns the counts so admin can see what was fixed."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        # Get IDs of all currently-active vendors
        active_vendors = await db.vendors.find({"status": "active"}, {"_id": 1}).to_list(10000)
        active_vendor_ids = {str(v["_id"]) for v in active_vendors}

        stale_cur = db.vendor_site_mappings.find({"status": "active"})
        stale_updates = 0
        async for m in stale_cur:
            if m.get("vendor_id") not in active_vendor_ids:
                await db.vendor_site_mappings.update_one(
                    {"_id": m["_id"]},
                    {"$set": {"status": "inactive",
                              "deactivated_at": datetime.now(timezone.utc),
                              "deactivated_by": user["id"],
                              "deactivation_reason": "vendor_not_active"}},
                )
                stale_updates += 1
        await audit_log(user, "vendor_site_mapping", "*", "sanitized",
                        {"stale_mappings_deactivated": stale_updates})
        return {"success": True, "stale_mappings_deactivated": stale_updates}

    @r.post("/admin/integrity/backfill-orders")
    async def backfill_order_links(user: dict = Depends(get_current_user)):
        """Master-admin one-shot repair: stamp `site_id` + `company_id` on any
        legacy order that is missing them, so orders link up the full hierarchy
        (Client → City → Site → ... → Order). Safe / idempotent — re-runnable.

        Resolution order for each order:
          1. From the ordering employee's user record (`user_id`).
          2. Fallback: from the vendor's UNIQUE active site mapping (single-site
             vendors), then company from that site.
        """
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        site_company_cache: dict = {}

        async def _company_for_site(sid: str):
            if not sid:
                return None
            if sid in site_company_cache:
                return site_company_cache[sid]
            s = await db.sites.find_one({"_id": safe_objectid(sid, "Site")}, {"company_id": 1})
            cid = (s or {}).get("company_id")
            site_company_cache[sid] = cid
            return cid

        scanned = 0
        fixed_site = 0
        fixed_company = 0
        unresolved = 0
        cursor = db.orders.find({"$or": [{"site_id": {"$in": [None, ""]}}, {"site_id": {"$exists": False}},
                                         {"company_id": {"$in": [None, ""]}}, {"company_id": {"$exists": False}}]})
        async for o in cursor:
            scanned += 1
            site_id = o.get("site_id")
            company_id = o.get("company_id")

            # 1. From the ordering employee.
            if (not site_id or not company_id) and o.get("user_id"):
                u = await db.users.find_one({"_id": safe_objectid(o["user_id"], "User")},
                                            {"site_id": 1, "company_id": 1}) if len(str(o.get("user_id"))) == 24 else None
                if u:
                    site_id = site_id or u.get("site_id")
                    company_id = company_id or u.get("company_id")

            # 2. Fallback from the vendor's unique active mapping.
            if not site_id and o.get("vendor_id"):
                maps = await db.vendor_site_mappings.find(
                    {"vendor_id": o["vendor_id"], "status": "active"}, {"site_id": 1}
                ).to_list(5)
                if len(maps) == 1:
                    site_id = maps[0].get("site_id")

            if not company_id and site_id:
                company_id = await _company_for_site(site_id)

            update: dict = {}
            if site_id and not o.get("site_id"):
                update["site_id"] = site_id
                fixed_site += 1
            if company_id and not o.get("company_id"):
                update["company_id"] = company_id
                fixed_company += 1
            if update:
                await db.orders.update_one({"_id": o["_id"]}, {"$set": update})
            elif not site_id and not company_id:
                unresolved += 1

        await audit_log(user, "orders", "*", "backfilled_links",
                        {"scanned": scanned, "fixed_site": fixed_site,
                         "fixed_company": fixed_company, "unresolved": unresolved})
        return {"success": True, "scanned": scanned, "fixed_site": fixed_site,
                "fixed_company": fixed_company, "unresolved": unresolved}

    @r.post("/admin/integrity/backfill-sites")
    async def backfill_site_links(user: dict = Depends(get_current_user)):
        """Master-admin one-shot repair: relink any Site missing `company_id` or
        `city_id`. Safe / idempotent.

        Resolution order for company_id:
          1. Most-common company_id among employees stationed at the site.
          2. An `allowed_domains` rule scoped to this site (its company_id).
          3. A `vendor_onboarding` row for this site (its company link, if any).
        city_id is then taken from the resolved company's own `city_id`, or from
        an `allowed_domains` rule for the site.
        """
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        from collections import Counter as _Counter

        scanned = 0
        fixed_company = 0
        fixed_city = 0
        unresolved = 0

        company_city_cache: dict = {}

        async def _city_for_company(cid: str):
            if not cid:
                return None
            if cid in company_city_cache:
                return company_city_cache[cid]
            co = await db.companies.find_one({"_id": safe_objectid(cid, "Company")}, {"city_id": 1})
            val = (co or {}).get("city_id")
            company_city_cache[cid] = val
            return val

        cursor = db.sites.find({"$or": [
            {"company_id": {"$in": [None, ""]}}, {"company_id": {"$exists": False}},
            {"city_id": {"$in": [None, ""]}}, {"city_id": {"$exists": False}},
        ]})
        async for s in cursor:
            scanned += 1
            sid = str(s["_id"])
            company_id = s.get("company_id")
            city_id = s.get("city_id")

            # 1. Employees at this site.
            if not company_id:
                emp_companies = [u.get("company_id") for u in await db.users.find(
                    {"site_id": sid, "role": "employee", "company_id": {"$nin": [None, ""]}},
                    {"company_id": 1}).to_list(2000)]
                if emp_companies:
                    company_id = _Counter(emp_companies).most_common(1)[0][0]

            # 2. allowed_domains scoped to site.
            if not company_id:
                ad = await db.allowed_domains.find_one({"site_id": sid, "company_id": {"$nin": [None, ""]}},
                                                       {"company_id": 1, "city_id": 1})
                if ad:
                    company_id = ad.get("company_id")
                    city_id = city_id or ad.get("city_id")

            # 3. vendor_onboarding for site.
            if not company_id:
                vo = await db.vendor_onboarding.find_one({"site_id": sid, "company_id": {"$nin": [None, ""]}},
                                                         {"company_id": 1, "city_id": 1})
                if vo:
                    company_id = vo.get("company_id")
                    city_id = city_id or vo.get("city_id")

            if not city_id and company_id:
                city_id = await _city_for_company(company_id)

            update: dict = {}
            if company_id and not s.get("company_id"):
                update["company_id"] = company_id
                fixed_company += 1
            if city_id and not s.get("city_id"):
                update["city_id"] = city_id
                fixed_city += 1
            if update:
                await db.sites.update_one({"_id": s["_id"]}, {"$set": update})
            elif not company_id and not city_id:
                unresolved += 1

        await audit_log(user, "sites", "*", "backfilled_links",
                        {"scanned": scanned, "fixed_company": fixed_company,
                         "fixed_city": fixed_city, "unresolved": unresolved})
        return {"success": True, "scanned": scanned, "fixed_company": fixed_company,
                "fixed_city": fixed_city, "unresolved": unresolved}

    @r.get("/admin/integrity/employee-menu-report")
    async def employee_menu_report(user: dict = Depends(get_current_user)):
        """Master-admin read-only diagnostic: which employees will see an empty
        menu, and why. Covers no-site, deleted-site, zero-active-vendor-mappings,
        domains missing a site_id, and vendors whose items are all unavailable."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        site_ids = {str(s["_id"]) for s in await db.sites.find({}, {"_id": 1}).to_list(5000)}
        active_by_site: dict = {}
        async for m in db.vendor_site_mappings.find({"status": "active"}, {"site_id": 1}):
            active_by_site[m.get("site_id")] = active_by_site.get(m.get("site_id"), 0) + 1

        no_site, deleted_site, zero_vendors = [], [], []
        async for u in db.users.find({"role": "employee"}, {"email": 1, "site_id": 1, "company_id": 1}):
            sid = u.get("site_id")
            rec = {"email": u.get("email"), "company_id": u.get("company_id"), "site_id": sid}
            if not sid:
                no_site.append(rec)
            elif sid not in site_ids:
                deleted_site.append(rec)
            elif active_by_site.get(sid, 0) == 0:
                zero_vendors.append(rec)

        domains_missing_site = []
        async for d in db.allowed_domains.find({"$or": [{"site_id": {"$in": [None, ""]}}, {"site_id": {"$exists": False}}]}):
            domains_missing_site.append({"domain": d.get("domain") or d.get("email"), "company_id": d.get("company_id")})

        vendors_all_unavailable = []
        async for v in db.vendors.find({"status": "active"}, {"name": 1}):
            vid = str(v["_id"])
            total = await db.menu_items.count_documents({"vendor_id": vid})
            avail = await db.menu_items.count_documents({"vendor_id": vid, "is_available": True})
            if total > 0 and avail == 0:
                vendors_all_unavailable.append({"vendor_id": vid, "name": v.get("name"), "items": total})

        return {
            "employees_no_site": no_site,
            "employees_site_deleted": deleted_site,
            "employees_zero_active_vendors": zero_vendors,
            "domains_missing_site_id": domains_missing_site,
            "vendors_all_items_unavailable": vendors_all_unavailable,
            "summary": {
                "no_site": len(no_site), "site_deleted": len(deleted_site),
                "zero_vendors": len(zero_vendors),
                "domains_missing_site_id": len(domains_missing_site),
                "vendors_all_unavailable": len(vendors_all_unavailable),
            },
        }

    @r.post("/admin/integrity/backfill-employee-sites")
    async def backfill_employee_sites(user: dict = Depends(get_current_user)):
        """Master-admin repair: set site_id on employees who are missing it.
        Resolution: (1) their email-domain rule's site_id, else (2) their company's
        UNIQUE site. Multi-site / no-company employees are returned as unresolved
        for manual assignment. Idempotent."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        from routers.allowed_domains import find_allowed_domain

        company_single_site: dict = {}

        async def _single_site_for_company(cid: str):
            if not cid:
                return None
            if cid in company_single_site:
                return company_single_site[cid]
            sites = await db.sites.find({"company_id": cid}, {"_id": 1}).to_list(5)
            val = str(sites[0]["_id"]) if len(sites) == 1 else None
            company_single_site[cid] = val
            return val

        fixed = 0
        unresolved = []
        async for u in db.users.find({"role": "employee", "$or": [{"site_id": {"$in": [None, ""]}}, {"site_id": {"$exists": False}}]},
                                     {"email": 1, "company_id": 1}):
            site_id = None
            dom = await find_allowed_domain(db, (u.get("email") or "").lower())
            if dom and dom.get("site_id"):
                site_id = dom.get("site_id")
            if not site_id:
                site_id = await _single_site_for_company(u.get("company_id"))
            if site_id:
                update = {"site_id": site_id}
                if not u.get("company_id"):
                    s = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")}, {"company_id": 1})
                    if s and s.get("company_id"):
                        update["company_id"] = s["company_id"]
                await db.users.update_one({"_id": u["_id"]}, {"$set": update})
                fixed += 1
            else:
                unresolved.append({"email": u.get("email"), "company_id": u.get("company_id")})

        await audit_log(user, "users", "*", "backfilled_employee_sites",
                        {"fixed": fixed, "unresolved": len(unresolved)})
        return {"success": True, "fixed": fixed, "unresolved": unresolved}

    @r.get("/admin/integrity/employee-visibility")
    async def employee_visibility_trace(email: str, user: dict = Depends(get_current_user)):
        """Master-admin: trace the full Client→Site→Vendor→Menu chain for ONE
        employee and pinpoint exactly why they can/can't see a menu."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        emp = await db.users.find_one({"email": (email or "").lower().strip(), "role": "employee"})
        if not emp:
            raise HTTPException(status_code=404, detail=f"No employee found with email {email}")

        trace: dict = {"email": emp.get("email"), "company_id": emp.get("company_id"), "site_id": emp.get("site_id")}
        site_id = emp.get("site_id")
        resolved_via_fallback = False

        # Mirror the runtime single-site fallback used by GET /vendors.
        if not site_id and emp.get("company_id"):
            csites = await db.sites.find({"company_id": emp["company_id"]}, {"_id": 1}).to_list(5)
            if len(csites) == 1:
                site_id = str(csites[0]["_id"])
                resolved_via_fallback = True
        trace["effective_site_id"] = site_id
        trace["resolved_via_single_site_fallback"] = resolved_via_fallback

        if not site_id:
            trace["verdict"] = "NO_SITE — employee has no site_id and no unique company site. Assign a site (run backfill-employee-sites or set manually)."
            return trace

        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            trace["verdict"] = f"SITE_NOT_FOUND — site_id {site_id} does not exist (stale/deleted). Reassign the employee to a valid site."
            return trace
        trace["site_name"] = site.get("name")
        trace["site_lifecycle_status"] = site.get("lifecycle_status", "live")

        maps = await db.vendor_site_mappings.find({"site_id": site_id, "status": "active"}).to_list(500)
        trace["active_mappings_on_site"] = len(maps)
        if not maps:
            # Is the vendor mapped but under a DIFFERENT site_id? Surface that.
            any_maps = await db.vendor_site_mappings.count_documents({"site_id": site_id})
            trace["verdict"] = ("NO_ACTIVE_VENDOR_MAPPINGS — this site has no active vendor mappings"
                                + (f" ({any_maps} inactive present)" if any_maps else "")
                                + ". Check the vendor is mapped to THIS exact site_id and the mapping status is 'active'.")
            return trace

        vendors_report = []
        visible = 0
        for m in maps:
            vid = m.get("vendor_id")
            v = await db.vendors.find_one({"_id": safe_objectid(vid, "Vendor")}, {"name": 1, "status": 1})
            total = await db.menu_items.count_documents({"vendor_id": vid})
            avail = await db.menu_items.count_documents({"vendor_id": vid, "is_available": True})
            v_active = bool(v) and v.get("status") == "active"
            row = {"vendor_id": vid, "name": (v or {}).get("name"), "vendor_status": (v or {}).get("status"),
                   "vendor_active": v_active, "menu_items_total": total, "menu_items_available": avail}
            if v_active and avail > 0:
                visible += 1
            vendors_report.append(row)
        trace["vendors"] = vendors_report
        trace["visible_vendor_count"] = visible

        if visible == 0:
            trace["verdict"] = ("MENU_EMPTY_OR_VENDOR_INACTIVE — vendors are mapped but either vendor.status != 'active' "
                                "or all their menu_items have is_available=false / none exist. Check vendor status and item availability.")
        else:
            trace["verdict"] = f"OK — this employee should see {visible} vendor(s) with a live menu. If they still can't, have them re-login (stale session/site_id in token)."
        return trace

    @r.post("/admin/vendors/{vendor_id}/resend-onboarding")
    async def resend_vendor_onboarding(
        vendor_id: str,
        body: _ResendOnboardingBody,
        request: Request,
        user: dict = Depends(get_current_user),
    ):
        """Master Admin only. Re-send the vendor's onboarding email as a one-tap
        magic-link. Optional `email` override handles typos / no-email-on-file
        onboarding records."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can resend onboarding")

        vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")

        # Rate-limit: max 3 sends per vendor per hour
        one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
        recent = await db.vendor_email_log.count_documents({
            "vendor_id": vendor_id,
            "status": "sent",
            "created_at": {"$gte": one_hour_ago},
        })
        if recent >= 3:
            raise HTTPException(status_code=429, detail="Too many resend attempts — please wait an hour")

        # Resolve target email — priority: body → linked user → vendor doc → onboarding doc
        override = (body.email or "").strip().lower()
        target_email = override
        if not target_email:
            vu = await db.users.find_one({"vendor_id": vendor_id, "role": "vendor"})
            if vu:
                target_email = (vu.get("email") or "").strip().lower()
        if not target_email:
            target_email = ((vendor.get("email") or vendor.get("contact_email") or "")).strip().lower()
        if not target_email:
            onb = await db.vendor_onboarding.find_one({"vendor_id": vendor_id})
            if onb:
                target_email = ((onb.get("email") or "")).strip().lower()
        if not target_email:
            await _log_vendor_email(vendor_id, "", "Resend attempted", "no_email_on_file", None,
                                    "No email available on any related record", user["id"])
            raise HTTPException(status_code=400,
                detail="This vendor has no email on file. Provide one in the request body: {\"email\": \"...\"}.")

        # Validate email
        if "@" not in target_email or " " in target_email:
            raise HTTPException(status_code=400, detail=f"Invalid email address: {target_email}")

        # Ensure a vendor user row exists (create if missing — mirrors approval flow)
        existing = await db.users.find_one({"email": target_email})
        if not existing:
            import secrets as _secrets
            try:
                from passlib.hash import bcrypt as _bcrypt
                pwd_hash = _bcrypt.hash(_secrets.token_urlsafe(24))
            except Exception:
                pwd_hash = ""
            insert_res = await db.users.insert_one({
                "email": target_email,
                "password_hash": pwd_hash,
                "name": vendor.get("contact_person") or vendor.get("name") or "Vendor",
                "role": "vendor",
                "vendor_id": vendor_id,
                "created_at": datetime.now(timezone.utc),
                "failed_attempts": 0,
                "is_active": True,
                "created_via": "admin_resend_onboarding",
            })
            vendor_user_id = str(insert_res.inserted_id)
        else:
            # Ensure the existing user is linked to this vendor + reactivated
            await db.users.update_one({"_id": existing["_id"]},
                {"$set": {"vendor_id": vendor_id, "role": "vendor", "is_active": True}})
            vendor_user_id = str(existing["_id"])

        # Optionally sync the email onto the vendor doc if the admin overrode it
        if override and override != (vendor.get("email") or "").strip().lower():
            await db.vendors.update_one(
                {"_id": safe_objectid(vendor_id, "Vendor")},
                {"$set": {"email": override, "contact_email": override}},
            )

        # Create the magic link (single-use, no time expiry — vendor sets password on click)
        token = _generate_magic_token()
        await db.vendor_magic_links.insert_one({
            "token": token,
            "vendor_user_id": vendor_user_id,
            "vendor_id": vendor_id,
            "email": target_email,
            "purpose": "onboarding",       # 'onboarding' | 'password_reset'
            "expires_at": None,            # no expiry — invalid only after use
            "used_at": None,
            "created_by_admin": user["id"],
            "created_at": datetime.now(timezone.utc),
        })
        # Build the link base. Prefer PUBLIC_APP_URL; otherwise derive from the
        # request headers so the link opens in the SAME environment the admin is
        # using — no hardcoded production host. Try, in order: Origin →
        # X-Forwarded-Host/Proto → Referer → base_url (internal, last resort).
        # (The frontend ALSO rebuilds the copy-link from window.location.origin
        # using the returned `token`, so the admin copy-link is always correct
        # regardless of ingress header stripping.)
        public_base = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
        if not public_base:
            hdrs = request.headers
            origin = (hdrs.get("origin") or "").rstrip("/")
            fwd_host = hdrs.get("x-forwarded-host")
            referer = hdrs.get("referer") or ""
            if origin:
                public_base = origin
            elif fwd_host:
                proto = hdrs.get("x-forwarded-proto", "https")
                public_base = f"{proto}://{fwd_host.split(',')[0].strip()}"
            elif referer:
                from urllib.parse import urlparse
                p = urlparse(referer)
                if p.scheme and p.netloc:
                    public_base = f"{p.scheme}://{p.netloc}"
            if not public_base:
                public_base = str(request.base_url).rstrip("/")
        magic_url = f"{public_base}/auth/magic/{token}"

        # Send the ONE combined email
        subject = f"You're onboarded on Cravitoo — Set your Vendor Panel password"
        try:
            import email_service as _es
            html, text = _es.render_vendor_magic_link_email(
                name=vendor.get("contact_person") or vendor.get("name") or "Partner",
                vendor_name=vendor.get("name") or "your business",
                magic_url=magic_url,
            )
            # send_email returns (bool, error_message)
            result = _es.send_email(target_email, subject, html, text)
            # tuple unwrap
            if isinstance(result, tuple):
                success, err = result
            else:
                success, err = bool(result), None
        except Exception as e:
            success, err = False, str(e)

        await _log_vendor_email(
            vendor_id, target_email, subject,
            "sent" if success else "failed", None, err, user["id"],
        )
        await audit_log(user, "vendor", vendor_id,
                        "onboarding_resent" if success else "onboarding_resend_failed",
                        {"email": target_email, "error": err if not success else None})

        # Always hand the working link back to the admin. Email delivery is
        # unreliable (corporate filters, SafeLinks/Mimecast rewriting, WhatsApp
        # truncation) — so even if the email fails, the admin can copy this exact
        # link and give it to the vendor directly. The link is single-use +
        # non-expiring, and only consumed when the vendor sets their password.
        return {
            "success": True,
            "delivered_to": target_email,
            "email_delivered": bool(success),
            "magic_url": magic_url,
            "token": token,
            "message": (
                f"Onboarding link emailed to {target_email}. "
                f"You can also copy the link below and send it directly."
                if success else
                f"Couldn't email {target_email} ({err or 'delivery failed'}). "
                f"Copy the link below and send it to the vendor directly — it works the same way."
            ),
        }

    @r.get("/admin/vendors/email-status")
    async def vendors_email_status(user: dict = Depends(get_current_user)):
        """Latest onboarding-email status per vendor (Master Admin only) so the
        Vendors list can badge Delivered / Failed / No-email at a glance."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        pipeline = [
            {"$sort": {"created_at": -1}},
            {"$group": {"_id": "$vendor_id",
                        "status": {"$first": "$status"},
                        "error": {"$first": "$error"},
                        "at": {"$first": "$created_at"}}},
        ]
        out = {}
        async for row in db.vendor_email_log.aggregate(pipeline):
            out[row["_id"]] = {
                "status": row.get("status"),
                "error": row.get("error"),
                "at": row["at"].isoformat() if row.get("at") else None,
            }
        return out

    @r.get("/admin/vendors/{vendor_id}/email-log")
    async def vendor_email_log(vendor_id: str, user: dict = Depends(get_current_user)):
        """Last 10 resend attempts for a vendor (Master Admin only)."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        rows = await db.vendor_email_log.find({"vendor_id": vendor_id}).sort("created_at", -1).limit(10).to_list(10)
        return [{
            "email": r.get("email"),
            "subject": r.get("subject"),
            "status": r.get("status"),
            "error": r.get("error"),
            "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
        } for r in rows]

    @r.post("/admin/email/send-test")
    async def send_test_email(body: _TestEmailBody, user: dict = Depends(get_current_user)):
        """Master-Admin-only real send probe via Resend."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can send test emails")

        from email_service import send_email
        subject = "Cravitoo — Email health check"
        html = f"""
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: auto; padding: 24px;">
          <h2 style="color:#DC5A2E;">Cravitoo Email Delivery Confirmed ✓</h2>
          <p>If you're reading this in your inbox (not spam), the following are working end-to-end:</p>
          <ul>
            <li><strong>Resend API key</strong> — accepted</li>
            <li><strong>Sender domain</strong> — <code>{os.environ.get("RESEND_FROM_EMAIL", "unset")}</code></li>
            <li><strong>SPF + DKIM</strong> — passed (else this mail would be in spam)</li>
            <li><strong>Recipient allowlist</strong> — corporate email gateway is not blocking Cravitoo</li>
          </ul>
          <p style="color:#666;font-size:13px;margin-top:24px;">
            Triggered by <strong>{user.get("email")}</strong> at
            {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}.
          </p>
        </div>
        """
        text_fallback = (
            "Cravitoo Email Delivery Confirmed. "
            f"Sender: {os.environ.get('RESEND_FROM_EMAIL')}. "
            f"Triggered by {user.get('email')}."
        )
        ok, err = send_email(body.to, subject, html, text=text_fallback)
        if not ok:
            raise HTTPException(status_code=502, detail=f"Resend rejected the send: {err}")
        from_email = os.environ.get("RESEND_FROM_EMAIL") or ""
        from_domain = from_email.split("@", 1)[-1] if "@" in from_email else from_email
        return {
            "sent": True,
            "to": body.to,
            "from": from_email,
            "message": (
                f"Sent from {from_email}. Check inbox in ~30 seconds. "
                f"If it lands in Spam, ask the recipient's IT to allowlist "
                f"the sender and the domain '{from_domain}'."
            ),
        }

    @r.get("/admin/ai-photos/spend")
    async def ai_photo_spend(user: dict = Depends(get_current_user)):
        """Master Admin cost tracker for AI-generated menu photos."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")

        PRICE_PER_IMAGE_INR = 3.5
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_30 = now - timedelta(days=30)

        async def _sum(match: dict):
            """Return (rows, images) for the given match filter. Excludes free-source rows."""
            paid_match = {**match, "cost_inr": {"$ne": 0}}
            pipeline = [
                {"$match": paid_match},
                {"$group": {
                    "_id": None,
                    "rows": {"$sum": 1},
                    "images": {
                        "$sum": {
                            "$ifNull": [
                                "$count_generated",
                                {"$ifNull": ["$filled", 0]},
                            ]
                        },
                    },
                }},
            ]
            agg = await db.ai_image_generations.aggregate(pipeline).to_list(1)
            if not agg:
                return 0, 0
            return int(agg[0].get("rows", 0)), int(agg[0].get("images", 0))

        mtd_rows, mtd_images = await _sum({"created_at": {"$gte": month_start}})
        l30_rows, l30_images = await _sum({"created_at": {"$gte": last_30}})
        all_rows, all_images = await _sum({})

        return {
            "price_per_image_inr": PRICE_PER_IMAGE_INR,
            "month_to_date": {
                "rows": mtd_rows,
                "images": mtd_images,
                "spend_inr": round(mtd_images * PRICE_PER_IMAGE_INR, 2),
                "since": month_start.isoformat(),
            },
            "last_30_days": {
                "rows": l30_rows,
                "images": l30_images,
                "spend_inr": round(l30_images * PRICE_PER_IMAGE_INR, 2),
            },
            "all_time": {
                "rows": all_rows,
                "images": all_images,
                "spend_inr": round(all_images * PRICE_PER_IMAGE_INR, 2),
            },
        }

    @r.post("/admin/menu-items/reclassify-veg")
    async def menu_items_reclassify_veg(
        vendor_id: Optional[str] = None,
        site_id: Optional[str] = None,
        overwrite: bool = False,
        user: dict = Depends(get_current_user),
    ):
        """Re-run the veg / non-veg classifier over live menu_items rows. Master admin only."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        from veg_classifier import classify_veg
        q: dict = {}
        if vendor_id:
            q["vendor_id"] = vendor_id
        if site_id:
            q["site_id"] = site_id
        changed = 0
        total = 0
        async for row in db.menu_items.find(q, {"_id": 1, "name": 1, "description": 1, "is_vegetarian": 1}):
            total += 1
            current = row.get("is_vegetarian")
            if not overwrite and current is not None:
                continue
            predicted = classify_veg(row.get("name", ""), row.get("description", ""))
            if bool(current) != predicted:
                await db.menu_items.update_one(
                    {"_id": row["_id"]},
                    {"$set": {"is_vegetarian": predicted}},
                )
                changed += 1
        await audit_log(user, "menu_items", "bulk", "reclassified_veg",
                        {"scope": q, "changed": changed, "total": total, "overwrite": overwrite})
        return {"changed": changed, "total": total, "scope": q, "overwrite": overwrite}

    @r.post("/admin/menu-items/reclassify-allergens")
    async def menu_items_reclassify_allergens(
        vendor_id: Optional[str] = None,
        site_id: Optional[str] = None,
        overwrite: bool = False,
        user: dict = Depends(get_current_user),
    ):
        """Re-run the allergen classifier over live menu_items rows. Master admin only."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        from allergen_classifier import classify_allergens
        q: dict = {}
        if vendor_id:
            q["vendor_id"] = vendor_id
        if site_id:
            q["site_id"] = site_id
        changed = 0
        total = 0
        async for row in db.menu_items.find(q, {"_id": 1, "name": 1, "description": 1, "allergens": 1}):
            total += 1
            current = row.get("allergens") or []
            if not overwrite and isinstance(current, list) and len(current) > 0:
                continue
            predicted = classify_allergens(row.get("name", ""), row.get("description", ""))
            if list(current) != predicted:
                await db.menu_items.update_one(
                    {"_id": row["_id"]},
                    {"$set": {"allergens": predicted}},
                )
                changed += 1
        await audit_log(user, "menu_items", "bulk", "reclassified_allergens",
                        {"scope": q, "changed": changed, "total": total, "overwrite": overwrite})
        return {"changed": changed, "total": total, "scope": q}

    @r.post("/admin/users/{user_id}/deactivate")
    async def deactivate_user(user_id: str, admin: dict = Depends(get_current_user)):
        """Immediately end the target user's session and prevent future logins. Master/Super Admin only."""
        if not is_master_or_super(admin):
            raise HTTPException(status_code=403, detail="Only master/super admin")
        if user_id == admin["id"]:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
        target = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("role") == "master_admin":
            raise HTTPException(status_code=400, detail="Cannot deactivate a master admin")
        await db.users.update_one(
            {"_id": target["_id"]},
            {"$set": {"is_active": False, "deactivated_at": datetime.now(timezone.utc), "deactivated_by": admin["id"]}},
        )
        await audit_log(admin, "user", user_id, "deactivated",
                        {"email": target.get("email"), "role": target.get("role")})
        return {"ok": True, "user_id": user_id, "is_active": False}

    @r.post("/admin/users/{user_id}/reactivate")
    async def reactivate_user(user_id: str, admin: dict = Depends(get_current_user)):
        """Re-enable a previously deactivated user. Master/Super Admin only."""
        if not is_master_or_super(admin):
            raise HTTPException(status_code=403, detail="Only master/super admin")
        target = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"_id": target["_id"]},
            {"$set": {"is_active": True}, "$unset": {"deactivated_at": "", "deactivated_by": ""}},
        )
        await audit_log(admin, "user", user_id, "reactivated", {"email": target.get("email")})
        return {"ok": True, "user_id": user_id, "is_active": True}

    @r.post("/admin/city-admins")
    async def create_city_admin(data: CityAdminCreate, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin")
        email_lower = data.email.lower()
        if await db.users.find_one({"email": email_lower}):
            raise HTTPException(status_code=400, detail="Email already registered")
        city = await db.cities.find_one({"_id": safe_objectid(data.city_id, "City")})
        if not city:
            raise HTTPException(status_code=404, detail="City not found")
        res = await db.users.insert_one({
            "email": email_lower,
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": "city_admin",
            "city_id": data.city_id,
            "created_at": datetime.now(timezone.utc),
            "failed_attempts": 0,
        })
        user_id = str(res.inserted_id)
        await audit_log(user, "user", user_id, "created_city_admin", {"city_id": data.city_id, "email": email_lower})
        # Best-effort invitation email — never roll back the creation if email fails
        try:
            import email_service as _email_service
            inv_html, inv_text = _email_service.render_invitation_email(name=data.name, email=email_lower, role="city_admin")
            _email_service.send_email(email_lower, "Welcome to Cravitoo — your account is ready", inv_html, inv_text)
        except Exception as e:
            logger.warning(f"City admin invite email failed for {email_lower}: {e}")
        return {"id": user_id, "email": email_lower, "role": "city_admin", "city_id": data.city_id, "invite_sent": True}

    @r.post("/admin/employees/bulk-csv")
    async def bulk_employee_csv(
        file: UploadFile = File(...),
        company_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        """Corporate admin or master uploads CSV with columns: email,name,password,phone (optional)."""
        if user["role"] not in ("corporate_admin", "master_admin"):
            raise HTTPException(status_code=403, detail="Only corporate or master admin")
        if not (file.filename or "").lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="File must be a .csv")
        content = (await file.read()).decode("utf-8", errors="ignore")
        if len(content) > 1 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="CSV must be under 1 MB")

        cid = company_id or user.get("company_id")
        if not cid:
            raise HTTPException(status_code=400, detail="company_id required")

        import csv
        reader = csv.DictReader(io.StringIO(content))
        inserted, errors = 0, []
        for idx, row in enumerate(reader, start=2):
            email = (row.get("email") or "").strip().lower()
            name = (row.get("name") or "").strip()
            pwd = (row.get("password") or "").strip()
            if not email or not name or len(pwd) < 6:
                errors.append({"row": idx, "error": "missing email/name or password<6"})
                continue
            if await db.users.find_one({"email": email}):
                errors.append({"row": idx, "error": f"email {email} exists"})
                continue
            try:
                await db.users.insert_one({
                    "email": email,
                    "name": name,
                    "password_hash": hash_password(pwd),
                    "role": "employee",
                    "company_id": cid,
                    "site_id": (row.get("site_id") or "").strip() or None,
                    "phone": (row.get("phone") or "").strip() or None,
                    "preferences": {"vegetarian": False, "vegan": False, "gluten_free": False, "dairy_free": False, "nut_free": False, "spicy_preference": "medium", "allergies": [], "preferred_cuisines": []},
                    "created_at": datetime.now(timezone.utc),
                    "failed_attempts": 0,
                })
                inserted += 1
            except Exception as e:
                errors.append({"row": idx, "error": str(e)})

        return {"inserted": inserted, "errors": errors, "total_attempted": inserted + len(errors)}

    return r
