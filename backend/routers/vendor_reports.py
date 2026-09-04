"""Vendor reports + counter router.

Extracted from server.py (Jun 2026 refactor). Holds the vendor-facing counter
management and the Sales Report endpoints (summary / paginated orders / CSV+PDF
export). Behaviour is identical to the inline routes it replaces.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class _CounterAssignBody(BaseModel):
    counter: Optional[str] = None      # None / empty → clears the tag


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    def _require_vendor(user: dict) -> str:
        if user.get("role") != "vendor" or not user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Vendor account required")
        return user["vendor_id"]

    def _parse_date_range(from_iso: Optional[str], to_iso: Optional[str]):
        now = datetime.now(timezone.utc)
        end = now
        start = now - timedelta(days=30)     # default: last 30 days
        if from_iso:
            try:
                start = datetime.fromisoformat(from_iso.replace("Z", "+00:00"))
                if start.tzinfo is None: start = start.replace(tzinfo=timezone.utc)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid 'from' date: {from_iso}")
        if to_iso:
            try:
                end = datetime.fromisoformat(to_iso.replace("Z", "+00:00"))
                if end.tzinfo is None: end = end.replace(tzinfo=timezone.utc)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid 'to' date: {to_iso}")
        if (end - start).days > 366:
            raise HTTPException(status_code=400, detail="Date range too large (max 366 days)")
        return start, end

    def _build_orders_query(vendor_id: str, start, end,
                            site_id: Optional[str], counter: Optional[str],
                            payment_status: Optional[str]) -> dict:
        q = {"vendor_id": vendor_id, "created_at": {"$gte": start, "$lte": end}}
        if site_id: q["site_id"] = site_id
        if counter: q["counter"] = counter
        if payment_status and payment_status != "all":
            q["payment_status"] = payment_status
        return q

    @r.get("/vendor/counters")
    async def list_vendor_counters(user: dict = Depends(get_current_user)):
        """Distinct counter names in the vendor's menu."""
        vendor_id = _require_vendor(user)
        names = await db.menu_items.distinct("counter", {"vendor_id": vendor_id, "counter": {"$nin": [None, ""]}})
        return sorted(names)

    @r.patch("/vendor/menu-items/{item_id}/counter")
    async def set_menu_item_counter(item_id: str, body: _CounterAssignBody, user: dict = Depends(get_current_user)):
        vendor_id = _require_vendor(user)
        counter = (body.counter or "").strip()[:60] or None
        result = await db.menu_items.update_one(
            {"_id": safe_objectid(item_id, "Menu item"), "vendor_id": vendor_id},
            {"$set": {"counter": counter}},
        )
        if not result.matched_count:
            raise HTTPException(status_code=404, detail="Menu item not found for this vendor")
        return {"success": True, "counter": counter}

    @r.get("/vendor/reports/sales-summary")
    async def vendor_sales_summary(
        from_: Optional[str] = Query(None, alias="from"),
        to: Optional[str] = None,
        site_id: Optional[str] = None,
        counter: Optional[str] = None,
        payment_status: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        """Summary cards + per-counter breakdown for the vendor Sales Report page."""
        vendor_id = _require_vendor(user)
        start, end = _parse_date_range(from_, to)
        q = _build_orders_query(vendor_id, start, end, site_id, counter, payment_status)

        # Overall aggregation
        agg_all = await db.orders.aggregate([
            {"$match": q},
            {"$group": {
                "_id": None,
                "total_orders": {"$sum": 1},
                "total_amount": {"$sum": "$total_amount"},
                "paid_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, "$total_amount", 0]}},
                "pending_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "pending"]}, "$total_amount", 0]}},
                "failed_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "failed"]}, "$total_amount", 0]}},
                "cancelled_amount": {"$sum": {"$cond": [{"$eq": ["$status", "cancelled"]}, "$total_amount", 0]}},
            }},
        ]).to_list(1)
        row = agg_all[0] if agg_all else {}
        total_orders = row.get("total_orders", 0)
        total_amount = round(row.get("total_amount", 0) or 0, 2)
        avg_order = round(total_amount / total_orders, 2) if total_orders else 0

        # Per-counter breakdown
        per_counter = await db.orders.aggregate([
            {"$match": q},
            {"$group": {
                "_id": {"$ifNull": ["$counter", "—"]},
                "orders": {"$sum": 1},
                "total_amount": {"$sum": "$total_amount"},
                "paid_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, "$total_amount", 0]}},
                "pending_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "pending"]}, "$total_amount", 0]}},
            }},
            {"$sort": {"total_amount": -1}},
        ]).to_list(50)

        return {
            "range": {"from": start.isoformat(), "to": end.isoformat()},
            "summary": {
                "total_orders": total_orders,
                "total_amount": total_amount,
                "paid_amount": round(row.get("paid_amount", 0) or 0, 2),
                "pending_amount": round(row.get("pending_amount", 0) or 0, 2),
                "failed_amount": round(row.get("failed_amount", 0) or 0, 2),
                "cancelled_amount": round(row.get("cancelled_amount", 0) or 0, 2),
                "avg_order_value": avg_order,
            },
            "per_counter": [{
                "counter": rc["_id"],
                "orders": rc["orders"],
                "total_amount": round(rc["total_amount"] or 0, 2),
                "paid_amount": round(rc["paid_amount"] or 0, 2),
                "pending_amount": round(rc["pending_amount"] or 0, 2),
            } for rc in per_counter],
        }

    @r.get("/vendor/reports/sales-orders")
    async def vendor_sales_orders(
        from_: Optional[str] = Query(None, alias="from"),
        to: Optional[str] = None,
        site_id: Optional[str] = None,
        counter: Optional[str] = None,
        payment_status: Optional[str] = None,
        page: int = 1,
        size: int = 50,
        user: dict = Depends(get_current_user),
    ):
        """Paginated order rows for the sales table."""
        vendor_id = _require_vendor(user)
        start, end = _parse_date_range(from_, to)
        q = _build_orders_query(vendor_id, start, end, site_id, counter, payment_status)
        size = max(1, min(size, 200))
        page = max(1, page)
        total = await db.orders.count_documents(q)
        rows = await db.orders.find(q).sort("created_at", -1).skip((page - 1) * size).limit(size).to_list(size)
        return {
            "total": total,
            "page": page,
            "size": size,
            "rows": [{
                "id": str(rr["_id"]),
                "collection_code": rr.get("collection_code"),
                "counter": rr.get("counter") or "—",
                "items": rr.get("items", []),
                "quantity": sum(it.get("quantity", 0) for it in rr.get("items", [])),
                "amount": rr.get("total_amount"),
                "payment_method": rr.get("payment_method"),
                "payment_status": rr.get("payment_status"),
                "status": rr.get("status"),
                "created_at": rr.get("created_at").isoformat() if rr.get("created_at") else None,
                "site_id": rr.get("site_id"),
            } for rr in rows],
        }

    @r.get("/vendor/reports/sales-export")
    async def vendor_sales_export(
        request: Request,
        from_: Optional[str] = Query(None, alias="from"),
        to: Optional[str] = None,
        site_id: Optional[str] = None,
        counter: Optional[str] = None,
        payment_status: Optional[str] = None,
        format: str = "csv",
        user: dict = Depends(get_current_user),
    ):
        """Streams CSV (or PDF) of the same filtered order set."""
        vendor_id = _require_vendor(user)
        start, end = _parse_date_range(from_, to)
        q = _build_orders_query(vendor_id, start, end, site_id, counter, payment_status)
        rows = await db.orders.find(q).sort("created_at", -1).limit(10000).to_list(10000)
        vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
        vendor_name = (vendor.get("name") if vendor else "Vendor")
        filename_base = f"cravitoo_sales_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}"
        if counter:
            filename_base += f"_{counter.replace(' ', '_')}"

        if format.lower() == "csv":
            import io, csv
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["Date & Time (UTC)", "Order ID", "Counter", "Items", "Total Qty",
                        "Amount (INR)", "Payment Method", "Payment Status", "Fulfilment Status"])
            for rr in rows:
                items_str = ", ".join(f"{it.get('name','?')} ×{it.get('quantity',0)}" for it in rr.get("items", []))
                w.writerow([
                    rr.get("created_at").isoformat() if rr.get("created_at") else "",
                    rr.get("collection_code") or str(rr.get("_id", "")),
                    rr.get("counter") or "-",
                    items_str,
                    sum(it.get("quantity", 0) for it in rr.get("items", [])),
                    f"{rr.get('total_amount', 0):.2f}",
                    rr.get("payment_method") or "-",
                    rr.get("payment_status") or "-",
                    rr.get("status") or "-",
                ])
            # Summary footer
            total_orders = len(rows)
            total_amt = sum(rr.get("total_amount", 0) for rr in rows)
            paid_amt = sum(rr.get("total_amount", 0) for rr in rows if rr.get("payment_status") == "paid")
            w.writerow([])
            w.writerow(["", "", "", "TOTALS", total_orders, f"{total_amt:.2f}", "", f"Paid: {paid_amt:.2f}", ""])
            return Response(
                content=buf.getvalue(), media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
            )

        # PDF
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors as _c
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import ParagraphStyle
        import io
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12*mm, rightMargin=12*mm, topMargin=15*mm, bottomMargin=15*mm)
        story = []
        title_st = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=16, textColor=_c.HexColor("#0E1B2C"))
        sub_st = ParagraphStyle("s", fontName="Helvetica", fontSize=9, textColor=_c.HexColor("#6B7280"))
        story.append(Paragraph(f"{vendor_name} — Sales Report", title_st))
        story.append(Paragraph(
            f"{start.strftime('%d %b %Y')} → {end.strftime('%d %b %Y')}"
            + (f" · Counter: {counter}" if counter else " · All counters")
            + (f" · Payment: {payment_status}" if payment_status and payment_status != 'all' else ""),
            sub_st,
        ))
        story.append(Spacer(1, 10))
        total_orders = len(rows); total_amt = sum(rr.get("total_amount", 0) for rr in rows)
        paid_amt = sum(rr.get("total_amount", 0) for rr in rows if rr.get("payment_status") == "paid")
        story.append(Paragraph(
            f"<b>{total_orders}</b> orders · Total <b>₹{total_amt:,.2f}</b> · Paid <b>₹{paid_amt:,.2f}</b>",
            ParagraphStyle("kpi", fontName="Helvetica", fontSize=10, textColor=_c.HexColor("#1A2233")),
        ))
        story.append(Spacer(1, 6))
        data = [["Date/Time", "Order ID", "Counter", "Items", "Qty", "Amt", "Pay Method", "Pay Status", "Status"]]
        for rr in rows[:1500]:  # cap PDF at 1500 rows
            items_str = ", ".join(f"{it.get('name','?')} x{it.get('quantity',0)}" for it in rr.get("items", []))[:60]
            data.append([
                rr.get("created_at").strftime("%d %b %H:%M") if rr.get("created_at") else "-",
                rr.get("collection_code") or "-",
                (rr.get("counter") or "-")[:16],
                items_str,
                sum(it.get("quantity", 0) for it in rr.get("items", [])),
                f"₹{rr.get('total_amount', 0):.0f}",
                rr.get("payment_method") or "-",
                rr.get("payment_status") or "-",
                rr.get("status") or "-",
            ])
        tbl = Table(data, colWidths=[24*mm, 24*mm, 26*mm, 78*mm, 12*mm, 18*mm, 24*mm, 24*mm, 24*mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), _c.HexColor("#0E1B2C")),
            ("TEXTCOLOR",  (0,0), (-1,0), _c.white),
            ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",   (0,0), (-1,0), 8),
            ("FONTNAME",   (0,1), (-1,-1), "Helvetica"),
            ("FONTSIZE",   (0,1), (-1,-1), 7.5),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [_c.white, _c.HexColor("#F8FAFC")]),
            ("GRID", (0,0), (-1,-1), 0.25, _c.HexColor("#E5E7EB")),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("LEFTPADDING", (0,0), (-1,-1), 4),
            ("RIGHTPADDING", (0,0), (-1,-1), 4),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ]))
        story.append(tbl)
        doc.build(story)
        pdf_bytes = buf.getvalue()
        return Response(
            content=pdf_bytes, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
        )

    return r
