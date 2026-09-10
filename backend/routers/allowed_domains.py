"""
Allowed corporate domains.

Restricts employee signup to corporate emails only. Master Admin manages
the allowlist; signup endpoints check the domain before creating accounts.

Endpoints:
  GET    /api/admin/allowed-domains       — list all (Master Admin)
  POST   /api/admin/allowed-domains       — add a new domain
  DELETE /api/admin/allowed-domains/{id}  — remove a domain
  GET    /api/auth/check-domain/{domain}  — public: check if a domain is allowed (used by signup UI)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Free-email providers that are always blocked (defence-in-depth)
BLOCKED_FREE_DOMAINS = {
    "gmail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com",
    "live.com", "icloud.com", "aol.com", "protonmail.com", "rediffmail.com",
    "mail.com", "zoho.com", "yandex.com",
}


class AllowedDomainCreate(BaseModel):
    domain: str = Field(..., min_length=3, max_length=120)
    company_id: Optional[str] = Field(None, description="Auto-link signups from this domain to this company")
    site_id: Optional[str] = Field(None, description="Optionally pre-assign new employees to a default site")
    notes: Optional[str] = Field(None, max_length=200)


def normalize_domain(domain: str) -> str:
    d = (domain or "").strip().lower()
    if d.startswith("@"):
        d = d[1:]
    if d.startswith("http://") or d.startswith("https://"):
        d = d.split("://", 1)[1]
    d = d.split("/")[0]
    return d


def email_domain(email: str) -> str:
    if not email or "@" not in email:
        return ""
    return email.rsplit("@", 1)[1].lower().strip()


async def find_allowed_domain(db, email: str) -> Optional[dict]:
    """Returns the allowed_domains record if the email's domain is in the allowlist.
    None means signup should be REJECTED."""
    domain = email_domain(email)
    if not domain or domain in BLOCKED_FREE_DOMAINS:
        return None
    return await db.allowed_domains.find_one({"domain": domain})


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    @r.get("/admin/allowed-domains")
    async def list_allowed_domains(user: dict = Depends(get_current_user)):
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        cursor = db.allowed_domains.find({}).sort("created_at", -1).limit(500)
        out = []
        async for d in cursor:
            # Resolve names for nicer display. If a domain has no direct company_id
            # but its default site belongs to a company, surface that (via_site).
            company_name = None
            company_id = d.get("company_id")
            company_via_site = False
            site_name = None
            site_company_id = None
            site_status = None
            if d.get("site_id"):
                s = await db.sites.find_one({"_id": safe_objectid(d["site_id"], "Site")})
                if s:
                    site_name = s.get("name")
                    site_company_id = s.get("company_id")
                    site_status = s.get("lifecycle_status")
            if company_id:
                co = await db.companies.find_one({"_id": safe_objectid(company_id, "Company")})
                if co:
                    company_name = co.get("name")
            elif site_company_id:
                co = await db.companies.find_one({"_id": safe_objectid(site_company_id, "Company")})
                if co:
                    company_name = co.get("name")
                    company_via_site = True
            out.append({
                "id": str(d["_id"]),
                "domain": d.get("domain"),
                "company_id": company_id,
                "company_name": company_name,
                "company_via_site": company_via_site,
                "can_backfill": bool(not company_id and site_company_id),
                "site_id": d.get("site_id"),
                "site_name": site_name,
                "site_status": site_status,
                "notes": d.get("notes", ""),
                "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
                "created_by": d.get("created_by_email"),
            })
        return out

    @r.post("/admin/allowed-domains")
    async def add_allowed_domain(data: AllowedDomainCreate, user: dict = Depends(get_current_user)):
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        domain = normalize_domain(data.domain)
        if not domain or "." not in domain:
            raise HTTPException(status_code=400, detail="Invalid domain — must be like 'company.com'")
        if domain in BLOCKED_FREE_DOMAINS:
            raise HTTPException(status_code=400, detail=f"'{domain}' is a free-email provider and cannot be added")
        if await db.allowed_domains.find_one({"domain": domain}):
            raise HTTPException(status_code=400, detail=f"Domain '{domain}' is already in the allowlist")
        # Validate references
        if data.company_id:
            co = await db.companies.find_one({"_id": safe_objectid(data.company_id, "Company")})
            if not co:
                raise HTTPException(status_code=404, detail="Company not found")
        if data.site_id:
            s = await db.sites.find_one({"_id": safe_objectid(data.site_id, "Site")})
            if not s:
                raise HTTPException(status_code=404, detail="Site not found")
        doc = {
            "domain": domain,
            "company_id": data.company_id,
            "site_id": data.site_id,
            "notes": (data.notes or "").strip(),
            "created_at": datetime.now(timezone.utc),
            "created_by": user["id"],
            "created_by_email": user.get("email"),
        }
        res = await db.allowed_domains.insert_one(doc)
        return {"id": str(res.inserted_id), "domain": domain, "message": "Domain added to allowlist"}

    @r.delete("/admin/allowed-domains/{domain_id}")
    async def delete_allowed_domain(domain_id: str, user: dict = Depends(get_current_user)):
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        d = await db.allowed_domains.find_one({"_id": safe_objectid(domain_id, "Domain")})
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found")
        await db.allowed_domains.delete_one({"_id": d["_id"]})
        return {"message": f"Removed '{d.get('domain')}' from allowlist"}

    @r.get("/auth/check-domain/{domain}")
    async def check_domain(domain: str):
        """Public endpoint — used by signup form to show '✓ Allowed' or '✗ Use your work email'."""
        norm = normalize_domain(domain)
        if not norm:
            return {"allowed": False, "reason": "invalid"}
        if norm in BLOCKED_FREE_DOMAINS:
            return {"allowed": False, "reason": "free_provider"}
        rec = await db.allowed_domains.find_one({"domain": norm})
        if rec:
            company_name = None
            if rec.get("company_id"):
                co = await db.companies.find_one({"_id": safe_objectid(rec["company_id"], "Company")})
                if co:
                    company_name = co.get("name")
            return {"allowed": True, "company_name": company_name}
        return {"allowed": False, "reason": "not_in_allowlist"}

    @r.get("/admin/allowed-domains/test")
    async def test_domain_mapping(email: str = "", user: dict = Depends(get_current_user)):
        """Preview which company + site a new employee on this email/domain would map to."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        raw = (email or "").strip().lower()
        if raw and "@" not in raw:
            raw = f"someone@{normalize_domain(raw)}"
        dom = email_domain(raw)
        if not dom:
            return {"allowed": False, "reason": "invalid", "message": "Enter a valid work email or domain."}
        if dom in BLOCKED_FREE_DOMAINS:
            return {"allowed": False, "reason": "free_provider", "domain": dom,
                    "message": f"{dom} is a free-email provider — signup is blocked."}
        rec = await db.allowed_domains.find_one({"domain": dom})
        if not rec:
            return {"allowed": False, "reason": "not_in_allowlist", "domain": dom,
                    "message": f"{dom} is not in the allowlist — signup would be rejected."}
        company_id = rec.get("company_id")
        site_id = rec.get("site_id")
        site_name = None
        if site_id:
            s = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")}, {"name": 1, "company_id": 1})
            if s:
                site_name = s.get("name")
                company_id = company_id or s.get("company_id")
        company_name = None
        if company_id:
            co = await db.companies.find_one({"_id": safe_objectid(company_id, "Company")}, {"name": 1})
            company_name = co.get("name") if co else None
        return {"allowed": True, "domain": dom, "company_id": company_id, "company_name": company_name,
                "site_id": site_id, "site_name": site_name,
                "message": f"New employees on @{dom} → {company_name or 'no company'}"
                           + (f" · site: {site_name}" if site_name else " · no default site")}

    @r.post("/admin/allowed-domains/{domain_id}/backfill-company")
    async def backfill_domain_company(domain_id: str, user: dict = Depends(get_current_user)):
        """One-click: set a domain's company_id from its default site's company."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        d = await db.allowed_domains.find_one({"_id": safe_objectid(domain_id, "Domain")})
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found")
        if d.get("company_id"):
            return {"success": True, "company_id": d["company_id"], "message": "Already linked to a company"}
        if not d.get("site_id"):
            raise HTTPException(status_code=400, detail="This domain has no default site to derive a company from")
        s = await db.sites.find_one({"_id": safe_objectid(d["site_id"], "Site")}, {"company_id": 1})
        cid = s.get("company_id") if s else None
        if not cid:
            raise HTTPException(status_code=400, detail="The domain's default site isn't linked to a company")
        await db.allowed_domains.update_one({"_id": d["_id"]}, {"$set": {"company_id": cid}})
        co = await db.companies.find_one({"_id": safe_objectid(cid, "Company")}, {"name": 1})
        return {"success": True, "company_id": cid, "company_name": co.get("name") if co else None,
                "message": "Domain now directly linked to its company"}

    @r.get("/admin/signup-rejections")
    async def signup_rejections(user: dict = Depends(get_current_user)):
        """Recent rejected employee sign-ups, grouped by domain — spot missing allowlist entries."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master Admin only")
        docs = await db.signup_rejections.find({}).sort("created_at", -1).to_list(200)
        allowed = set(await db.allowed_domains.distinct("domain"))
        by_domain: dict = {}
        recent = []
        for d in docs:
            dom = d.get("domain") or "(none)"
            by_domain[dom] = by_domain.get(dom, 0) + 1
            ca = d.get("created_at")
            recent.append({
                "email": d.get("email"), "domain": dom, "reason": d.get("reason"),
                "created_at": ca.isoformat() if hasattr(ca, "isoformat") else ca,
            })
        summary = [{"domain": k, "count": v, "in_allowlist": k in allowed}
                   for k, v in sorted(by_domain.items(), key=lambda x: -x[1])]
        return {"summary": summary, "recent": recent[:40]}

    return r
