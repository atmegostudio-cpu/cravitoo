"""Employee feedback — quick food ratings + 'Other issue' reports, mapped to
order / employee / site / vendor and visible to the relevant vendor/admin."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

ISSUE_CATEGORIES = {"service", "hygiene", "delay", "billing", "other"}


class FeedbackBody(BaseModel):
    kind: str                      # 'food' | 'issue'
    order_id: Optional[str] = None
    item_name: Optional[str] = None
    rating: Optional[int] = None   # 1-5 for food
    category: Optional[str] = None # for issue
    comment: Optional[str] = None


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    def _ser(d):
        d["id"] = str(d.pop("_id"))
        return d

    @r.post("/feedback")
    async def submit_feedback(body: FeedbackBody, user: dict = Depends(get_current_user)):
        if user.get("role") != "employee":
            raise HTTPException(status_code=403, detail="Only employees can submit feedback")
        kind = (body.kind or "").strip()
        if kind not in ("food", "issue"):
            raise HTTPException(status_code=400, detail="kind must be 'food' or 'issue'")
        now = datetime.now(timezone.utc)
        doc = {
            "kind": kind,
            "comment": (body.comment or "").strip()[:1000] or None,
            "employee_id": user.get("id"),
            "employee_name": user.get("name") or user.get("email"),
            "employee_email": user.get("email"),
            "site_id": user.get("site_id"),
            "company_id": user.get("company_id"),
            "vendor_id": None,
            "order_id": None,
            "order_code": None,
            "status": "open",
            "created_at": now.isoformat(),
        }

        # Map to the order (and thus vendor/site) when provided
        order = None
        if body.order_id:
            order = await db.orders.find_one({"_id": safe_objectid(body.order_id, "Order")})
            if not order or str(order.get("user_id")) != str(user.get("id")):
                raise HTTPException(status_code=403, detail="That order isn't yours")
            doc["order_id"] = body.order_id
            doc["order_code"] = order.get("collection_code")
            doc["vendor_id"] = order.get("vendor_id")
            doc["site_id"] = order.get("site_id") or doc["site_id"]
            doc["company_id"] = order.get("company_id") or doc["company_id"]

        if kind == "food":
            if body.rating is None or not (1 <= int(body.rating) <= 5):
                raise HTTPException(status_code=400, detail="Give a rating from 1 to 5")
            doc["rating"] = int(body.rating)
            doc["item_name"] = (body.item_name or "").strip()[:120] or None
        else:
            cat = (body.category or "").strip().lower()
            if cat not in ISSUE_CATEGORIES:
                raise HTTPException(status_code=400, detail="Pick a valid issue category")
            doc["category"] = cat
            if not doc["comment"]:
                raise HTTPException(status_code=400, detail="Please add a short note about the issue")

        doc["priority"] = "high" if (kind == "issue" or (doc.get("rating") or 5) <= 2) else "normal"
        res = await db.feedback.insert_one(doc)
        return {"success": True, "id": str(res.inserted_id), "priority": doc["priority"]}

    def _scope(user):
        role = user.get("role")
        if role == "vendor":
            return {"vendor_id": user.get("vendor_id")}
        if role == "site_admin":
            return {"site_id": user.get("site_id")}
        if role == "corporate_admin":
            return {"company_id": user.get("company_id")}
        if role == "master_admin":
            return {}
        raise HTTPException(status_code=403, detail="Not allowed")

    @r.get("/feedback/analytics")
    async def feedback_analytics(user: dict = Depends(get_current_user)):
        q = _scope(user)
        docs = await db.feedback.find(q).to_list(5000)
        ratings = [d["rating"] for d in docs if d.get("rating")]
        by_cat, by_day = {}, {}
        for d in docs:
            if d.get("category"):
                by_cat[d["category"]] = by_cat.get(d["category"], 0) + 1
            day = (d.get("created_at") or "")[:10]
            if day:
                by_day[day] = by_day.get(day, 0) + 1
        return {
            "total": len(docs),
            "open": sum(1 for d in docs if d.get("status") == "open"),
            "high_priority_open": sum(1 for d in docs if d.get("priority") == "high" and d.get("status") == "open"),
            "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "rating_count": len(ratings),
            "by_category": [{"category": k, "count": v} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
            "by_day": [{"day": k, "count": by_day[k]} for k in sorted(by_day)][-14:],
        }

    @r.get("/feedback/menu-ratings")
    async def menu_ratings(vendor_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        role = user.get("role")
        vid = user.get("vendor_id") if role == "vendor" else vendor_id
        if not vid:
            raise HTTPException(status_code=400, detail="vendor_id required")
        docs = await db.feedback.find({"vendor_id": vid, "kind": "food", "rating": {"$ne": None}}).to_list(5000)
        agg = {}
        for d in docs:
            name = d.get("item_name") or "General"
            a = agg.setdefault(name, {"item": name, "sum": 0, "count": 0})
            a["sum"] += d["rating"]; a["count"] += 1
        out = [{"item": a["item"], "avg": round(a["sum"] / a["count"], 2), "count": a["count"]}
               for a in agg.values()]
        out.sort(key=lambda x: -x["count"])
        return out

    @r.get("/employee/feedback")
    async def my_feedback(user: dict = Depends(get_current_user)):
        if user.get("role") != "employee":
            raise HTTPException(status_code=403, detail="Employees only")
        docs = await db.feedback.find({"employee_id": user.get("id")}).sort("created_at", -1).to_list(200)
        return [_ser(d) for d in docs]

    @r.get("/feedback")
    async def feedback_inbox(user: dict = Depends(get_current_user)):
        """Role-scoped feedback for follow-up: vendor→their vendor, site_admin→their
        site, corporate_admin→their company, master_admin→all."""
        role = user.get("role")
        if role == "vendor":
            q = {"vendor_id": user.get("vendor_id")}
        elif role == "site_admin":
            q = {"site_id": user.get("site_id")}
        elif role == "corporate_admin":
            q = {"company_id": user.get("company_id")}
        elif role == "master_admin":
            q = {}
        else:
            raise HTTPException(status_code=403, detail="Not allowed")
        docs = await db.feedback.find(q).sort("created_at", -1).to_list(1000)
        docs.sort(key=lambda d: (0 if d.get("priority") == "high" and d.get("status") == "open" else 1, d.get("created_at") or ""), reverse=False)
        return [_ser(d) for d in docs]

    @r.patch("/feedback/{fid}/resolve")
    async def resolve_feedback(fid: str, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("vendor", "site_admin", "corporate_admin", "master_admin"):
            raise HTTPException(status_code=403, detail="Not allowed")
        await db.feedback.update_one({"_id": safe_objectid(fid, "Feedback")}, {"$set": {"status": "resolved"}})
        return {"success": True}

    return r
