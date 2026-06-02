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
from typing import Optional, Tuple

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
