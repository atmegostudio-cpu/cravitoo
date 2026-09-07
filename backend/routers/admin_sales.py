"""Admin Sales Report — role-scoped totals split by Site and Vendor, with
date / date-range / month filters and Excel (.xlsx) export.

Access: master_admin (all sites), corporate_admin (their company's sites),
site_admin (their site only).
"""
import io
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse


def _parse_range(date: Optional[str], start: Optional[str], end: Optional[str], month: Optional[str]):
    """Return (start_dt, end_dt) UTC-aware, inclusive start / exclusive end."""
    def d(s):
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    if month:  # 'YYYY-MM'
        y, m = int(month[:4]), int(month[5:7])
        s = datetime(y, m, 1, tzinfo=timezone.utc)
        e = datetime(y + (m // 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
        return s, e
    if date:
        s = d(date)
        return s, s + timedelta(days=1)
    if start and end:
        return d(start), d(end) + timedelta(days=1)
    # default: last 30 days
    now = datetime.now(timezone.utc)
    return now - timedelta(days=30), now + timedelta(days=1)


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    async def _allowed_site_ids(user):
        role = user.get("role")
        if role == "master_admin":
            return None  # all
        if role == "site_admin":
            return [user.get("site_id")] if user.get("site_id") else []
        if role == "corporate_admin":
            cid = user.get("company_id")
            sites = await db.sites.find({"company_id": cid}, {"_id": 1}).to_list(1000)
            return [str(s["_id"]) for s in sites]
        raise HTTPException(status_code=403, detail="Not allowed")

    async def _gather(user, date, start, end, month):
        allowed = await _allowed_site_ids(user)
        s, e = _parse_range(date, start, end, month)
        q = {"created_at": {"$gte": s, "$lt": e}, "status": {"$ne": "cancelled"}}
        if allowed is not None:
            q["site_id"] = {"$in": allowed}
        orders = await db.orders.find(q).sort("created_at", -1).to_list(100000)
        # name lookups
        site_ids = {o.get("site_id") for o in orders if o.get("site_id")}
        vend_ids = {o.get("vendor_id") for o in orders if o.get("vendor_id")}
        site_names, vend_names = {}, {}
        for sid in site_ids:
            doc = await db.sites.find_one({"_id": safe_objectid(sid, "Site")}, {"name": 1, "city": 1})
            if doc:
                site_names[sid] = f"{doc.get('city') + ' · ' if doc.get('city') else ''}{doc.get('name')}"
        for vid in vend_ids:
            doc = await db.vendors.find_one({"_id": safe_objectid(vid, "Vendor")}, {"name": 1})
            if doc:
                vend_names[vid] = doc.get("name")
        rows, site_tot, vend_tot, grand = [], {}, {}, 0.0
        for o in orders:
            amt = float(o.get("total_amount") or 0)
            grand += amt
            sid, vid = o.get("site_id"), o.get("vendor_id")
            site_tot[sid] = site_tot.get(sid, 0.0) + amt
            key = (sid, vid)
            vend_tot[key] = vend_tot.get(key, 0.0) + amt
            ca = o.get("created_at")
            rows.append({
                "order_id": str(o["_id"]),
                "date": ca.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M") if ca else "",
                "site": site_names.get(sid, sid or "—"),
                "vendor": vend_names.get(vid, vid or "—"),
                "employee": o.get("employee_name") or o.get("employee_email") or "",
                "items": ", ".join(f"{i.get('quantity', 1)}× {i.get('name', '')}" for i in (o.get("items") or [])),
                "amount": round(amt, 2),
                "payment_status": o.get("payment_status") or "",
                "payment_method": o.get("payment_method") or o.get("payment_mode") or "",
                "fulfilment": o.get("status") or "",
            })
        site_summary = [{"site": site_names.get(k, k or "—"), "total": round(v, 2)} for k, v in sorted(site_tot.items(), key=lambda x: -x[1])]
        vendor_summary = [{"site": site_names.get(k[0], k[0] or "—"), "vendor": vend_names.get(k[1], k[1] or "—"), "total": round(v, 2)} for k, v in sorted(vend_tot.items(), key=lambda x: -x[1])]
        return {
            "range": {"start": s.isoformat(), "end": e.isoformat()},
            "grand_total": round(grand, 2),
            "order_count": len(rows),
            "site_summary": site_summary,
            "vendor_summary": vendor_summary,
            "orders": rows,
        }

    @r.get("/admin/sales-report")
    async def sales_report(
        date: Optional[str] = None,
        start: Optional[str] = None,
        end: Optional[str] = None,
        month: Optional[str] = None,
        format: str = Query("json"),
        user: dict = Depends(get_current_user),
    ):
        data = await _gather(user, date, start, end, month)
        if format != "xlsx":
            return data

        import openpyxl
        from openpyxl.styles import Font
        wb = openpyxl.Workbook()
        # Sheet 1: Orders
        ws = wb.active
        ws.title = "Orders"
        headers = ["Date", "Site", "Vendor", "Employee", "Items", "Amount", "Payment Status", "Payment Method", "Fulfilment", "Order ID"]
        ws.append(headers)
        for c in ws[1]:
            c.font = Font(bold=True)
        for o in data["orders"]:
            ws.append([o["date"], o["site"], o["vendor"], o["employee"], o["items"], o["amount"], o["payment_status"], o["payment_method"], o["fulfilment"], o["order_id"]])
        # Sheet 2: Site totals
        ws2 = wb.create_sheet("Site Totals")
        ws2.append(["Site", "Total (₹)"])
        ws2["A1"].font = Font(bold=True); ws2["B1"].font = Font(bold=True)
        for s in data["site_summary"]:
            ws2.append([s["site"], s["total"]])
        ws2.append(["GRAND TOTAL", data["grand_total"]])
        ws2[ws2.max_row][0].font = Font(bold=True); ws2[ws2.max_row][1].font = Font(bold=True)
        # Sheet 3: Vendor totals
        ws3 = wb.create_sheet("Vendor Totals")
        ws3.append(["Site", "Vendor", "Total (₹)"])
        for c in ws3[1]:
            c.font = Font(bold=True)
        for v in data["vendor_summary"]:
            ws3.append([v["site"], v["vendor"], v["total"]])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        fname = f"cravitoo-sales-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    return r
