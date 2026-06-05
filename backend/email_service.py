"""
Email + OTP delivery service for Cravitoo.

Channel-agnostic by design — adding SMS later means:
  1. Add a new function `send_sms(phone, msg)` (e.g., MSG91)
  2. Add a case in `send_otp_channel`

Public API used by server.py:
  - send_email(to, subject, html, text)         — generic transactional email via Resend
  - send_otp_channel(identifier, code, channel) — dispatches OTP to email or SMS
  - hash_otp(code)                              — bcrypt-hashes a code
  - verify_otp(code, code_hash)                 — constant-time check
  - render_otp_email(code, purpose)             — branded HTML template

All errors are caught & logged. send_email returns (success: bool, error: Optional[str]).
"""

from __future__ import annotations

import os
import secrets
import logging
from typing import Optional, Tuple, Dict, Any, List

import bcrypt
import resend

logger = logging.getLogger(__name__)

# ─── Config (lazy — fail loud at send time, not at import time) ───
_RESEND_INITIALIZED = False


def _ensure_resend_configured():
    global _RESEND_INITIALIZED
    if _RESEND_INITIALIZED:
        return
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY is not set in environment")
    resend.api_key = api_key
    _RESEND_INITIALIZED = True


def _from_address() -> str:
    """Returns the configured sender. Falls back to Resend's free sandbox."""
    email = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
    name = os.environ.get("RESEND_FROM_NAME", "Cravitoo")
    return f"{name} <{email}>"


# ─── OTP helpers ───

def generate_otp(digits: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP."""
    if digits < 4 or digits > 8:
        raise ValueError("OTP digits must be between 4 and 8")
    # secrets.randbelow ensures uniform distribution
    max_val = 10**digits
    code = secrets.randbelow(max_val)
    return str(code).zfill(digits)


def hash_otp(code: str) -> str:
    """Bcrypt-hash an OTP (cost 10 — slow enough for security, fast enough for sub-200ms verify)."""
    return bcrypt.hashpw(code.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_otp(code: str, code_hash: str) -> bool:
    """Constant-time bcrypt verification."""
    try:
        return bcrypt.checkpw(code.encode("utf-8"), code_hash.encode("utf-8"))
    except Exception:
        return False


# ─── Email sender (via Resend) ───

def send_email(to: str, subject: str, html: str, text: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Send a transactional email via Resend.

    Returns (success, error_message). Never raises.
    """
    try:
        _ensure_resend_configured()
        params = {
            "from": _from_address(),
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if text:
            params["text"] = text
        result = resend.Emails.send(params)
        if isinstance(result, dict) and result.get("id"):
            return True, None
        return False, f"Unexpected Resend response: {result}"
    except Exception as e:
        msg = str(e)
        logger.warning(f"Resend send_email failed for {to}: {msg}")
        return False, msg


# ─── OTP email template ───

def render_otp_email(code: str, purpose: str = "Login", expiry_minutes: int = 10) -> Tuple[str, str]:
    """Returns (html, plain_text) for an OTP email. Brand: Cravitoo."""
    safe_purpose = purpose.replace("<", "").replace(">", "")[:40]  # paranoid sanitization
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cravitoo verification code</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color:#FFF7F0; color:#1F1410;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FFF7F0;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px; background-color:#ffffff; border:1px solid rgba(255,90,31,0.15); border-radius:16px; overflow:hidden;">
          <!-- Brand bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF5A1F 0%,#FF7A45 100%); padding:24px 32px;">
              <div style="font-size:28px; font-weight:700; color:#ffffff; letter-spacing:-0.5px;">Cravitoo</div>
              <div style="font-size:13px; color:#FFE8DC; margin-top:2px;">Good food. Easy order. Happy team.</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 12px 32px;">
              <h1 style="margin:0 0 8px 0; font-size:22px; color:#1F1410; font-weight:600;">{safe_purpose} verification code</h1>
              <p style="margin:0 0 24px 0; font-size:15px; color:#52443A; line-height:1.55;">
                Use the code below to {safe_purpose.lower()} into your Cravitoo account. This code expires in <strong>{expiry_minutes} minutes</strong>.
              </p>
              <!-- Code box -->
              <div style="background-color:#FFF1E5; border:2px dashed #FF5A1F; border-radius:12px; padding:24px 16px; text-align:center; margin:0 0 28px 0;">
                <div style="font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Courier New', monospace; font-size:36px; font-weight:700; letter-spacing:12px; color:#FF5A1F;">{code}</div>
              </div>
              <p style="margin:0 0 8px 0; font-size:14px; color:#52443A; line-height:1.5;">
                If you didn't request this, you can safely ignore this email — your account is secure.
              </p>
              <p style="margin:24px 0 0 0; font-size:13px; color:#9C8B80; line-height:1.5;">
                For your security, never share this code with anyone — not even Cravitoo support.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #F3E8DD; padding:20px 32px; background-color:#FFFBF7;">
              <p style="margin:0; font-size:12px; color:#9C8B80; line-height:1.5;">
                © 2026 Cravitoo Foods Private Limited.<br>
                You're receiving this because someone requested a verification code for your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    text = f"""Cravitoo {safe_purpose} verification code

Your verification code is: {code}

This code expires in {expiry_minutes} minutes.

If you didn't request this, you can safely ignore this email.

For your security, never share this code with anyone — not even Cravitoo support.

— Cravitoo Foods Private Limited"""

    return html, text


# ─── Channel dispatcher ───

def send_otp_channel(identifier: str, code: str, channel: str = "email", purpose: str = "Login", expiry_minutes: int = 10) -> Tuple[bool, Optional[str]]:
    """Dispatch an OTP through the requested channel.

    Channels:
      'email'    → Resend (via send_email)
      'sms'      → not yet implemented; returns (False, 'not_configured')
      'whatsapp' → not yet implemented; returns (False, 'not_configured')
    """
    channel = channel.lower()

    if channel == "email":
        html, text = render_otp_email(code, purpose, expiry_minutes)
        subject = f"Your Cravitoo {purpose.lower()} code: {code}"
        return send_email(identifier, subject, html, text)

    if channel in ("sms", "whatsapp"):
        return False, f"{channel}_not_configured"

    return False, f"unknown_channel:{channel}"


# ─── Transactional email templates ───

def _brand_wrapper(title: str, intro_html: str, body_html: str = "", footer_note: str = "") -> str:
    """Shared brand wrapper for all Cravitoo transactional emails."""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#FFF7F0;color:#1F1410;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FFF7F0;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border:1px solid rgba(255,90,31,0.15);border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#FF5A1F 0%,#FF7A45 100%);padding:24px 32px;">
          <div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Cravitoo</div>
          <div style="font-size:13px;color:#FFE8DC;margin-top:2px;">Good food. Easy order. Happy team.</div>
        </td></tr>
        <tr><td style="padding:36px 32px 24px 32px;">
          <h1 style="margin:0 0 12px 0;font-size:22px;color:#1F1410;font-weight:600;">{title}</h1>
          <div style="font-size:15px;color:#52443A;line-height:1.6;">{intro_html}</div>
          {body_html}
        </td></tr>
        <tr><td style="border-top:1px solid #F3E8DD;padding:18px 32px;background-color:#FFFBF7;">
          <p style="margin:0;font-size:12px;color:#9C8B80;line-height:1.5;">
            © 2026 Cravitoo Foods Private Limited.<br>
            {footer_note or "Need help? Reply to this email or write to support@cravitoo.com"}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def render_welcome_email(name: str, role: str = "employee") -> Tuple[str, str]:
    """Welcome email for new signups."""
    safe_name = (name or "there").split()[0][:40]
    if role == "vendor":
        body = """<p style="margin:24px 0 12px 0;font-weight:600;color:#1F1410;">What's next:</p>
<ul style="padding-left:20px;margin:0;color:#52443A;line-height:1.7;">
  <li>Complete your onboarding checklist</li>
  <li>Submit your KYC documents (GST, FSSAI, bank details)</li>
  <li>Review your Cravitoo-managed menu</li>
  <li>Start accepting orders on go-live day</li>
</ul>"""
    else:
        body = """<p style="margin:24px 0 12px 0;font-weight:600;color:#1F1410;">Here's what you can do:</p>
<ul style="padding-left:20px;margin:0;color:#52443A;line-height:1.7;">
  <li>🍴 Browse fresh menu options from your office cafe</li>
  <li>📱 Place an order — pickup with a QR code in seconds</li>
  <li>⭐ Earn loyalty points on every order</li>
  <li>❤️ Save your favorite vendors for one-tap reorders</li>
</ul>"""
    intro = f"Hi {safe_name}, welcome to Cravitoo! Your account is ready and waiting for you."
    html = _brand_wrapper("Welcome to Cravitoo!", f"<p>{intro}</p>", body)
    text = f"""Welcome to Cravitoo!

Hi {safe_name},

Your account is ready. Sign in and start exploring delicious food from your office vendors.

— Team Cravitoo
"""
    return html, text


def render_order_confirmation_email(name: str, order_id: str, vendor_name: str, items: list, total: float, pickup_time: Optional[str] = None) -> Tuple[str, str]:
    """Order placed confirmation email."""
    safe_name = (name or "there").split()[0][:40]
    safe_vendor = (vendor_name or "your vendor")[:80]
    items_html = "".join([
        f'<tr><td style="padding:8px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#1F1410;">{(it.get("name") or "Item")[:60]} <span style="color:#9C8B80;">× {it.get("quantity", 1)}</span></td><td style="padding:8px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#1F1410;text-align:right;">₹{(it.get("price", 0) * it.get("quantity", 1)):.2f}</td></tr>'
        for it in items[:20]  # cap to avoid huge emails
    ])
    body = f"""
<div style="background-color:#FFF1E5;border-radius:12px;padding:20px;margin:24px 0;">
  <p style="margin:0;font-size:13px;color:#9C8B80;">Order #</p>
  <p style="margin:2px 0 0 0;font-family:'SFMono-Regular',Menlo,monospace;font-size:18px;font-weight:700;color:#FF5A1F;letter-spacing:1px;">{order_id[-8:].upper()}</p>
</div>
<p style="margin:0 0 8px 0;font-weight:600;color:#1F1410;">Order details</p>
<p style="margin:0 0 16px 0;color:#52443A;font-size:14px;">From <strong>{safe_vendor}</strong>{f" — pickup at {pickup_time}" if pickup_time else ""}</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
  {items_html}
  <tr><td style="padding:14px 0 0 0;font-size:16px;font-weight:700;color:#1F1410;">Total</td><td style="padding:14px 0 0 0;font-size:16px;font-weight:700;color:#FF5A1F;text-align:right;">₹{total:.2f}</td></tr>
</table>
<p style="margin:24px 0 0 0;font-size:13px;color:#9C8B80;">Open the Cravitoo app and show your unique QR code at the pickup counter. You can track your order in real-time.</p>
"""
    intro = f"Hi {safe_name}, we've received your order and the vendor is being notified."
    html = _brand_wrapper("Order Confirmed 🍴", f"<p>{intro}</p>", body)
    text = f"""Order Confirmed!

Hi {safe_name},

Your order from {safe_vendor} has been confirmed.

Order ID: {order_id[-8:].upper()}
Total: ₹{total:.2f}

Open the Cravitoo app to track your order and get your pickup QR code.

— Team Cravitoo
"""
    return html, text


def render_weekly_admin_report_email(
    admin_name: str,
    period_label: str,
    metrics: Dict[str, Any],
    top_vendors: list,
) -> Tuple[str, str]:
    """Weekly summary report for master/site admins."""
    safe_name = (admin_name or "Admin").split()[0][:40]

    rows = [
        ("Total orders", str(metrics.get("orders", 0))),
        ("Revenue", f"₹{metrics.get('revenue', 0):,.2f}"),
        ("Average order value", f"₹{metrics.get('aov', 0):,.2f}"),
        ("Active employees", str(metrics.get('active_employees', 0))),
        ("New signups", str(metrics.get('new_signups', 0))),
        ("Refunds issued", f"{metrics.get('refunds_count', 0)} (₹{metrics.get('refunds_amount', 0):,.2f})"),
    ]
    metrics_html = "".join([
        f'<tr><td style="padding:10px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#52443A;">{k}</td><td style="padding:10px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#1F1410;text-align:right;font-weight:600;">{v}</td></tr>'
        for k, v in rows
    ])
    vendors_html = ""
    if top_vendors:
        vendors_html = """
<h3 style="margin:32px 0 12px 0;font-size:16px;color:#1F1410;font-weight:600;">Top vendors this week</h3>
<table cellspacing="0" cellpadding="0" border="0" width="100%">
""" + "".join([
            f'<tr><td style="padding:8px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#1F1410;">#{i+1} {(v.get("name") or "Vendor")[:50]}</td><td style="padding:8px 0;border-bottom:1px solid #F3E8DD;font-size:14px;color:#52443A;text-align:right;">{v.get("orders",0)} orders · ₹{v.get("revenue",0):,.0f}</td></tr>'
            for i, v in enumerate(top_vendors[:5])
        ]) + "</table>"

    body = f"""
<p style="margin:24px 0 12px 0;font-weight:600;color:#1F1410;font-size:16px;">{period_label}</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%">
  {metrics_html}
</table>
{vendors_html}
<p style="margin:32px 0 0 0;font-size:13px;color:#9C8B80;">Open the admin dashboard for detailed analytics, leaderboards, and exportable reports.</p>
"""
    intro = f"Hi {safe_name}, here's your Cravitoo performance summary."
    html = _brand_wrapper("Your Weekly Report", f"<p>{intro}</p>", body)
    text = f"""Cravitoo Weekly Report — {period_label}

Hi {safe_name},

{chr(10).join([f"{k}: {v}" for k, v in rows])}

Open the admin dashboard for detailed analytics.

— Team Cravitoo
"""
    return html, text



def render_daily_digest_email(name: str, date_label: str, orders: list, reservations: list) -> Tuple[str, str]:
    """End-of-day digest summarising the user's orders + tomorrow's pre-orders.

    Sent once per active user instead of a per-order email. Drops Resend volume ~70%
    when employees place multiple orders/reservations per day.
    """
    safe_name = (name or "there").split()[0][:40]
    has_orders = len(orders) > 0
    has_reservations = len(reservations) > 0

    orders_section = ""
    if has_orders:
        rows = "".join([
            f'<tr><td style="padding:6px 0;font-size:14px;color:#1F1410;">{(o.get("vendor_name") or "Vendor")[:60]}</td>'
            f'<td style="padding:6px 0;font-size:13px;color:#9C8B80;">{o.get("items_count", 0)} item(s)</td>'
            f'<td style="padding:6px 0;font-size:14px;color:#FF5A1F;text-align:right;font-weight:600;">₹{(o.get("amount") or 0):.2f}</td></tr>'
            for o in orders[:15]
        ])
        total = sum((o.get("amount") or 0) for o in orders)
        orders_section = f"""
<p style="margin:24px 0 8px 0;font-weight:600;color:#1F1410;">Today's orders</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
  {rows}
  <tr><td colspan="2" style="padding:12px 0 0 0;font-size:15px;font-weight:700;color:#1F1410;border-top:1px solid #F3E8DD;">Total spent today</td>
  <td style="padding:12px 0 0 0;font-size:15px;font-weight:700;color:#FF5A1F;text-align:right;border-top:1px solid #F3E8DD;">₹{total:.2f}</td></tr>
</table>"""

    reservations_section = ""
    if has_reservations:
        rrows = "".join([
            f'<tr><td style="padding:6px 0;font-size:14px;color:#1F1410;text-transform:capitalize;">{r.get("meal_period", "")}</td>'
            f'<td style="padding:6px 0;font-size:13px;color:#9C8B80;">{(r.get("vendor_name") or "Vendor")[:60]}</td>'
            f'<td style="padding:6px 0;font-size:12px;color:#9C8B80;text-align:right;font-family:SFMono-Regular,Menlo,monospace;">{(r.get("pickup_qr") or "")[-8:]}</td></tr>'
            for r in reservations[:8]
        ])
        first_date = reservations[0].get("delivery_date", "tomorrow") if reservations else "tomorrow"
        reservations_section = f"""
<p style="margin:24px 0 8px 0;font-weight:600;color:#1F1410;">Tomorrow's pre-orders ({first_date})</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
  {rrows}
</table>
<p style="margin:8px 0 0 0;color:#9C8B80;font-size:12px;">Show the last 8 chars of your QR code at the counter for instant pickup.</p>"""

    if not has_orders and not has_reservations:
        # No activity — skip the email entirely (caller should also guard against this)
        body = '<p style="color:#52443A;">No orders or reservations today. See you tomorrow!</p>'
    else:
        body = (orders_section + reservations_section).strip()

    intro = f"Hi {safe_name}, here's your Cravitoo recap for {date_label}."
    html = _brand_wrapper("Your Cravitoo recap", f"<p>{intro}</p>", body)

    text_parts = [f"Cravitoo recap for {date_label}", "", f"Hi {safe_name},", ""]
    if has_orders:
        text_parts.append("Today's orders:")
        for o in orders[:15]:
            text_parts.append(f"  • {o.get('vendor_name', 'Vendor')} — {o.get('items_count', 0)} item(s) — ₹{(o.get('amount') or 0):.2f}")
        text_parts.append(f"  Total: ₹{sum((o.get('amount') or 0) for o in orders):.2f}")
        text_parts.append("")
    if has_reservations:
        first_date = reservations[0].get("delivery_date", "tomorrow")
        text_parts.append(f"Tomorrow's pre-orders ({first_date}):")
        for r in reservations[:8]:
            text_parts.append(f"  • {r.get('meal_period', '')} — {r.get('vendor_name', 'Vendor')} — QR ...{(r.get('pickup_qr') or '')[-8:]}")
        text_parts.append("")
    text_parts.append("Open the Cravitoo app for full details.")
    text_parts.append("— Team Cravitoo")
    text = "\n".join(text_parts)
    return html, text


def render_broadcast_email(name: str, title: str, message: str, sender: str = "Cravitoo Team") -> Tuple[str, str]:
    """Master Admin broadcast announcement (email channel, optional)."""
    safe_name = (name or "there").split()[0][:40]
    safe_title = (title or "Announcement")[:120]
    safe_message = (message or "").replace("\n", "<br>")[:4000]
    body = f"""
<p style="margin:0 0 16px 0;color:#52443A;font-size:15px;line-height:1.6;">{safe_message}</p>
<p style="margin:24px 0 0 0;color:#9C8B80;font-size:12px;">Sent by {sender}</p>"""
    html = _brand_wrapper(safe_title, f"<p>Hi {safe_name},</p>", body)
    text = f"""{safe_title}

Hi {safe_name},

{message[:4000]}

Sent by {sender}
— Team Cravitoo
"""
    return html, text



def render_vendor_daily_digest_email(name: str, date_label: str, metrics: Dict[str, Any], top_items: list) -> Tuple[str, str]:
    """End-of-day digest for vendors — orders, revenue, top items, prep stats."""
    safe_name = (name or "Partner").split()[0][:40]
    orders = metrics.get("orders", 0)
    revenue = metrics.get("revenue", 0)
    aov = (revenue / orders) if orders else 0
    refunds_count = metrics.get("refunds_count", 0)
    refunds_amount = metrics.get("refunds_amount", 0)
    new_reservations = metrics.get("new_reservations_for_tomorrow", 0)

    rows = [
        ("Orders fulfilled", str(orders)),
        ("Revenue", f"₹{revenue:,.2f}"),
        ("Average order value", f"₹{aov:,.2f}"),
        ("Refunds issued", f"{refunds_count} (₹{refunds_amount:,.2f})"),
        ("Pre-orders for tomorrow", str(new_reservations)),
    ]
    metrics_html = "".join([
        f'<tr><td style="padding:8px 0;font-size:14px;color:#52443A;">{k}</td>'
        f'<td style="padding:8px 0;font-size:15px;font-weight:700;color:#1F1410;text-align:right;">{v}</td></tr>'
        for k, v in rows
    ])

    top_html = ""
    if top_items:
        top_rows = "".join([
            f'<tr><td style="padding:6px 0;font-size:14px;color:#1F1410;">{(it.get("name") or "Item")[:60]}</td>'
            f'<td style="padding:6px 0;font-size:13px;color:#9C8B80;text-align:right;">× {it.get("qty", 0)}</td>'
            f'<td style="padding:6px 0;font-size:13px;color:#FF5A1F;text-align:right;font-weight:600;">₹{(it.get("revenue") or 0):,.0f}</td></tr>'
            for it in top_items[:5]
        ])
        top_html = f"""
<p style="margin:24px 0 8px 0;font-weight:600;color:#1F1410;">Top items today</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
  {top_rows}
</table>"""

    body = f"""
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:16px;">
  {metrics_html}
</table>
{top_html}
<p style="margin:24px 0 0 0;font-size:13px;color:#9C8B80;">Open the Cravitoo Partner app for live order updates and detailed analytics.</p>
"""
    intro = f"Hi {safe_name}, here's your sales summary for {date_label}."
    html = _brand_wrapper("Your sales recap", f"<p>{intro}</p>", body)

    text_parts = [f"Sales recap for {date_label}", "", f"Hi {safe_name},", ""]
    for k, v in rows:
        text_parts.append(f"  {k}: {v}")
    text_parts.append("")
    if top_items:
        text_parts.append("Top items:")
        for it in top_items[:5]:
            text_parts.append(f"  • {it.get('name','Item')} × {it.get('qty',0)} = ₹{(it.get('revenue') or 0):,.0f}")
        text_parts.append("")
    text_parts.append("Open the Cravitoo Partner app for live order updates.")
    text_parts.append("— Team Cravitoo")
    text = "\n".join(text_parts)
    return html, text
