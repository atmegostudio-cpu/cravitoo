"""
Weekly admin email reports.

Endpoint:
  POST /api/admin/reports/weekly/send

Master-admin-only. Computes last-7-days metrics (orders, revenue, AOV, active employees,
new signups, refunds) and emails master_admin + site_admin (configurable) via Resend.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    @r.post("/admin/reports/weekly/send")
    async def send_weekly_admin_reports(
        user: dict = Depends(get_current_user),
        target_role: Optional[str] = Query(None, description="Filter recipients: master_admin | site_admin"),
    ):
        if user["role"] != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can trigger weekly reports.")

        import email_service
        now = datetime.now(timezone.utc)
        week_start = now - timedelta(days=7)
        period_label = f"{week_start.strftime('%b %d')} – {now.strftime('%b %d, %Y')}"

        orders_cursor = db.orders.find({
            "created_at": {"$gte": week_start, "$lt": now},
            "status": {"$ne": "cancelled"},
        })
        total_orders = 0
        total_revenue = 0.0
        vendor_stats: Dict[str, Dict[str, Any]] = {}
        async for o in orders_cursor:
            total_orders += 1
            amt = float(o.get("total_amount", 0) or 0)
            total_revenue += amt
            vid = o.get("vendor_id")
            if vid:
                vs = vendor_stats.setdefault(vid, {"orders": 0, "revenue": 0.0})
                vs["orders"] += 1
                vs["revenue"] += amt

        top_vendor_ids = sorted(vendor_stats.keys(), key=lambda k: vendor_stats[k]["revenue"], reverse=True)[:5]
        top_vendors = []
        for vid in top_vendor_ids:
            try:
                vdoc = await db.vendors.find_one({"_id": safe_objectid(vid, "Vendor")})
                top_vendors.append({
                    "name": (vdoc or {}).get("name", "Vendor"),
                    "orders": vendor_stats[vid]["orders"],
                    "revenue": vendor_stats[vid]["revenue"],
                })
            except Exception:
                continue

        refunds_cursor = db.refunds.find({"created_at": {"$gte": week_start, "$lt": now}})
        refunds_count = 0
        refunds_amount = 0.0
        async for ref in refunds_cursor:
            refunds_count += 1
            refunds_amount += float(ref.get("amount", 0) or 0)

        active_employees = await db.orders.distinct("user_id", {"created_at": {"$gte": week_start, "$lt": now}})
        new_signups = await db.users.count_documents({"role": "employee", "created_at": {"$gte": week_start, "$lt": now}})

        metrics = {
            "orders": total_orders,
            "revenue": total_revenue,
            "aov": (total_revenue / total_orders) if total_orders else 0.0,
            "active_employees": len(active_employees),
            "new_signups": new_signups,
            "refunds_count": refunds_count,
            "refunds_amount": refunds_amount,
        }

        recipient_roles = ["master_admin"]
        if target_role == "site_admin":
            recipient_roles = ["site_admin"]
        elif target_role is None or target_role == "all":
            recipient_roles = ["master_admin", "site_admin"]

        recipients = await db.users.find(
            {"role": {"$in": recipient_roles}, "email": {"$ne": None}},
            {"email": 1, "name": 1, "role": 1},
        ).to_list(500)

        sent, failed = 0, 0
        for rec in recipients:
            try:
                html, text = email_service.render_weekly_admin_report_email(
                    admin_name=rec.get("name", "Admin"),
                    period_label=period_label,
                    metrics=metrics,
                    top_vendors=top_vendors,
                )
                ok, _err = email_service.send_email(
                    rec["email"],
                    f"Cravitoo Weekly Report — {period_label}",
                    html, text,
                )
                if ok:
                    sent += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"Weekly report email failed for {rec.get('email')}: {e}")
                failed += 1

        await db.report_runs.insert_one({
            "type": "weekly_admin_summary",
            "triggered_by": user["id"],
            "triggered_at": now,
            "period_start": week_start,
            "period_end": now,
            "metrics": metrics,
            "sent": sent,
            "failed": failed,
            "recipient_count": len(recipients),
        })

        return {
            "ok": True,
            "period": period_label,
            "metrics": metrics,
            "top_vendors": top_vendors,
            "recipients_total": len(recipients),
            "sent": sent,
            "failed": failed,
        }

    return r
