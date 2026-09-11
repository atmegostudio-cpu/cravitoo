"""Shared RBAC helpers for the sub_admin role (custom permissions + multi-scope).

A sub_admin has an explicit `permissions[]` list and a `scope` object
{client_ids, city_ids, site_ids, vendor_ids}. Access is deny-by-default: a
sub_admin only reaches an endpoint that explicitly grants the matching
permission, and only for entities resolved from their scope. Final approvals
(vendor onboarding, client lifecycle, menu-change decisions) always stay with
the Master Admin regardless of any granted permission.
"""
from bson import ObjectId


def has_permission(user: dict, perm: str) -> bool:
    if user.get("role") == "master_admin":
        return True
    if user.get("role") != "sub_admin":
        return False
    return perm in (user.get("permissions") or [])


async def sub_scope_sites(db, user: dict) -> set:
    """Effective site_id set: explicit sites + sites of scoped clients + sites of scoped cities."""
    scope = user.get("scope") or {}
    sites = set(scope.get("site_ids") or [])
    if scope.get("client_ids"):
        for s in await db.sites.find({"company_id": {"$in": scope["client_ids"]}}, {"_id": 1}).to_list(5000):
            sites.add(str(s["_id"]))
    if scope.get("city_ids"):
        for s in await db.sites.find({"city_id": {"$in": scope["city_ids"]}}, {"_id": 1}).to_list(5000):
            sites.add(str(s["_id"]))
    return sites


async def sub_scope_companies(db, user: dict) -> set:
    """Effective company_id set: explicit clients + companies of the scoped sites/cities."""
    scope = user.get("scope") or {}
    comps = set(scope.get("client_ids") or [])
    sids = await sub_scope_sites(db, user)
    oids = []
    for x in sids:
        try:
            oids.append(ObjectId(x))
        except Exception:
            pass
    if oids:
        for s in await db.sites.find({"_id": {"$in": oids}}, {"company_id": 1}).to_list(5000):
            if s.get("company_id"):
                comps.add(str(s["company_id"]))
    return comps
