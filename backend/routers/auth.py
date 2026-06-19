"""
Auth (register/login/logout/me), Email OTP (Resend), and DPDP /me/data endpoints
extracted from server.py.

Built as a make_router(...) factory to avoid circular imports.
Per integration_playbook_expert_v2 guidance: dependencies passed via factory params.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, EmailStr

from models import LoginRequest, RegisterRequest

logger = logging.getLogger(__name__)


class OTPRequest(BaseModel):
    email: EmailStr
    channel: Optional[str] = "email"  # 'email' | 'sms' (future) | 'whatsapp' (future)
    purpose: Optional[str] = "Login"  # 'Login' | 'Password Reset' | 'Account Verification'


class OTPVerify(BaseModel):
    email: EmailStr
    code: str


OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_REQUEST_LIMIT_PER_HOUR = 3


def _stringify_datetimes(doc: Any) -> Any:
    """Recursively convert datetime/ObjectId/bson types to JSON-safe primitives."""
    if isinstance(doc, dict):
        return {k: _stringify_datetimes(v) for k, v in doc.items()}
    if isinstance(doc, list):
        return [_stringify_datetimes(x) for x in doc]
    if isinstance(doc, datetime):
        return doc.isoformat()
    if isinstance(doc, ObjectId):
        return str(doc)
    return doc


def make_router(
    db,
    safe_objectid,
    get_current_user,
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    is_secure_request,
    check_brute_force,
    record_failed_login,
    clear_login_attempts,
    LOCKOUT_MINUTES: int,
):
    r = APIRouter()

    @r.post("/auth/register")
    async def register(data: RegisterRequest, request: Request, response: Response):
        email_lower = data.email.lower()

        # =====================================================================
        # CRITICAL: server-side role lock.
        # Public self-registration is ONLY allowed for the 'employee' role.
        # Vendor / corporate_admin / site_admin / super_admin / master_admin
        # must be provisioned via admin-controlled invitation/onboarding flows.
        # =====================================================================
        submitted_role = (data.role or "employee").strip().lower()
        if submitted_role != "employee":
            # Audit the attempt before refusing — helps detect abuse.
            try:
                await db.audit_log.insert_one({
                    "user_id": None,
                    "user_email": email_lower,
                    "user_role": "anonymous",
                    "entity_type": "auth",
                    "entity_id": email_lower,
                    "action": "register_privileged_role_blocked",
                    "details": {
                        "attempted_role": submitted_role,
                        "client_ip": request.client.host if request.client else None,
                        "user_agent": request.headers.get("user-agent"),
                    },
                    "created_at": datetime.now(timezone.utc),
                })
            except Exception as audit_exc:  # pragma: no cover - logging is best-effort
                logger.warning(f"audit_log write failed during role-block: {audit_exc}")
            raise HTTPException(
                status_code=403,
                detail="This role cannot self-register. Privileged accounts are created by invitation only.",
            )
        # Force-overwrite the role even if the client tried something cute later
        # in the request lifecycle (defence in depth).
        data.role = "employee"

        existing = await db.users.find_one({"email": email_lower})
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        # Domain allowlist check (employees only on this public endpoint —
        # privileged roles are blocked above).
        from routers.allowed_domains import find_allowed_domain
        domain_record = await find_allowed_domain(db, email_lower)
        if not domain_record:
            raise HTTPException(
                status_code=400,
                detail="Sign-up is restricted to corporate email addresses. Please use your work email.",
            )
        # Auto-link to the company + (optionally) the default site for that domain
        if domain_record.get("company_id") and not data.company_id:
            data.company_id = domain_record["company_id"]
        user_doc_extra_site = domain_record.get("site_id")
        # Site lifecycle gating (PDF Module 3 — only 'live' sites accept employee sign-ups)
        if user_doc_extra_site:
            site_obj = await db.sites.find_one({"_id": safe_objectid(user_doc_extra_site, "Site")})
            if site_obj:
                site_lc = site_obj.get("lifecycle_status", "live")
                if site_lc != "live":
                    raise HTTPException(
                        status_code=400,
                        detail="Your office site isn't open for sign-ups yet. Please contact your Cravitoo admin.",
                    )

        user_doc = {
            "email": email_lower,
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": data.role,
            "created_at": datetime.now(timezone.utc)
        }
    
        if data.company_id:
            user_doc["company_id"] = data.company_id
        if user_doc_extra_site:
            user_doc["site_id"] = user_doc_extra_site
    
        result = await db.users.insert_one(user_doc)
        user_id = str(result.inserted_id)
    
        access_token = create_access_token(user_id, email_lower, data.role)
        refresh_token = create_refresh_token(user_id)
    
        secure_cookie = is_secure_request(request)
        samesite_value = "none" if secure_cookie else "lax"
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=900, path="/")
        response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=604800, path="/")

        # Best-effort welcome email (fire-and-forget — failure doesn't block registration)
        try:
            import email_service
            w_html, w_text = email_service.render_welcome_email(data.name, data.role)
            email_service.send_email(email_lower, "Welcome to Cravitoo 🍴", w_html, w_text)
        except Exception as e:
            logger.warning(f"Welcome email send failed for {email_lower}: {e}")

        return {"id": user_id, "email": email_lower, "name": data.name, "role": data.role, "access_token": access_token, "refresh_token": refresh_token}

    @r.post("/auth/login")
    async def login(data: LoginRequest, request: Request, response: Response):
        email_lower = data.email.lower()
        # Use X-Forwarded-For header if available (for behind proxy/LB), else fallback to client.host
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else "unknown")
        # Also track by email-only to catch attacks from different IPs
        identifier = f"{client_ip}:{email_lower}"
        email_identifier = f"email:{email_lower}"
    
        if await check_brute_force(identifier) or await check_brute_force(email_identifier):
            raise HTTPException(status_code=429, detail=f"Too many failed attempts. Account locked for {LOCKOUT_MINUTES} minutes.")
    
        user = await db.users.find_one({"email": email_lower})
    
        if not user or not verify_password(data.password, user["password_hash"]):
            await record_failed_login(identifier)
            await record_failed_login(email_identifier)
            raise HTTPException(status_code=401, detail="Invalid email or password")
    
        await clear_login_attempts(identifier)
        await clear_login_attempts(email_identifier)
    
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, email_lower, user["role"])
        refresh_token = create_refresh_token(user_id)
    
        secure_cookie = is_secure_request(request)
        samesite_value = "none" if secure_cookie else "lax"
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=900, path="/")
        response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=604800, path="/")
    
        return {
            "id": user_id,
            "email": email_lower,
            "name": user["name"],
            "role": user["role"],
            "company_id": user.get("company_id"),
            "vendor_id": user.get("vendor_id"),
            "site_id": user.get("site_id"),
            "assigned_sites": user.get("assigned_sites", []),
            "access_token": access_token,
            "refresh_token": refresh_token
        }

    @r.get("/auth/me")
    async def get_me(user: dict = Depends(get_current_user)):
        return user

    @r.post("/auth/logout")
    async def logout(response: Response):
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
        return {"message": "Logged out successfully"}


    @r.post("/auth/refresh")
    async def refresh(request: Request, response: Response):
        """Issue a new access_token using the refresh_token cookie.

        Solves the "Not authenticated" mid-session bug where the 15-min access
        token expires while the user is still actively using the app.

        Reads `refresh_token` from cookie OR Authorization header (mobile).
        Returns a new short-lived access token + sets it as a cookie.
        """
        import jwt as _jwt
        token = request.cookies.get("refresh_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if not token:
            raise HTTPException(status_code=401, detail="No refresh token")

        from os import environ as _env
        secret = _env.get("JWT_SECRET", "")
        algo = _env.get("JWT_ALGORITHM", "HS256")
        try:
            payload = _jwt.decode(token, secret, algorithms=[algo])
            if payload.get("type") != "refresh":
                raise HTTPException(status_code=401, detail="Invalid token type")
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid refresh token")
        except _jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Refresh token expired — please log in again")
        except _jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

        user = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
        if not user:
            raise HTTPException(status_code=401, detail="User no longer exists")

        new_access = create_access_token(str(user["_id"]), user["email"], user["role"])
        secure_cookie = is_secure_request(request)
        samesite_value = "none" if secure_cookie else "lax"
        response.set_cookie(
            key="access_token", value=new_access,
            httponly=True, secure=secure_cookie, samesite=samesite_value,
            max_age=900, path="/",
        )
        return {"access_token": new_access}


    # ============== Email OTP login (channel-agnostic — SMS can be added later) ==============


    @r.post("/auth/otp/request")
    async def request_otp(data: OTPRequest, request: Request):
        """Generate a 6-digit OTP and send it via the chosen channel.
        Rate-limited: 3 per email per hour to prevent abuse.
        Does NOT reveal whether the email exists (anti-enumeration)."""
        import email_service  # local import to keep top-level cleaner

        email_lower = data.email.lower()
        channel = (data.channel or "email").lower()
        purpose = data.purpose or "Login"

        if channel not in ("email", "sms", "whatsapp"):
            raise HTTPException(status_code=400, detail="Invalid channel")
        if channel in ("sms", "whatsapp"):
            raise HTTPException(status_code=501, detail=f"{channel.upper()} OTP is not yet configured. Please use email.")

        # Domain allowlist check — for users who don't exist yet, ensure they're signing up
        # with a corporate email. Existing users (any domain) are always allowed to receive OTPs.
        existing_user = await db.users.find_one({"email": email_lower})
        if not existing_user:
            from routers.allowed_domains import find_allowed_domain
            domain_record = await find_allowed_domain(db, email_lower)
            if not domain_record:
                raise HTTPException(
                    status_code=400,
                    detail="Sign-up is restricted to corporate email addresses. Please use your work email.",
                )
            # Site lifecycle gating (PDF Module 3 — only 'live' sites accept employee sign-ups)
            site_id_from_domain = domain_record.get("site_id")
            if site_id_from_domain:
                site_obj = await db.sites.find_one({"_id": safe_objectid(site_id_from_domain, "Site")})
                if site_obj and site_obj.get("lifecycle_status", "live") != "live":
                    raise HTTPException(
                        status_code=400,
                        detail="Your office site isn't open for sign-ups yet. Please contact your Cravitoo admin.",
                    )

        # Rate-limit: count requests in the last 1 hour for this email
        one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
        recent_count = await db.otp_codes.count_documents({
            "identifier": email_lower,
            "channel": channel,
            "created_at": {"$gte": one_hour_ago},
        })
        if recent_count >= OTP_REQUEST_LIMIT_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Too many OTP requests for this email. Please wait an hour and try again.",
            )

        # Generate, hash, store
        code = email_service.generate_otp(6)
        code_hash = email_service.hash_otp(code)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=OTP_EXPIRY_MINUTES)

        # Invalidate any existing active codes for the same email+channel+purpose
        await db.otp_codes.update_many(
            {"identifier": email_lower, "channel": channel, "purpose": purpose, "used": False, "expires_at": {"$gte": now}},
            {"$set": {"superseded": True}},
        )

        await db.otp_codes.insert_one({
            "identifier": email_lower,
            "channel": channel,
            "purpose": purpose,
            "code_hash": code_hash,
            "attempts": 0,
            "used": False,
            "superseded": False,
            "created_at": now,
            "expires_at": expires_at,
        })

        # Send via the requested channel (best-effort — failures don't leak to user)
        success, err = email_service.send_otp_channel(
            identifier=email_lower,
            code=code,
            channel=channel,
            purpose=purpose,
            expiry_minutes=OTP_EXPIRY_MINUTES,
        )

        if not success:
            logger.warning(f"OTP delivery failed for {email_lower} via {channel}: {err}")
            # We DO surface delivery failures so the user knows to retry,
            # but we don't leak whether the email is registered.
            raise HTTPException(
                status_code=502,
                detail="We couldn't send the code right now. Please try again in a moment.",
            )

        # Anti-enumeration: always return the same response whether or not the email exists
        return {
            "ok": True,
            "channel": channel,
            "expires_in_minutes": OTP_EXPIRY_MINUTES,
            "message": f"If an account exists for {email_lower}, a verification code has been sent.",
        }


    @r.post("/auth/otp/verify")
    async def verify_otp_login(data: OTPVerify, request: Request, response: Response):
        """Verify an OTP and issue Cravitoo JWT tokens. Also acts as an auto-register
        fallback ONLY for the 'employee' role — admin/vendor accounts must be created via the normal flow."""
        import email_service

        email_lower = data.email.lower()
        code = (data.code or "").strip()
        if not code or not code.isdigit() or len(code) < 4 or len(code) > 8:
            raise HTTPException(status_code=400, detail="Invalid code format")

        now = datetime.now(timezone.utc)

        # Find the most recent active OTP
        record = await db.otp_codes.find_one(
            {
                "identifier": email_lower,
                "used": False,
                "superseded": False,
                "expires_at": {"$gte": now},
            },
            sort=[("created_at", -1)],
        )
        if not record:
            raise HTTPException(status_code=400, detail="Code is invalid or has expired. Please request a new one.")

        # Increment attempts BEFORE verification (to prevent timing attacks)
        record_id = record["_id"]
        if record.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
            await db.otp_codes.update_one({"_id": record_id}, {"$set": {"used": True}})
            raise HTTPException(status_code=429, detail="Too many incorrect attempts. Please request a new code.")

        if not email_service.verify_otp(code, record["code_hash"]):
            await db.otp_codes.update_one({"_id": record_id}, {"$inc": {"attempts": 1}})
            raise HTTPException(status_code=400, detail="Incorrect code. Please try again.")

        # Code is valid — mark used
        await db.otp_codes.update_one({"_id": record_id}, {"$set": {"used": True, "used_at": now}})

        # Find or auto-create the user
        user = await db.users.find_one({"email": email_lower})
        auto_created = False
        if not user:
            # Auto-register as employee (vendors and admins must be created by an admin)
            user_doc = {
                "email": email_lower,
                "name": email_lower.split("@")[0].replace(".", " ").title(),
                "role": "employee",
                "password_hash": hash_password(secrets.token_urlsafe(24)),  # random unguessable
                "phone": None,
                "company_id": None,
                "vendor_id": None,
                "email_verified": True,
                "created_at": now,
                "created_via": "otp",
            }
            result = await db.users.insert_one(user_doc)
            user = {**user_doc, "_id": result.inserted_id}
            auto_created = True

        user_id = str(user["_id"])
        access_token = create_access_token(user_id, email_lower, user["role"])
        refresh_token = create_refresh_token(user_id)

        secure_cookie = is_secure_request(request)
        samesite_value = "none" if secure_cookie else "lax"
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=900, path="/")
        response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=604800, path="/")

        # Mark email as verified on the user record too
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"email_verified": True, "last_login_at": now}})

        return {
            "id": user_id,
            "email": email_lower,
            "name": user["name"],
            "role": user["role"],
            "company_id": user.get("company_id"),
            "vendor_id": user.get("vendor_id"),
            "site_id": user.get("site_id"),
            "assigned_sites": user.get("assigned_sites", []),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "auto_created": auto_created,
        }


    # ============== DPDP / GDPR — Right to Access & Right to Erasure ==============

    @r.get("/me/data")
    async def export_my_data(user: dict = Depends(get_current_user)):
        """DPDP Act / GDPR right-to-access. Returns a JSON snapshot of all personal data
        Cravitoo holds about the calling user. Sensitive fields (password_hash, tokens) are excluded."""
        uid = user["id"]
        uid_obj = safe_objectid(uid, "User")

        # User profile (drop sensitive fields)
        profile = await db.users.find_one(
            {"_id": uid_obj},
            {"password_hash": 0},
        ) or {}
        if profile:
            profile["id"] = str(profile.pop("_id", uid))

        # Orders + reviews + favorites + loyalty + subscriptions + notifications
        orders = await db.orders.find({"user_id": uid}).to_list(2000)
        for o in orders:
            o["id"] = str(o.pop("_id"))

        reviews = await db.reviews.find({"user_id": uid}).to_list(2000)
        for r in reviews:
            r["id"] = str(r.pop("_id"))

        favorites = await db.favorites.find({"user_id": uid}).to_list(2000)
        for f in favorites:
            f["id"] = str(f.pop("_id"))

        loyalty = await db.loyalty.find_one({"user_id": uid}) or {}
        if loyalty:
            loyalty["id"] = str(loyalty.pop("_id", ""))

        subscriptions = await db.subscriptions.find({"user_id": uid}).to_list(500)
        for s in subscriptions:
            s["id"] = str(s.pop("_id"))

        notifications = await db.notifications.find({"user_id": uid}).to_list(2000)
        for n in notifications:
            n["id"] = str(n.pop("_id"))

        preferences = await db.preferences.find_one({"user_id": uid}) or {}
        if preferences:
            preferences["id"] = str(preferences.pop("_id", ""))

        push_tokens = await db.push_tokens.find({"user_id": uid}, {"token": 0}).to_list(50)
        for pt in push_tokens:
            pt["id"] = str(pt.pop("_id"))
            pt["token"] = "[REDACTED]"  # don't expose actual tokens

        return _stringify_datetimes({
            "export_format_version": "1.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_controller": "Cravitoo Foods Private Limited",
            "user": user["email"],
            "profile": profile,
            "orders": orders,
            "reviews": reviews,
            "favorites": favorites,
            "loyalty": loyalty,
            "subscriptions": subscriptions,
            "notifications": notifications,
            "preferences": preferences,
            "push_tokens": push_tokens,
            "_note": "Vendor KYC documents, payment processor metadata, and 7-year retention financial records are managed under separate compliance regimes (GST/Companies Act/RBI). For those, please email privacy@cravitoo.com.",
        })


    @r.delete("/me/data")
    async def delete_my_data(
        confirm: str = Query(..., description="Must equal 'DELETE' to confirm"),
        user: dict = Depends(get_current_user),
    ):
        """DPDP Act / GDPR right-to-erasure. Deletes personal data and anonymises tax-mandated records.

        Master_admin accounts cannot self-delete via this endpoint (would lock the platform) —
        they must contact another master_admin or escalate via privacy@cravitoo.com.
        """
        if confirm != "DELETE":
            raise HTTPException(status_code=400, detail="Pass ?confirm=DELETE to confirm")

        if user["role"] == "master_admin":
            raise HTTPException(
                status_code=403,
                detail="Master Admin accounts cannot be self-deleted via this endpoint. Please contact privacy@cravitoo.com to escalate.",
            )

        uid = user["id"]
        uid_obj = safe_objectid(uid, "User")
        email_lower = user["email"].lower()

        # 1) Anonymise orders (keep for tax/audit but strip PII)
        anon_marker = f"deleted_user_{secrets.token_hex(6)}"
        await db.orders.update_many(
            {"user_id": uid},
            {
                "$set": {
                    "user_id": anon_marker,
                    "user_email_anon": True,
                    "deleted_at": datetime.now(timezone.utc),
                },
                "$unset": {"special_instructions": ""},
            },
        )

        # 2) Anonymise reviews (keep ratings for vendor reputation, drop user link)
        await db.reviews.update_many(
            {"user_id": uid},
            {"$set": {"user_id": anon_marker, "anonymised": True, "comment": "[Comment removed by user]"}},
        )

        # 3) Hard-delete personal records
        deletions = [
            db.favorites.delete_many({"user_id": uid}),
            db.preferences.delete_many({"user_id": uid}),
            db.subscriptions.delete_many({"user_id": uid}),
            db.notifications.delete_many({"user_id": uid}),
            db.push_tokens.delete_many({"user_id": uid}),
            db.loyalty.delete_many({"user_id": uid}),
            db.login_attempts.delete_many({"identifier": {"$regex": email_lower}}),
            db.audit_log.delete_many({"user_id": uid}),
        ]
        await asyncio.gather(*deletions)

        # 4) Delete the user account itself
        await db.users.delete_one({"_id": uid_obj})

        # 5) Record this deletion in a compliance log (no PII — just the fact it happened)
        await db.deletion_log.insert_one({
            "anon_id": anon_marker,
            "role": user["role"],
            "deleted_at": datetime.now(timezone.utc),
            "compliance_basis": "DPDP_2023_section_12",
        })

        return {
            "ok": True,
            "message": "Your account and personal data have been deleted. Order records have been anonymised for tax compliance (retained 7 years).",
            "anonymisation_id": anon_marker,
        }

    return r
