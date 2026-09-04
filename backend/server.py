from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, WebSocket, WebSocketDisconnect, Query, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
import re
import uuid
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any, Set
from datetime import datetime, timezone, timedelta
from bson import ObjectId
import os
import logging
import bcrypt
import jwt
import secrets
import asyncio
import hashlib
import io
import openpyxl
import httpx
from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Health endpoint — must be fast, no DB touch, used by K8s liveness/readiness probes
@api_router.get("/health")
async def health_check():
    return {"status": "ok"}


@api_router.get("/health/email")
async def health_email():
    """Read-only Resend health probe.

    Returns whether RESEND_API_KEY is configured and whether the FROM domain
    is verified on the Resend account.  Does NOT send a test email.

    Public (no auth) so an external uptime monitor can poll it, BUT it never
    echoes the API key — only the public-safe fields: from_email, from_name,
    domain, domain_verified, all_domains (names + statuses).
    """
    from email_service import resend_health_check
    return resend_health_check()


@app.get("/")
async def root():
    return {"status": "ok", "service": "cravitoo-api"}


# Kubernetes liveness / readiness probe. Kept OUTSIDE the /api prefix
# because the ingress does NOT rewrite /api → / for probes; k8s hits
# the container port directly on /health.
@app.get("/health")
async def health():
    return {"status": "ok"}

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        # user_id -> set of websockets (multiple devices per user)
        self.user_connections: Dict[str, Set[WebSocket]] = {}
        # vendor_id -> set of websockets
        self.vendor_connections: Dict[str, Set[WebSocket]] = {}

    async def connect_user(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.user_connections:
            self.user_connections[user_id] = set()
        self.user_connections[user_id].add(websocket)

    async def connect_vendor(self, vendor_id: str, websocket: WebSocket):
        await websocket.accept()
        if vendor_id not in self.vendor_connections:
            self.vendor_connections[vendor_id] = set()
        self.vendor_connections[vendor_id].add(websocket)

    def disconnect_user(self, user_id: str, websocket: WebSocket):
        if user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

    def disconnect_vendor(self, vendor_id: str, websocket: WebSocket):
        if vendor_id in self.vendor_connections:
            self.vendor_connections[vendor_id].discard(websocket)
            if not self.vendor_connections[vendor_id]:
                del self.vendor_connections[vendor_id]

    async def send_to_user(self, user_id: str, message: dict):
        if user_id not in self.user_connections:
            return
        dead = set()
        for ws in list(self.user_connections[user_id]):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.user_connections[user_id].discard(ws)

    async def send_to_vendor(self, vendor_id: str, message: dict):
        if vendor_id not in self.vendor_connections:
            return
        dead = set()
        for ws in list(self.vendor_connections[vendor_id]):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.vendor_connections[vendor_id].discard(ws)

manager = ConnectionManager()

def verify_ws_token(token: str) -> Optional[dict]:
    """Validate JWT token from WebSocket query string. Returns payload dict or None."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# Helper Functions
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role, "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# Refresh tokens last 365 days so mobile users stay logged in across app
# close / device restart without re-authenticating. Session terminates only
# when the user manually logs out or an admin deactivates the account
# (checked in `get_current_user` and `/auth/refresh`).
REFRESH_TOKEN_DAYS = 365

def create_refresh_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),   # used for password-change revocation
        "exp": now + timedelta(days=REFRESH_TOKEN_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": safe_objectid(payload["sub"], "User")})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Kick deactivated accounts immediately (session ends the moment an
        # admin flips is_active=False). Field is optional — treat missing/None
        # as active for backwards compatibility with existing rows.
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Account deactivated")
        user["_id"] = str(user["_id"])
        user["id"] = user["_id"]
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Models — extracted to /app/backend/models.py during iteration 12 refactor
from models import (  # noqa: E402
    RegisterRequest, LoginRequest, UserResponse,
    CompanyCreate, CompanyResponse,
    VendorCreate, VendorResponse,
    MenuItemCreate, MenuItemResponse, MenuItemSiteUpdate,
    OrderItemInput, OrderCreate, OrderResponse, OrderStatus,
    AIRecommendationRequest,
    SiteCreate, VendorSiteMappingCreate, MealScheduleEntry, MealScheduleUpdate,
    CityCreate, CityAdminCreate,
    VendorOnboardingBasic, VendorOnboardingUpdate, ChecklistUpdate, OnboardingDecision,
    CHECKLIST_FIELDS, DOC_TYPES, ONBOARDING_STATUSES,
    SiteAdminCreate, SuperAdminCreate, MasterAdminCreate,
    ReviewCreate, PreferencesUpdate, SubscriptionCreate,
    EmployeeCreate, BulkOrderItem, BulkOrderCreate, EventCateringCreate,
    NotificationCreate, LoyaltyRedeemRequest,
    RazorpayOrderCreate, RazorpayVerify, RazorpayCheckoutIntent,
    PushTokenRegister,
)

from enum import Enum  # kept for any local enums elsewhere

# Helper - safe ObjectId parsing
def safe_objectid(id_str: str, entity_name: str = "Resource") -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=404, detail=f"{entity_name} not found")

# Role helpers (defined early so all routes + extracted routers can use them)
def is_master_admin(user: dict) -> bool:
    return user.get("role") == "master_admin"

def is_master_or_super(user: dict) -> bool:
    return user.get("role") in ("master_admin", "super_admin")


# ─── Email deliverability probe (Master-Admin real send) ──────────────
class _TestEmailBody(BaseModel):
    to: EmailStr


@api_router.post("/admin/email/send-test")
async def send_test_email(body: _TestEmailBody, user: dict = Depends(get_current_user)):
    """Master-Admin-only real send probe.

    Sends a small "Cravitoo email health check" message via Resend and
    surfaces the provider's error verbatim. Purpose: prove end-to-end
    that the ``RESEND_API_KEY``, verified domain, DKIM/SPF DNS records
    and the recipient's mailbox allowlist all cooperate BEFORE
    onboarding a new corporate client. Role-guarded — do not open to
    non-admins (would allow authenticated spam through our verified
    sender).
    """
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

def can_access_site(user: dict, site_id: str) -> bool:
    role = user.get("role")
    if role == "master_admin":
        return True
    if role == "super_admin":
        return site_id in (user.get("assigned_sites") or [])
    if role == "site_admin":
        return user.get("site_id") == site_id
    return False

def current_meal_period(schedules: list) -> Optional[str]:
    now = datetime.now(timezone.utc).astimezone()
    current = now.strftime("%H:%M")
    for s in schedules:
        if s.get("enabled") and s.get("start_time") <= current <= s.get("end_time"):
            return s["meal_period"]
    return None

# Helper - detect if request is HTTPS
def is_secure_request(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    return forwarded_proto == "https" or request.url.scheme == "https"

# Helper - generate QR code data for order pickup
def generate_pickup_qr(order_id: str) -> str:
    qr_hash = hashlib.sha256(f"{order_id}{JWT_SECRET}".encode()).hexdigest()[:16]
    return f"CRAVITOO-PICKUP-{order_id}-{qr_hash}"

def verify_pickup_qr(qr_code: str, order_id: str) -> bool:
    qr_hash = hashlib.sha256(f"{order_id}{JWT_SECRET}".encode()).hexdigest()[:16]
    expected = f"CRAVITOO-PICKUP-{order_id}-{qr_hash}"
    return qr_code == expected

# Brute force protection
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

async def check_brute_force(identifier: str) -> bool:
    """Returns True if locked out, False if OK to proceed"""
    record = await db.login_attempts.find_one({"identifier": identifier})
    if not record:
        return False
    if record.get("attempts", 0) >= MAX_LOGIN_ATTEMPTS:
        locked_until = record.get("locked_until")
        if locked_until:
            # MongoDB returns naive datetime - convert to aware
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < locked_until:
                return True
            await db.login_attempts.delete_one({"identifier": identifier})
    return False

async def record_failed_login(identifier: str):
    record = await db.login_attempts.find_one({"identifier": identifier})
    if record:
        new_attempts = record.get("attempts", 0) + 1
        update = {"attempts": new_attempts, "last_attempt": datetime.now(timezone.utc)}
        if new_attempts >= MAX_LOGIN_ATTEMPTS:
            update["locked_until"] = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": update})
    else:
        await db.login_attempts.insert_one({
            "identifier": identifier,
            "attempts": 1,
            "last_attempt": datetime.now(timezone.utc)
        })

async def clear_login_attempts(identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})

# Startup Events
@app.on_event("startup")
async def startup_event():
    """Resilient, NON-BLOCKING startup — never block FastAPI from serving requests.
    Seed/index work runs in background so the health probe responds fast."""

    async def _index_and_seed():
        index_ops = [
            ("users", "email", {"unique": True}),
            ("password_reset_tokens", "expires_at", {"expireAfterSeconds": 0}),
            ("login_attempts", "identifier", {}),
            ("companies", "name", {}),
            ("vendors", "name", {}),
            ("menu_items", "vendor_id", {}),
            ("menu_items", "site_id", {}),
            ("orders", "user_id", {}),
            ("orders", "vendor_id", {}),
            ("orders", "site_id", {}),
            ("notifications", "user_id", {}),
            ("notifications", "created_at", {}),
            ("sites", "name", {}),
        ]
        for coll, field, opts in index_ops:
            try:
                await db[coll].create_index(field, **opts)
            except Exception as e:
                logger.warning(f"Index create skipped on {coll}.{field}: {e}")

        try:
            await db.vendor_site_mappings.create_index([("vendor_id", 1), ("site_id", 1)], unique=True)
        except Exception as e:
            logger.warning(f"vendor_site_mappings index skipped: {e}")
        try:
            await db.meal_schedules.create_index("site_id", unique=True)
        except Exception as e:
            logger.warning(f"meal_schedules index skipped: {e}")

        # Phase 1: order_status_history audit collection — fast lookups by order
        # and time-bounded queries (for analytics / forensic search).  These
        # indexes are critical now that we write a row on every transition.
        try:
            await db.order_status_history.create_index([("order_id", 1), ("created_at", -1)])
            await db.order_status_history.create_index("actor_id")
            await db.order_status_history.create_index("created_at")
        except Exception as e:
            logger.warning(f"order_status_history indexes skipped: {e}")

        # Phase 1: audit_log — frequent queries by entity_type + created_at.
        try:
            await db.audit_log.create_index([("entity_type", 1), ("created_at", -1)])
            await db.audit_log.create_index([("user_email", 1), ("created_at", -1)])
        except Exception as e:
            logger.warning(f"audit_log indexes skipped: {e}")

        try:
            await seed_admin()
        except Exception as e:
            logger.error(f"seed_admin failed: {e}")
        # Cafeteria layer auto-migration — every site gets a default "Main
        # Cafeteria" and every legacy vendor mapping is pinned to it so
        # existing site-level routing keeps working unchanged.
        try:
            from routers.cafeterias import ensure_default_cafeterias as _ensure_cafs
            stats = await _ensure_cafs(db)
            logger.info(f"Cafeteria migration: {stats}")
        except Exception as e:
            logger.error(f"Cafeteria migration failed: {e}")
        # Bootstrap persistent object storage session.
        try:
            from storage import init_storage
            init_storage()
            logger.info("Emergent Object Storage initialized")
        except Exception as e:
            logger.error(f"Object storage init failed: {e}")
        # NOTE: auto seed_demo_data is permanently disabled. Client demo
        # environment must stay clean; any demo/test rows must be created
        # explicitly by the master admin. See PRD.md (Feb 2026).

        # Resend health check at startup — single source of truth for whether
        # the configured FROM domain is verified. Mis-configured DNS is the
        # most common production email failure; surface it loudly here.
        try:
            from email_service import resend_health_check
            health = resend_health_check()
            if health.get("error"):
                logger.warning(f"Resend health: ERROR — {health['error']}")
            elif not health.get("configured"):
                logger.warning("Resend health: RESEND_API_KEY not set — emails disabled")
            elif health.get("key_scope") == "send_only":
                logger.info(
                    f"Resend health: OK · from={health.get('from_email')} · "
                    f"key_scope=send_only (least-privilege — domain status not introspectable)"
                )
            elif health.get("domain_verified") is True:
                logger.info(
                    f"Resend health: OK · from={health.get('from_email')} · "
                    f"domain={health.get('domain')} (verified) · "
                    f"total_domains={len(health.get('all_domains') or [])}"
                )
            elif health.get("domain_verified") is False:
                logger.warning(
                    f"Resend health: domain '{health.get('domain')}' is NOT verified on this "
                    f"Resend account. Emails from this address will likely bounce or land in spam. "
                    f"Verify the DNS records in the Resend dashboard."
                )
            else:
                logger.info(f"Resend health: configured but verification status unknown — {health}")
        except Exception as e:
            logger.warning(f"Resend health probe failed: {e}")

        logger.info("Background startup tasks complete")

    # Fire-and-forget — does NOT block startup probe
    asyncio.create_task(_index_and_seed())

    # Daily digest scheduler — sends end-of-day recap emails at 20:30 IST.
    # Runs in-process: cheap, no extra cron dependency. Survives container restarts
    # because it re-aligns to the next 20:30 IST on every boot.
    async def _daily_digest_scheduler():
        from routers.notifications_prefs import send_daily_digest_to_user, send_vendor_digest_to_user, IST
        await asyncio.sleep(60)  # give the server 1 min to be fully ready
        while True:
            try:
                now_ist = datetime.now(IST)
                # Target = 20:30 IST today, or tomorrow if we're past it
                target = now_ist.replace(hour=20, minute=30, second=0, microsecond=0)
                if now_ist >= target:
                    target = target + timedelta(days=1)
                sleep_seconds = max(60, (target - now_ist).total_seconds())
                logger.info(f"Daily digest: next run at {target.isoformat()} (in {int(sleep_seconds)}s)")
                await asyncio.sleep(sleep_seconds)

                # Fan-out: employees, then vendors
                ist_today = datetime.now(IST).date()
                emp_sent, emp_skipped = 0, 0
                cursor = db.users.find({"role": "employee"}, {"_id": 1, "email": 1, "name": 1, "notification_preferences": 1}).limit(5000)
                async for u in cursor:
                    res = await send_daily_digest_to_user(db, u, ist_today)
                    if res.get("sent"):
                        emp_sent += 1
                    else:
                        emp_skipped += 1
                ven_sent, ven_skipped = 0, 0
                cursor = db.users.find({"role": "vendor"}, {"_id": 1, "email": 1, "name": 1, "vendor_id": 1, "notification_preferences": 1}).limit(1000)
                async for u in cursor:
                    res = await send_vendor_digest_to_user(db, u, ist_today)
                    if res.get("sent"):
                        ven_sent += 1
                    else:
                        ven_skipped += 1
                logger.info(f"Daily digest done. emp sent={emp_sent} skip={emp_skipped} | vendor sent={ven_sent} skip={ven_skipped} | date={ist_today}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Daily digest scheduler error: {e}")
                await asyncio.sleep(300)

    asyncio.create_task(_daily_digest_scheduler())

    # Monthly Billing scheduler (PDF Module 15) — runs on the 1st of each month at 06:00 IST.
    async def _monthly_billing_scheduler():
        from routers.reservations import IST
        await asyncio.sleep(120)  # let the server settle
        while True:
            try:
                now_ist = datetime.now(IST)
                # Compute the next run: 1st of next month at 06:00 IST
                if now_ist.month == 12:
                    next_year, next_month = now_ist.year + 1, 1
                else:
                    next_year, next_month = now_ist.year, now_ist.month + 1
                target = now_ist.replace(year=next_year, month=next_month, day=1, hour=6, minute=0, second=0, microsecond=0)
                sleep_seconds = max(60, (target - now_ist).total_seconds())
                logger.info(f"Billing: next run at {target.isoformat()} (in {int(sleep_seconds)}s)")
                await asyncio.sleep(sleep_seconds)
                # Bill the just-ended (previous) month
                bill_now = datetime.now(IST)
                if bill_now.month == 1:
                    bill_year, bill_month = bill_now.year - 1, 12
                else:
                    bill_year, bill_month = bill_now.year, bill_now.month - 1
                logger.info(f"Billing: running for {bill_year}-{bill_month:02d}")
                try:
                    result = await run_billing_for_period(db, safe_objectid, bill_year, bill_month, triggered_by="cron")
                    logger.info(f"Billing cron OK: {result}")
                except Exception as e:
                    logger.error(f"Billing cron error: {e}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Monthly billing scheduler error: {e}")
                await asyncio.sleep(3600)

    asyncio.create_task(_monthly_billing_scheduler())

async def seed_admin():
    """Ensure a master admin exists.

    IMPORTANT: this function must NEVER overwrite an existing admin's
    password. The `.env` ADMIN_PASSWORD is a one-time bootstrap value used
    only when the account is first created — after that, the admin owns
    their password and it can only be changed via the change-password /
    reset-password APIs. Restarting the backend or re-deploying must not
    revert the password.
    """
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@cravitoo.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hashed,
            "name": "Master Admin",
            "role": "master_admin",
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Master admin created: {admin_email}")
        return
    # Existing admin — only fix role/name drift; NEVER touch password_hash.
    updates = {}
    if existing.get("role") != "master_admin":
        updates["role"] = "master_admin"
        updates["name"] = "Master Admin"
    if updates:
        await db.users.update_one({"email": admin_email}, {"$set": updates})
        logger.info("Master admin role restored (password left intact)")

async def seed_demo_data():
    demo_company_email = "demo@techcorp.com"
    demo_vendor_email = "vendor@spicekitchen.com"
    demo_employee_email = "employee@techcorp.com"
    
    if not await db.companies.find_one({"name": "Tech Corp"}):
        company_result = await db.companies.insert_one({
            "name": "Tech Corp",
            "address": "123 Tech Park, Bangalore",
            "contact_email": "contact@techcorp.com",
            "contact_phone": "+91-9876543210",
            "status": "active",
            "created_at": datetime.now(timezone.utc)
        })
        company_id = str(company_result.inserted_id)
        logger.info("Demo company created: Tech Corp")
    else:
        company_id = str((await db.companies.find_one({"name": "Tech Corp"}))['_id'])
    
    if not await db.users.find_one({"email": demo_company_email}):
        await db.users.insert_one({
            "email": demo_company_email,
            "password_hash": hash_password("demo123"),
            "name": "Corporate Admin",
            "role": "corporate_admin",
            "company_id": company_id,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info("Demo corporate admin created")
    
    if not await db.vendors.find_one({"name": "Spice Kitchen"}):
        vendor_result = await db.vendors.insert_one({
            "name": "Spice Kitchen",
            "description": "Authentic North Indian Cuisine",
            "cuisine_type": "North Indian",
            "contact_email": "contact@spicekitchen.com",
            "contact_phone": "+91-9876543211",
            "rating": 4.5,
            "status": "active",
            "created_at": datetime.now(timezone.utc)
        })
        vendor_id = str(vendor_result.inserted_id)
        logger.info("Demo vendor created: Spice Kitchen")
    else:
        vendor_id = str((await db.vendors.find_one({"name": "Spice Kitchen"}))['_id'])
    
    if not await db.users.find_one({"email": demo_vendor_email}):
        await db.users.insert_one({
            "email": demo_vendor_email,
            "password_hash": hash_password("vendor123"),
            "name": "Vendor Manager",
            "role": "vendor",
            "vendor_id": vendor_id,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info("Demo vendor user created")
    
    if not await db.users.find_one({"email": demo_employee_email}):
        await db.users.insert_one({
            "email": demo_employee_email,
            "password_hash": hash_password("employee123"),
            "name": "John Doe",
            "role": "employee",
            "company_id": company_id,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info("Demo employee created")
    
    if await db.menu_items.count_documents({"vendor_id": vendor_id}) == 0:
        menu_items = [
            {"vendor_id": vendor_id, "name": "Paneer Tikka", "description": "Grilled cottage cheese with spices", "category": "Appetizer", "price": 180.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Butter Chicken", "description": "Creamy tomato curry with tender chicken", "category": "Main Course", "price": 280.0, "is_vegetarian": False, "is_available": True, "image_url": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Dal Makhani", "description": "Black lentils in rich creamy gravy", "category": "Main Course", "price": 220.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1546833999-b9f581a1996d", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Garlic Naan", "description": "Soft bread with garlic butter", "category": "Bread", "price": 60.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1628840042765-356cda07504e", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Gulab Jamun", "description": "Sweet milk dumplings in sugar syrup", "category": "Dessert", "price": 80.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1589119908995-c6b5f3e3bf6a", "created_at": datetime.now(timezone.utc)}
        ]
        await db.menu_items.insert_many(menu_items)
        logger.info("Demo menu items created")
    
    # Seed a default site & vendor-site mapping
    site_id = None
    existing_site = await db.sites.find_one({"name": "Tech Corp - Bangalore HQ"})
    if not existing_site:
        site_result = await db.sites.insert_one({
            "name": "Tech Corp - Bangalore HQ",
            "company_id": company_id,
            "address": "123 Tech Park, Whitefield, Bangalore",
            "city": "Bangalore",
            "contact_email": "site-hq@techcorp.com",
            "contact_phone": "+91-9876543220",
            "allow_pre_order": True,
            "allow_cash_carry": True,
            "allow_company_paid": True,
            "allow_employee_paid": True,
            "status": "active",
            "created_at": datetime.now(timezone.utc)
        })
        site_id = str(site_result.inserted_id)
        # Default meal schedule
        await db.meal_schedules.insert_one({
            "site_id": site_id,
            "schedules": [
                {"meal_period": "breakfast", "start_time": "07:30", "end_time": "10:30", "enabled": True},
                {"meal_period": "lunch", "start_time": "12:00", "end_time": "15:00", "enabled": True},
                {"meal_period": "snacks", "start_time": "16:00", "end_time": "18:00", "enabled": True},
                {"meal_period": "dinner", "start_time": "19:00", "end_time": "22:00", "enabled": False},
            ],
            "updated_at": datetime.now(timezone.utc)
        })
        logger.info("Demo site created with meal schedules")
    else:
        site_id = str(existing_site["_id"])
    
    # Vendor-site mapping (Spice Kitchen at Bangalore HQ)
    if not await db.vendor_site_mappings.find_one({"vendor_id": vendor_id, "site_id": site_id}):
        await db.vendor_site_mappings.insert_one({
            "vendor_id": vendor_id,
            "site_id": site_id,
            "status": "active",
            "created_at": datetime.now(timezone.utc)
        })
    
    # Backfill site_id, meal_periods, show_price on existing menu items
    await db.menu_items.update_many(
        {"vendor_id": vendor_id, "$or": [{"site_id": {"$exists": False}}, {"site_id": None}]},
        {"$set": {"site_id": site_id, "meal_periods": ["breakfast", "lunch", "snacks"], "show_price": True}}
    )
    
    # Backfill employee with site_id
    await db.users.update_one(
        {"email": demo_employee_email, "site_id": {"$exists": False}},
        {"$set": {"site_id": site_id}}
    )
    
    # Demo Site Admin
    site_admin_email = "siteadmin@techcorp.com"
    if not await db.users.find_one({"email": site_admin_email}):
        await db.users.insert_one({
            "email": site_admin_email,
            "password_hash": hash_password("site123"),
            "name": "Site Admin",
            "role": "site_admin",
            "site_id": site_id,
            "company_id": company_id,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info("Demo site admin created")
    
    test_creds_content = f"""# Cravitoo Test Credentials

## Master Admin
- Email: {os.environ.get('ADMIN_EMAIL', 'admin@cravitoo.com')}
- Password: {os.environ.get('ADMIN_PASSWORD', 'admin123')}
- Role: master_admin (full platform control, Partner App access)

## Corporate Admin
- Email: demo@techcorp.com
- Password: demo123
- Role: corporate_admin (web app)
- Company: Tech Corp

## Site Admin
- Email: siteadmin@techcorp.com
- Password: site123
- Role: site_admin (Partner App access)
- Site: Tech Corp - Bangalore HQ

## Vendor Manager
- Email: vendor@spicekitchen.com
- Password: vendor123
- Role: vendor (Partner App access)
- Vendor: Spice Kitchen

## Employee
- Email: employee@techcorp.com
- Password: employee123
- Role: employee (Customer App access)
- Company: Tech Corp
- Site: Tech Corp - Bangalore HQ

## Auth Endpoints
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- POST /api/auth/logout
"""
    try:
        Path("/app/memory").mkdir(exist_ok=True)
        Path("/app/memory/test_credentials.md").write_text(test_creds_content)
    except (PermissionError, OSError) as e:
        # Read-only filesystem in production — skip silently
        logger.debug(f"Skipped writing test_credentials.md: {e}")

# Auth Routes
# Auth (register/login/logout/me) + OTP + DPDP /me/data extracted to /app/backend/routers/auth.py


# Menu change request routes extracted to /app/backend/routers/menu_change_requests.py


# Company Routes
@api_router.post("/companies")
async def create_company(data: CompanyCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can create companies")
    
    company_doc = {
        **data.model_dump(),
        "status": "active",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.companies.insert_one(company_doc)
    return {"id": str(result.inserted_id), **data.model_dump(), "status": "active"}

@api_router.get("/companies")
async def get_companies(user: dict = Depends(get_current_user)):
    if user["role"] not in ["super_admin", "corporate_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    companies = await db.companies.find({}, {"_id": 1, "name": 1, "address": 1, "contact_email": 1, "contact_phone": 1, "status": 1, "created_at": 1}).to_list(1000)
    for company in companies:
        company["id"] = str(company.pop("_id"))
    return companies

# Vendor Routes
@api_router.get("/admin/ai-photos/spend")
async def ai_photo_spend(user: dict = Depends(get_current_user)):
    """Master Admin cost tracker for AI-generated menu photos.

    Aggregates rows in `ai_image_generations` and multiplies by the
    per-image price (~₹3.5 = OpenAI gpt-image-1 low-quality × ₹85/USD).
    """
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")

    PRICE_PER_IMAGE_INR = 3.5
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_30 = now - timedelta(days=30)

    async def _sum(match: dict) -> tuple[int, int]:
        """Return (rows, images) for the given match filter.

        Excludes free-source rows (cost_inr = 0) so the ₹ counter reflects
        only actual paid gpt-image-1 spend, not the free Unsplash /
        Pollinations path.
        """
        paid_match = {**match, "cost_inr": {"$ne": 0}}
        pipeline = [
            {"$match": paid_match},
            {"$group": {
                "_id": None,
                "rows": {"$sum": 1},
                "images": {
                    "$sum": {
                        "$ifNull": [
                            "$count_generated",   # /suggest path stores this
                            {"$ifNull": ["$filled", 0]},  # /bulk-fill path stores 'filled'
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


@api_router.post("/admin/menu-items/reclassify-veg")
async def menu_items_reclassify_veg(
    vendor_id: str | None = None,
    site_id: str | None = None,
    overwrite: bool = False,
    user: dict = Depends(get_current_user),
):
    """Re-run the veg / non-veg classifier over live menu_items rows.

    Master admin only. Scope filters:
      - ``vendor_id`` — restrict to one vendor's menu
      - ``site_id`` — restrict to one site's menu
      - ``overwrite`` — default False. When False, only items whose
        ``is_vegetarian`` field is missing get updated. When True, EVERY
        item is reclassified — use this to fix bad legacy data, but
        note it will overwrite any manual vendor overrides that happen
        to disagree with the classifier.

    Omit both scope filters to reclassify EVERY menu item.
    """
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


@api_router.post("/admin/menu-items/reclassify-allergens")
async def menu_items_reclassify_allergens(
    vendor_id: str | None = None,
    site_id: str | None = None,
    overwrite: bool = False,
    user: dict = Depends(get_current_user),
):
    """Re-run the allergen classifier over live menu_items rows.

    Master admin only. Scope filters mirror reclassify-veg.

      - `overwrite=false` (default): only fill items that currently have
        no `allergens` field or an empty list — respects vendor overrides.
      - `overwrite=true`: force-refresh every row.
    """
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


@api_router.post("/admin/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, admin: dict = Depends(get_current_user)):
    """Immediately end the target user's session and prevent future logins.

    Master/Super Admin only. Sets `is_active=False`; every future
    /auth/refresh and every authenticated call from that user starts
    returning 403. To re-enable, hit /reactivate.
    """
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


@api_router.post("/admin/users/{user_id}/reactivate")
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


@api_router.post("/vendors")
async def create_vendor(data: VendorCreate, user: dict = Depends(get_current_user)):
    """Create a vendor business record AND its login user, then send invitation email.

    Authorised: super_admin, master_admin, corporate_admin.

    Always writes BOTH `email`/`phone` and `contact_email`/`contact_phone` so
    legacy readers (reports, order receipts) and new readers (frontend lists,
    PATCH endpoint) all see consistent data.

    If a user with the same email already exists with role != 'vendor', the
    request is rejected (we don't silently demote an admin into a vendor).
    """
    if user["role"] not in ("super_admin", "corporate_admin", "master_admin"):
        raise HTTPException(status_code=403, detail="Access denied")

    canonical = data.model_dump(by_alias=False)
    # Persist BOTH name variants so neither reader path breaks.
    email_lower = canonical["contact_email"].lower()
    phone_value = canonical["contact_phone"]
    name_value = canonical["name"]
    login_name = canonical.pop("login_user_name", None) or f"{name_value} - Ops"

    now = datetime.now(timezone.utc)
    vendor_doc = {
        **canonical,
        "email": email_lower,
        "phone": phone_value,
        "rating": 0.0,
        "status": "active",
        "created_at": now,
    }
    result = await db.vendors.insert_one(vendor_doc)
    vendor_id = str(result.inserted_id)

    # Create / link a vendor LOGIN user — this is what the resend-invite
    # endpoint expects to find.
    existing = await db.users.find_one({"email": email_lower})
    invitation_status = "skipped"
    invite_reason: Optional[str] = None
    if existing:
        if existing.get("role") and existing["role"] != "vendor":
            # Don't demote an admin/employee into a vendor — surface the conflict.
            invite_reason = (
                f"A user with this email already exists as '{existing.get('role')}'. "
                "Vendor record created, but no invitation was sent. "
                "Resolve the email conflict and use Resend Invite."
            )
        else:
            # Link the existing vendor user to this new business.
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": {"vendor_id": vendor_id, "role": "vendor", "updated_at": now}}
            )
            invitation_status = "user_linked"
    else:
        # Create the vendor login row. Password is unset — they use the email
        # OTP / email-code login flow described in the invitation email.
        await db.users.insert_one({
            "email": email_lower,
            "password_hash": None,        # passwordless until they choose to set one
            "name": login_name,
            "role": "vendor",
            "vendor_id": vendor_id,
            "created_at": now,
        })
        invitation_status = "user_created"

    # Send invitation email — best-effort, never blocks vendor creation.
    try:
        from routers.sites import _send_invitation_safe
        if invite_reason is None:
            ok = _send_invitation_safe(email_lower, login_name, "vendor")
            invitation_status = "sent" if ok else "send_failed"
            if not ok:
                invite_reason = "Email provider returned an error — check Resend dashboard."
    except Exception as exc:                  # pragma: no cover
        invitation_status = "send_failed"
        invite_reason = f"{type(exc).__name__}: {exc}"

    try:
        await audit_log(user, "vendor", vendor_id, "created",
                        {"email": email_lower, "invitation_status": invitation_status})
    except Exception:
        pass

    return {
        "id": vendor_id,
        "name": name_value,
        "description": canonical["description"],
        "cuisine_type": canonical["cuisine_type"],
        "email": email_lower,
        "phone": phone_value,
        "contact_email": email_lower,
        "contact_phone": phone_value,
        "address": canonical.get("address"),
        "image_url": canonical.get("image_url"),
        "rating": 0.0,
        "status": "active",
        "invitation_status": invitation_status,
        "invitation_reason": invite_reason,
    }

@api_router.get("/vendors")
async def get_vendors(user: dict = Depends(get_current_user)):
    """List active vendors with contact + mapping summary.

    Returns BOTH `email`/`phone` (canonical) and `contact_email`/`contact_phone`
    (legacy) for every row so older clients keep working.

    Employees only ever see vendors that are ACTIVELY mapped to their own
    site — an unmapped, suspended, or inactive vendor (or a mapping that was
    deactivated) must never leak into a site's menu. Admin roles keep the
    full platform-wide list they need for management screens.
    """
    vendor_filter = {"status": "active"}
    if user.get("role") == "employee":
        emp_site_id = user.get("site_id")
        # Fallback: an employee with no site but whose company has exactly ONE
        # site is auto-resolved to it, so single-site companies work even before
        # a backfill runs. Multi-site / no-company employees still get [].
        if not emp_site_id and user.get("company_id"):
            company_sites = await db.sites.find(
                {"company_id": user["company_id"]}, {"_id": 1}
            ).to_list(5)
            if len(company_sites) == 1:
                emp_site_id = str(company_sites[0]["_id"])
        if not emp_site_id:
            return []
        active_maps = await db.vendor_site_mappings.find(
            {"site_id": emp_site_id, "status": "active"},
            {"vendor_id": 1},
        ).to_list(1000)
        mapped_oids = []
        for m in active_maps:
            try:
                mapped_oids.append(ObjectId(m["vendor_id"]))
            except Exception:
                pass
        if not mapped_oids:
            return []
        vendor_filter["_id"] = {"$in": mapped_oids}

    vendors = await db.vendors.find(
        vendor_filter,
        {
            "_id": 1, "name": 1, "description": 1, "cuisine_type": 1,
            "email": 1, "phone": 1, "contact_email": 1, "contact_phone": 1,
            "address": 1, "image_url": 1, "rating": 1, "status": 1,
            "commission_pct": 1, "auto_confirm": 1, "low_stock_threshold": 1,
            "created_at": 1,
        }
    ).to_list(1000)
    if not vendors:
        return []

    # Count site mappings + linked login user in two batch queries (no N+1).
    vendor_ids = [str(v["_id"]) for v in vendors]
    mapping_cur = db.vendor_site_mappings.aggregate([
        {"$match": {"vendor_id": {"$in": vendor_ids}}},
        {"$group": {"_id": "$vendor_id", "count": {"$sum": 1}}},
    ])
    mapping_counts = {row["_id"]: row["count"] async for row in mapping_cur}

    login_users = await db.users.find(
        {"vendor_id": {"$in": vendor_ids}, "role": "vendor"},
        {"_id": 1, "email": 1, "vendor_id": 1}
    ).to_list(2000)
    login_map = {u["vendor_id"]: u for u in login_users}

    out = []
    for v in vendors:
        vid = str(v.pop("_id"))
        # Unify field names — prefer canonical, fall back to legacy.
        email = v.get("email") or v.get("contact_email") or ""
        phone = v.get("phone") or v.get("contact_phone") or ""
        out.append({
            "id": vid,
            "name": v.get("name", ""),
            "description": v.get("description", ""),
            "cuisine_type": v.get("cuisine_type", ""),
            "email": email,
            "phone": phone,
            "contact_email": email,
            "contact_phone": phone,
            "address": v.get("address"),
            "image_url": v.get("image_url"),
            "rating": float(v.get("rating") or 0.0),
            "status": v.get("status", "active"),
            "commission_pct": float(v.get("commission_pct") or 0.0),
            "auto_confirm": bool(v.get("auto_confirm", False)),
            "low_stock_threshold": int(v.get("low_stock_threshold") or 0),
            "mapped_sites_count": mapping_counts.get(vid, 0),
            "has_login_user": vid in login_map,
            "created_at": v.get("created_at"),
        })
    return out

@api_router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str):
    vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    vendor["id"] = str(vendor.pop("_id"))
    # Unify the contact fields like /vendors does.
    email = vendor.get("email") or vendor.get("contact_email") or ""
    phone = vendor.get("phone") or vendor.get("contact_phone") or ""
    vendor["email"] = email
    vendor["phone"] = phone
    vendor["contact_email"] = email
    vendor["contact_phone"] = phone
    # Include the list of sites the vendor is mapped to (id + name + lifecycle).
    mapping_rows = await db.vendor_site_mappings.find({"vendor_id": vendor["id"]}).to_list(500)
    site_ids = [m["site_id"] for m in mapping_rows]
    if site_ids:
        from bson import ObjectId
        site_oids = []
        for sid in site_ids:
            try:
                site_oids.append(ObjectId(sid))
            except Exception:
                pass
        sites = await db.sites.find(
            {"_id": {"$in": site_oids}},
            {"_id": 1, "name": 1, "lifecycle_status": 1, "status": 1}
        ).to_list(500) if site_oids else []
        vendor["mapped_sites"] = [
            {"id": str(s["_id"]), "name": s.get("name"),
             "lifecycle_status": s.get("lifecycle_status"), "status": s.get("status")}
            for s in sites
        ]
    else:
        vendor["mapped_sites"] = []
    return vendor

# Menu Routes
@api_router.post("/menu")
async def create_menu_item(data: MenuItemCreate, user: dict = Depends(get_current_user)):
    # Only Cravitoo (master_admin) can create menu items. Vendors are read-only.
    if user["role"] != "master_admin":
        raise HTTPException(status_code=403, detail="Only Cravitoo (Master Admin) can create menu items. Vendors cannot modify menus or pricing.")
    payload = data.model_dump()
    target_vendor_id = payload.pop("vendor_id", None)
    if not target_vendor_id:
        raise HTTPException(status_code=400, detail="vendor_id is required when creating menu items")
    # Validate vendor exists
    vendor_doc = await db.vendors.find_one({"_id": safe_objectid(target_vendor_id, "Vendor")})
    if not vendor_doc:
        raise HTTPException(status_code=404, detail="Vendor not found")
    menu_doc = {
        **payload,
        "vendor_id": target_vendor_id,
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.menu_items.insert_one(menu_doc)
    return {"id": str(result.inserted_id), **payload, "vendor_id": target_vendor_id}

@api_router.get("/menu/{vendor_id}")
async def get_menu(vendor_id: str, user: dict = Depends(get_current_user)):
    # Menu Access Guard: an employee may only open the menu of a vendor that
    # is ACTIVELY mapped to their own site AND is itself active. This blocks
    # a stale/shared direct link from surfacing an unassigned, suspended, or
    # cross-site vendor's menu. Admin/vendor roles are unrestricted.
    if user.get("role") == "employee":
        emp_site_id = user.get("site_id")
        mapping = (
            await db.vendor_site_mappings.find_one(
                {"site_id": emp_site_id, "vendor_id": vendor_id, "status": "active"}
            )
            if emp_site_id else None
        )
        vendor_ok = await db.vendors.find_one(
            {"_id": safe_objectid(vendor_id, "Vendor"), "status": "active"}, {"_id": 1}
        )
        if not mapping or not vendor_ok:
            raise HTTPException(status_code=403, detail="This vendor is not available at your site")
    menu_items = await db.menu_items.find({"vendor_id": vendor_id, "is_available": True}, {"_id": 1, "name": 1, "description": 1, "category": 1, "price": 1, "image_url": 1, "is_vegetarian": 1, "is_available": 1, "allergens": 1, "image_source": 1, "counter": 1}).to_list(1000)
    for item in menu_items:
        item["id"] = str(item.pop("_id"))
        if "allergens" not in item or item["allergens"] is None:
            item["allergens"] = []
    return menu_items

@api_router.patch("/menu/{item_id}")
async def update_menu_item(item_id: str, data: Dict[str, Any], user: dict = Depends(get_current_user)):
    # Only Cravitoo (master_admin) can edit menu items / pricing. Vendors use /menu/{id}/availability for out-of-stock only.
    if user["role"] != "master_admin":
        raise HTTPException(status_code=403, detail="Only Cravitoo (Master Admin) can update menu items or pricing. Vendors can only toggle availability.")
    # vendor_id is immutable here — strip it from update payload
    data.pop("vendor_id", None)
    result = await db.menu_items.update_one({"_id": safe_objectid(item_id, "Menu item")}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return {"message": "Menu item updated"}

# Order + payment routes extracted to routers/orders.py

# Stripe payment endpoints removed — Cravitoo uses Razorpay for INR.
# See routers/sites.py registration and the /payments/razorpay/* endpoints below.

# AI Recommendations
@api_router.post("/ai/recommendations")
async def get_ai_recommendations(data: AIRecommendationRequest, user: dict = Depends(get_current_user)):
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"recommendations_{user['id']}",
        system_message="You are a helpful AI food recommendation assistant for Cravitoo, a corporate cafeteria platform. Provide personalized meal suggestions based on user preferences."
    ).with_model("openai", "gpt-5.2")
    
    menu_items = await db.menu_items.find({"is_available": True}, {"_id": 0, "name": 1, "description": 1, "category": 1, "price": 1, "is_vegetarian": 1}).to_list(100)
    
    prompt = f"""Based on the following available menu items, recommend 3 dishes for the user.
    
User preferences: {data.user_preferences or 'No specific preferences'}
Dietary restrictions: {data.dietary_restrictions or 'None'}

Available menu items:
{menu_items}

Provide your recommendations in a friendly, concise format."""
    
    user_message = UserMessage(text=prompt)
    response = await chat.send_message(user_message)
    
    return {"recommendations": response}

# Analytics Routes
@api_router.get("/analytics/vendor")
async def get_vendor_analytics(user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can access analytics")
    
    vendor_id = user.get("vendor_id")
    total_orders = await db.orders.count_documents({"vendor_id": vendor_id})
    
    pipeline = [
        {"$match": {"vendor_id": vendor_id, "payment_status": "paid"}},
        {"$group": {"_id": None, "total_revenue": {"$sum": "$total_amount"}}}
    ]
    revenue_result = await db.orders.aggregate(pipeline).to_list(1)
    total_revenue = revenue_result[0]["total_revenue"] if revenue_result else 0
    
    return {
        "total_orders": total_orders,
        "total_revenue": total_revenue,
        "average_order_value": total_revenue / total_orders if total_orders > 0 else 0
    }

@api_router.get("/analytics/vendor/today")
async def get_vendor_today_analytics(user: dict = Depends(get_current_user)):
    """Mobile command-center snapshot for a vendor: today's sales, the
    top-selling item today, and outstanding (pending) payments."""
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can access analytics")
    vendor_id = user.get("vendor_id")

    # IST day boundary → UTC (created_at is stored as UTC datetime).
    ist = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(ist)
    start_utc = now_ist.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    today_match = {"vendor_id": vendor_id, "created_at": {"$gte": start_utc}}

    today_orders = await db.orders.count_documents(today_match)
    paid_pipe = [
        {"$match": {**today_match, "payment_status": "paid"}},
        {"$group": {"_id": None, "revenue": {"$sum": "$total_amount"}, "count": {"$sum": 1}}},
    ]
    paid_res = await db.orders.aggregate(paid_pipe).to_list(1)
    today_revenue = paid_res[0]["revenue"] if paid_res else 0
    today_paid_orders = paid_res[0]["count"] if paid_res else 0

    # Top-selling item today (by units sold across all of today's orders).
    top_pipe = [
        {"$match": today_match},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.quantity"}}},
        {"$sort": {"qty": -1}},
        {"$limit": 1},
    ]
    top_res = await db.orders.aggregate(top_pipe).to_list(1)
    top_item = (
        {"name": top_res[0]["_id"], "quantity": int(top_res[0]["qty"])}
        if top_res and top_res[0]["_id"] else None
    )

    # Outstanding pay-at-counter money owed to the vendor (all-time pending).
    pending_pipe = [
        {"$match": {"vendor_id": vendor_id, "payment_status": "pending"}},
        {"$group": {"_id": None, "amount": {"$sum": "$total_amount"}, "count": {"$sum": 1}}},
    ]
    pending_res = await db.orders.aggregate(pending_pipe).to_list(1)
    pending_amount = pending_res[0]["amount"] if pending_res else 0
    pending_count = pending_res[0]["count"] if pending_res else 0

    return {
        "today_revenue": round(float(today_revenue), 2),
        "today_orders": today_orders,
        "today_paid_orders": today_paid_orders,
        "top_item": top_item,
        "pending_amount": round(float(pending_amount), 2),
        "pending_count": pending_count,
    }


@api_router.get("/analytics/corporate")
async def get_corporate_analytics(user: dict = Depends(get_current_user)):
    if user["role"] not in ["corporate_admin", "super_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    query = {}
    if user["role"] == "corporate_admin":
        company_id = user.get("company_id")
        employee_ids = [str(u["_id"]) for u in await db.users.find({"company_id": company_id, "role": "employee"}, {"_id": 1}).to_list(1000)]
        query["user_id"] = {"$in": employee_ids}
    
    total_orders = await db.orders.count_documents(query)
    pipeline = [
        {"$match": {**query, "payment_status": "paid"}},
        {"$group": {"_id": None, "total_spend": {"$sum": "$total_amount"}}}
    ]
    spend_result = await db.orders.aggregate(pipeline).to_list(1)
    total_spend = spend_result[0]["total_spend"] if spend_result else 0
    
    return {
        "total_orders": total_orders,
        "total_spend": total_spend
    }


@api_router.get("/analytics/corporate/today")
async def get_corporate_today(user: dict = Depends(get_current_user)):
    """Live command-center for a corporate admin: today's orders + spend for
    their company, broken down per site. Scoped strictly to the caller's
    company_id (super_admin sees their assigned sites)."""
    if user["role"] not in ["corporate_admin", "super_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")

    match: dict = {}
    if user["role"] == "corporate_admin":
        company_id = user.get("company_id")
        if not company_id:
            return {"today_orders": 0, "today_paid_orders": 0, "today_spend": 0.0, "per_site": []}
        match["company_id"] = company_id
    else:  # super_admin
        assigned = user.get("assigned_sites") or []
        if not assigned:
            return {"today_orders": 0, "today_paid_orders": 0, "today_spend": 0.0, "per_site": []}
        match["site_id"] = {"$in": assigned}

    ist = timezone(timedelta(hours=5, minutes=30))
    start_utc = datetime.now(ist).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    match["created_at"] = {"$gte": start_utc}

    today_orders = await db.orders.count_documents(match)
    paid_res = await db.orders.aggregate([
        {"$match": {**match, "payment_status": "paid"}},
        {"$group": {"_id": None, "spend": {"$sum": "$total_amount"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    today_spend = paid_res[0]["spend"] if paid_res else 0
    today_paid_orders = paid_res[0]["count"] if paid_res else 0

    per_site_rows = await db.orders.aggregate([
        {"$match": match},
        {"$group": {
            "_id": "$site_id",
            "orders": {"$sum": 1},
            "spend": {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, "$total_amount", 0]}},
        }},
    ]).to_list(500)
    per_site = []
    for row in per_site_rows:
        sid = row["_id"]
        name = "Unassigned"
        if sid:
            s = await db.sites.find_one({"_id": safe_objectid(sid, "Site")}, {"name": 1})
            name = (s or {}).get("name", "Unknown site")
        per_site.append({
            "site_id": sid, "site_name": name,
            "orders": row["orders"], "spend": round(float(row["spend"]), 2),
        })
    per_site.sort(key=lambda r: r["spend"], reverse=True)

    return {
        "today_orders": today_orders,
        "today_paid_orders": today_paid_orders,
        "today_spend": round(float(today_spend), 2),
        "per_site": per_site,
    }

# Review Routes
@api_router.post("/reviews")
async def create_review(data: ReviewCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can write reviews")
    
    order = await db.orders.find_one({"_id": safe_objectid(data.order_id, "Order"), "user_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if order.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Can only review completed orders")
    
    existing = await db.reviews.find_one({"order_id": data.order_id})
    if existing:
        raise HTTPException(status_code=400, detail="Review already exists for this order")
    
    review_doc = {
        "user_id": user["id"],
        "vendor_id": data.vendor_id,
        "order_id": data.order_id,
        "rating": data.rating,
        "comment": data.comment,
        "user_name": user.get("name", "Anonymous"),
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.reviews.insert_one(review_doc)
    
    # Update vendor average rating
    pipeline = [
        {"$match": {"vendor_id": data.vendor_id}},
        {"$group": {"_id": None, "avg_rating": {"$avg": "$rating"}, "count": {"$sum": 1}}}
    ]
    rating_result = await db.reviews.aggregate(pipeline).to_list(1)
    if rating_result:
        await db.vendors.update_one(
            {"_id": safe_objectid(data.vendor_id, "Vendor")},
            {"$set": {"rating": round(rating_result[0]["avg_rating"], 1)}}
        )
    
    return {"id": str(result.inserted_id), "message": "Review submitted successfully"}

@api_router.get("/reviews/vendor/{vendor_id}")
async def get_vendor_reviews(vendor_id: str):
    reviews = await db.reviews.find({"vendor_id": vendor_id}, {"_id": 1, "rating": 1, "comment": 1, "user_name": 1, "created_at": 1}).sort("created_at", -1).to_list(100)
    for review in reviews:
        review["id"] = str(review.pop("_id"))
    return reviews

# Preferences Routes
@api_router.get("/preferences")
async def get_preferences(user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can access preferences")
    
    prefs = await db.preferences.find_one({"user_id": user["id"]})
    if not prefs:
        return {"dietary_preferences": [], "allergies": [], "favorite_cuisines": []}
    
    return {
        "dietary_preferences": prefs.get("dietary_preferences", []),
        "allergies": prefs.get("allergies", []),
        "favorite_cuisines": prefs.get("favorite_cuisines", [])
    }

@api_router.post("/preferences")
async def update_preferences(data: PreferencesUpdate, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can update preferences")
    
    update_doc = {
        "user_id": user["id"],
        "updated_at": datetime.now(timezone.utc)
    }
    if data.dietary_preferences is not None:
        update_doc["dietary_preferences"] = data.dietary_preferences
    if data.allergies is not None:
        update_doc["allergies"] = data.allergies
    if data.favorite_cuisines is not None:
        update_doc["favorite_cuisines"] = data.favorite_cuisines
    
    await db.preferences.update_one(
        {"user_id": user["id"]},
        {"$set": update_doc},
        upsert=True
    )
    return {"message": "Preferences updated successfully"}

# Subscription Routes
@api_router.post("/subscriptions")
async def create_subscription(data: SubscriptionCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can subscribe")
    
    start_date = datetime.now(timezone.utc)
    end_date = start_date + timedelta(days=data.duration_days)
    
    sub_doc = {
        "user_id": user["id"],
        "vendor_id": data.vendor_id,
        "plan_type": data.plan_type,
        "meal_type": data.meal_type,
        "duration_days": data.duration_days,
        "start_date": start_date,
        "end_date": end_date,
        "status": "active",
        "created_at": start_date
    }
    result = await db.subscriptions.insert_one(sub_doc)
    return {"id": str(result.inserted_id), "message": "Subscription created", "end_date": end_date.isoformat()}

@api_router.get("/subscriptions")
async def get_subscriptions(user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can view subscriptions")
    
    subs = await db.subscriptions.find({"user_id": user["id"]}).sort("created_at", -1).to_list(100)
    for sub in subs:
        sub["id"] = str(sub.pop("_id"))
        if isinstance(sub.get("start_date"), datetime):
            sub["start_date"] = sub["start_date"].isoformat()
        if isinstance(sub.get("end_date"), datetime):
            sub["end_date"] = sub["end_date"].isoformat()
        if isinstance(sub.get("created_at"), datetime):
            sub["created_at"] = sub["created_at"].isoformat()
    return subs

# Notifications Helper
async def create_notification(user_id: str, title: str, message: str, notif_type: str = "info", push_data: Optional[Dict[str, Any]] = None):
    """Persist an in-app notification AND fire a push notification (if user has a registered token)."""
    await db.notifications.insert_one({
        "user_id": user_id,
        "title": title,
        "message": message,
        "type": notif_type,
        "read": False,
        "created_at": datetime.now(timezone.utc)
    })
    # Best-effort push (failures never break the calling flow)
    try:
        await send_push_to_user(user_id, title, message, push_data or {"screen": "Notifications", "type": notif_type})
    except Exception as e:
        logger.warning(f"Push send failed for user {user_id}: {e}")


# ============== EXPO PUSH NOTIFICATIONS ==============

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_push_http_client: Optional[httpx.AsyncClient] = None


def _get_push_http_client() -> httpx.AsyncClient:
    global _push_http_client
    if _push_http_client is None:
        _push_http_client = httpx.AsyncClient(timeout=10.0)
    return _push_http_client


async def send_expo_push(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Send a batch of Expo push messages. messages is a list of dicts with 'to', 'title', 'body', 'data'."""
    if not messages:
        return {}
    valid_messages = [m for m in messages if m.get("to", "").startswith("ExponentPushToken[")]
    if not valid_messages:
        return {}
    try:
        client_http = _get_push_http_client()
        resp = await client_http.post(
            EXPO_PUSH_URL,
            json=valid_messages,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            },
        )
        return resp.json()
    except Exception as e:
        logger.warning(f"Expo push failed: {e}")
        return {"error": str(e)}


async def send_push_to_user(user_id: str, title: str, body: str, data: Optional[Dict[str, Any]] = None):
    """Look up all active Expo push tokens for a user and send them a push notification."""
    tokens_cursor = db.push_tokens.find({"user_id": user_id, "active": True})
    messages = []
    async for t in tokens_cursor:
        messages.append({
            "to": t["token"],
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "priority": "high",
            "channelId": "default",
        })
    if messages:
        await send_expo_push(messages)


@api_router.post("/notifications/push-token")
async def register_push_token(data: PushTokenRegister, user: dict = Depends(get_current_user)):
    """Register or refresh an Expo push token for the authenticated user."""
    if not data.token or not data.token.startswith("ExponentPushToken["):
        raise HTTPException(status_code=400, detail="Invalid Expo push token format")
    now = datetime.now(timezone.utc)
    # Upsert by (user_id, token) — same physical device only stores one row per user
    await db.push_tokens.update_one(
        {"user_id": user["id"], "token": data.token},
        {
            "$set": {
                "user_id": user["id"],
                "token": data.token,
                "platform": data.platform,
                "variant": data.variant,
                "active": True,
                "last_seen_at": now,
            },
            "$setOnInsert": {"registered_at": now},
        },
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/notifications/push-token")
async def unregister_push_token(token: str = Query(...), user: dict = Depends(get_current_user)):
    """Mark a push token inactive (on logout / app uninstall)."""
    await db.push_tokens.update_one(
        {"user_id": user["id"], "token": token},
        {"$set": {"active": False, "deactivated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


@api_router.post("/notifications/test-push")
async def test_push(user: dict = Depends(get_current_user)):
    """Send a test push notification to the calling user. Useful for debugging in production."""
    await send_push_to_user(
        user["id"],
        "🍴 Cravitoo test notification",
        "If you can see this, push notifications are working!",
        {"screen": "Notifications"},
    )
    return {"ok": True, "sent_to": user["id"]}


# Menu CRUD - DELETE
@api_router.delete("/menu/{item_id}")
async def delete_menu_item(item_id: str, user: dict = Depends(get_current_user)):
    # Only Cravitoo (master_admin) can delete menu items.
    if user["role"] != "master_admin":
        raise HTTPException(status_code=403, detail="Only Cravitoo (Master Admin) can delete menu items.")
    result = await db.menu_items.delete_one({"_id": safe_objectid(item_id, "Menu item")})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return {"message": "Menu item deleted"}


async def _load_menu_item_with_ownership_check(item_id: str, user: dict) -> dict:
    """Return the menu_item doc iff ``user`` is allowed to mutate its photo.

    Allowed:
        - master_admin: any item
        - vendor: only items where ``vendor_id`` matches user.vendor_id
    Any other role → 403. Missing item → 404.
    """
    item = await db.menu_items.find_one({"_id": safe_objectid(item_id, "Menu item")})
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    if user["role"] == "master_admin":
        return item
    if user["role"] == "vendor" and item.get("vendor_id") == user.get("vendor_id"):
        return item
    raise HTTPException(status_code=403, detail="Only the owning vendor or Master Admin can edit this photo.")


@api_router.post("/menu/{item_id}/image")
async def upload_menu_item_image(
    item_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Upload / replace the photo on a **live** menu item.

    Auth: master_admin OR the vendor that owns the item. Accepts
    PNG / JPG / JPEG / WEBP up to 5 MB. Stores in Emergent Object
    Storage under ``cravitoo/menu-photos-manual/live/``.

    On replacement the previous ``image_url`` is overwritten — we don't
    GC the old blob (cheap, and a small audit history is useful).
    """
    item = await _load_menu_item_with_ownership_check(item_id, user)

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 5 MB")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()[:5]
    if ext not in ("png", "jpg", "jpeg", "webp"):
        raise HTTPException(status_code=400, detail="Allowed image types: PNG, JPG, JPEG, WEBP")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}[ext]

    from storage import put_object, path_to_url
    from starlette.concurrency import run_in_threadpool
    storage_path = f"cravitoo/menu-photos-manual/live/{item_id}_{uuid.uuid4().hex}.{ext}"
    try:
        result = await run_in_threadpool(put_object, storage_path, content, mime)
    except Exception as e:
        logger.error(f"Object storage put failed for live menu photo: {e}")
        raise HTTPException(status_code=503, detail="Storage temporarily unavailable, please retry")

    url = path_to_url(result["path"])
    await db.menu_items.update_one(
        {"_id": item["_id"]},
        {"$set": {
            "image_url": url,
            "image_source": "vendor_upload" if user["role"] == "vendor" else "admin_upload",
            "image_updated_at": datetime.now(timezone.utc),
            "image_updated_by": user["email"],
        }},
    )
    await audit_log(user, "menu_items", item_id, "uploaded_photo", {"size": len(content)})
    return {"menu_item_id": item_id, "image_url": url, "size": len(content)}


@api_router.delete("/menu/{item_id}/image")
async def clear_menu_item_image(
    item_id: str,
    user: dict = Depends(get_current_user),
):
    """Remove the photo from a live menu item (sets ``image_url = None``).

    Auth: master_admin OR the item's owning vendor. The stored blob is
    left in place — cheap, and lets the operator inspect audit history
    if needed.
    """
    item = await _load_menu_item_with_ownership_check(item_id, user)
    await db.menu_items.update_one(
        {"_id": item["_id"]},
        {"$set": {
            "image_url": None,
            "image_source": None,
            "image_updated_at": datetime.now(timezone.utc),
            "image_updated_by": user["email"],
        }},
    )
    await audit_log(user, "menu_items", item_id, "removed_photo", {})
    return {"menu_item_id": item_id, "image_url": None}


@api_router.get("/menu/vendor/all")
async def get_my_menu(user: dict = Depends(get_current_user)):
    # Vendors see their own menu (read-only). Master_admin can pass vendor_id (handled by /menu/{vendor_id}).
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can access this")
    items = await db.menu_items.find({"vendor_id": user.get("vendor_id")}).to_list(1000)
    for item in items:
        item["id"] = str(item.pop("_id"))
        if isinstance(item.get("created_at"), datetime):
            item["created_at"] = item["created_at"].isoformat()
    return items

# Employee Management (Corporate Admin)
@api_router.post("/companies/employees")
async def add_employee(data: EmployeeCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "corporate_admin":
        raise HTTPException(status_code=403, detail="Only corporate admins can add employees")
    
    email_lower = data.email.lower()
    existing = await db.users.find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    employee_doc = {
        "email": email_lower,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "employee",
        "company_id": user.get("company_id"),
        "department": data.department,
        "employee_id": data.employee_id,
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.users.insert_one(employee_doc)
    return {"id": str(result.inserted_id), "email": email_lower, "name": data.name, "department": data.department}

@api_router.get("/companies/employees")
async def list_employees(user: dict = Depends(get_current_user)):
    if user["role"] not in ["corporate_admin", "super_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    query = {"role": "employee"}
    if user["role"] == "corporate_admin":
        query["company_id"] = user.get("company_id")
    
    employees = await db.users.find(query, {"_id": 1, "email": 1, "name": 1, "department": 1, "employee_id": 1, "created_at": 1}).to_list(1000)
    for emp in employees:
        emp["id"] = str(emp.pop("_id"))
        if isinstance(emp.get("created_at"), datetime):
            emp["created_at"] = emp["created_at"].isoformat()
    return employees

@api_router.delete("/companies/employees/{employee_id}")
async def remove_employee(employee_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "corporate_admin":
        raise HTTPException(status_code=403, detail="Only corporate admins can remove employees")
    
    result = await db.users.delete_one({
        "_id": safe_objectid(employee_id, "Employee"),
        "company_id": user.get("company_id"),
        "role": "employee"
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee removed"}

# Bulk order route extracted to routers/orders.py

# Event Catering
@api_router.post("/events")
async def create_event_catering(data: EventCateringCreate, user: dict = Depends(get_current_user)):
    if user["role"] not in ["corporate_admin", "employee"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    total_amount = 0.0
    validated_items = []
    for item in data.menu_items:
        menu_item = await db.menu_items.find_one({"_id": safe_objectid(item.menu_item_id, "Menu item")})
        if not menu_item:
            continue
        actual_price = menu_item["price"]
        qty_for_event = item.quantity * data.headcount
        validated_items.append({
            "menu_item_id": item.menu_item_id,
            "name": menu_item["name"],
            "quantity_per_person": item.quantity,
            "total_quantity": qty_for_event,
            "price": actual_price
        })
        total_amount += actual_price * qty_for_event
    
    event_doc = {
        "created_by": user["id"],
        "company_id": user.get("company_id"),
        "vendor_id": data.vendor_id,
        "event_name": data.event_name,
        "event_date": data.event_date,
        "headcount": data.headcount,
        "menu_items": validated_items,
        "total_amount": total_amount,
        "notes": data.notes,
        "status": "pending_approval",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.events.insert_one(event_doc)
    return {"id": str(result.inserted_id), "total_amount": total_amount, "status": "pending_approval"}

@api_router.get("/events")
async def list_events(user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] == "employee" or user["role"] == "corporate_admin":
        if user.get("company_id"):
            query["company_id"] = user.get("company_id")
        else:
            query["created_by"] = user["id"]
    elif user["role"] == "vendor":
        query["vendor_id"] = user.get("vendor_id")
    
    events = await db.events.find(query).sort("created_at", -1).to_list(500)
    for event in events:
        event["id"] = str(event.pop("_id"))
        if isinstance(event.get("created_at"), datetime):
            event["created_at"] = event["created_at"].isoformat()
    return events

@api_router.patch("/events/{event_id}/approve")
async def approve_event(event_id: str, user: dict = Depends(get_current_user)):
    if user["role"] not in ["corporate_admin", "vendor"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    event = await db.events.find_one({"_id": safe_objectid(event_id, "Event")})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Ownership scoping
    if user["role"] == "vendor" and event.get("vendor_id") != user.get("vendor_id"):
        raise HTTPException(status_code=403, detail="Not your event")
    if user["role"] == "corporate_admin" and event.get("company_id") != user.get("company_id"):
        raise HTTPException(status_code=403, detail="Not your company's event")
    
    await db.events.update_one(
        {"_id": safe_objectid(event_id, "Event")},
        {"$set": {"status": "approved", "approved_by": user["id"]}}
    )
    return {"message": "Event approved"}

# Notifications
@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    notifs = await db.notifications.find({"user_id": user["id"]}).sort("created_at", -1).limit(50).to_list(50)
    for n in notifs:
        n["id"] = str(n.pop("_id"))
        if isinstance(n.get("created_at"), datetime):
            n["created_at"] = n["created_at"].isoformat()
    return notifs

@api_router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one(
        {"_id": safe_objectid(notif_id, "Notification"), "user_id": user["id"]},
        {"$set": {"read": True}}
    )
    return {"message": "Marked as read"}

@api_router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"message": "All notifications marked as read"}

# AI Demand Forecasting
@api_router.post("/ai/demand-forecast")
async def get_demand_forecast(user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can access demand forecasting")
    
    vendor_id = user.get("vendor_id")
    # Aggregate item-level orders
    pipeline = [
        {"$match": {"vendor_id": vendor_id, "payment_status": "paid"}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.name",
            "total_quantity": {"$sum": "$items.quantity"},
            "total_revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}}
        }},
        {"$sort": {"total_quantity": -1}},
        {"$limit": 10}
    ]
    top_items = await db.orders.aggregate(pipeline).to_list(10)
    
    total_orders = await db.orders.count_documents({"vendor_id": vendor_id})
    
    if total_orders < 1:
        return {"forecast": "Not enough data for forecasting. Need at least a few orders to generate predictions.", "top_items": []}
    
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"forecast_{vendor_id}",
        system_message="You are an AI demand forecasting analyst for a corporate cafeteria. Provide actionable demand predictions and recommendations."
    ).with_model("openai", "gpt-5.2")
    
    prompt = f"""Based on the following order history data, provide a demand forecast for next week.

Top selling items (last period):
{top_items}

Total orders in history: {total_orders}

Provide:
1. Top 3 items expected to be in highest demand next week
2. Suggested inventory levels (low/medium/high) for each top item
3. One actionable insight to maximize revenue

Keep response concise and bullet-point friendly (under 200 words)."""
    
    response = await chat.send_message(UserMessage(text=prompt))
    
    return {
        "forecast": response,
        "top_items": [{"name": item["_id"], "quantity": item["total_quantity"], "revenue": item["total_revenue"]} for item in top_items]
    }

# AI Food Wastage Analysis
@api_router.post("/ai/wastage-analysis")
async def get_wastage_analysis(user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can access wastage analysis")
    
    vendor_id = user.get("vendor_id")
    cancelled_orders = await db.orders.count_documents({"vendor_id": vendor_id, "status": "cancelled"})
    completed_orders = await db.orders.count_documents({"vendor_id": vendor_id, "status": "completed"})
    total_orders = await db.orders.count_documents({"vendor_id": vendor_id})
    
    cancellation_rate = (cancelled_orders / total_orders * 100) if total_orders > 0 else 0
    
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"wastage_{vendor_id}",
        system_message="You are a food wastage reduction expert for corporate cafeterias. Provide actionable strategies."
    ).with_model("openai", "gpt-5.2")
    
    prompt = f"""Vendor metrics:
- Total orders: {total_orders}
- Completed: {completed_orders}
- Cancelled: {cancelled_orders}
- Cancellation rate: {cancellation_rate:.1f}%

Provide 3 actionable strategies to reduce food wastage and improve order fulfillment. Keep under 150 words."""
    
    response = await chat.send_message(UserMessage(text=prompt))
    
    return {
        "analysis": response,
        "metrics": {
            "total_orders": total_orders,
            "completed_orders": completed_orders,
            "cancelled_orders": cancelled_orders,
            "cancellation_rate": round(cancellation_rate, 2)
        }
    }

# Loyalty System
@api_router.get("/loyalty")
async def get_loyalty(user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees have loyalty programs")
    
    # Calculate points: 1 point per ₹100 spent on paid orders
    pipeline = [
        {"$match": {"user_id": user["id"], "payment_status": "paid"}},
        {"$group": {"_id": None, "total_spent": {"$sum": "$total_amount"}, "order_count": {"$sum": 1}}}
    ]
    result = await db.orders.aggregate(pipeline).to_list(1)
    
    total_spent = result[0]["total_spent"] if result else 0
    order_count = result[0]["order_count"] if result else 0
    
    # Calculate points earned (1 per 100 INR)
    points_earned = int(total_spent / 100)
    
    # Get redeemed points
    redeemed = await db.loyalty_redemptions.find({"user_id": user["id"]}).to_list(1000)
    points_redeemed = sum(r.get("points", 0) for r in redeemed)
    
    available_points = points_earned - points_redeemed
    
    # Tier calculation
    if total_spent >= 10000:
        tier = "Gold"
        next_tier_at = None
    elif total_spent >= 5000:
        tier = "Silver"
        next_tier_at = 10000 - total_spent
    elif total_spent >= 1000:
        tier = "Bronze"
        next_tier_at = 5000 - total_spent
    else:
        tier = "Starter"
        next_tier_at = 1000 - total_spent
    
    return {
        "tier": tier,
        "total_spent": total_spent,
        "order_count": order_count,
        "points_earned": points_earned,
        "points_redeemed": points_redeemed,
        "available_points": available_points,
        "next_tier_at": next_tier_at,
        "point_value_inr": 1  # 1 point = 1 INR discount
    }

@api_router.post("/loyalty/redeem")
async def redeem_loyalty(data: LoyaltyRedeemRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can redeem points")

    # Validate order first (better error message ordering)
    order = await db.orders.find_one({"_id": safe_objectid(data.order_id, "Order"), "user_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot redeem on already paid order")
    existing_redemption = await db.loyalty_redemptions.find_one({"order_id": data.order_id})
    if existing_redemption:
        raise HTTPException(status_code=400, detail="Points already redeemed for this order")

    # Now validate points
    loyalty = await get_loyalty(user)
    if data.points < 100:
        raise HTTPException(status_code=400, detail="Minimum 100 points to redeem")
    if data.points > loyalty["available_points"]:
        raise HTTPException(status_code=400, detail="Insufficient points")

    discount = min(data.points, order["total_amount"])
    new_total = max(0, order["total_amount"] - discount)

    await db.loyalty_redemptions.insert_one({
        "user_id": user["id"],
        "order_id": data.order_id,
        "points": discount,
        "discount_inr": discount,
        "created_at": datetime.now(timezone.utc)
    })

    await db.orders.update_one(
        {"_id": safe_objectid(data.order_id, "Order")},
        {"$set": {"total_amount": new_total, "loyalty_discount": discount}}
    )

    return {"message": f"{discount} points redeemed", "discount_inr": discount, "new_total": new_total}

# ============== RAZORPAY ==============
# Razorpay payment + refund routes extracted to routers/orders.py

# ============== VENDOR EARNINGS, SETTLEMENT, SETTINGS ==============

@api_router.get("/vendor/today-earnings")
async def vendor_today_earnings(user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors")
    vendor_id = user.get("vendor_id")
    if not vendor_id:
        return {"orders": 0, "revenue": 0.0, "completed": 0, "pending": 0}

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    pipe = [
        {"$match": {"vendor_id": vendor_id, "created_at": {"$gte": today_start}}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
            "revenue": {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, "$total_amount", 0]}},
        }}
    ]
    rows = await db.orders.aggregate(pipe).to_list(20)
    total_orders, total_rev, completed, pending = 0, 0.0, 0, 0
    for r in rows:
        total_orders += r["count"]
        total_rev += r["revenue"]
        if r["_id"] in ("completed", "ready"):
            completed += r["count"]
        elif r["_id"] in ("pending", "confirmed", "preparing"):
            pending += r["count"]
    return {"orders": total_orders, "revenue": round(total_rev, 2), "completed": completed, "pending": pending}


@api_router.get("/vendor/settlement")
async def vendor_settlement(days: int = 7, user: dict = Depends(get_current_user)):
    """Vendor's daily settlement: revenue, commission, net payout for last N days."""
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors")
    vendor_id = user.get("vendor_id")
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)

    # Vendor's commission % (default 15)
    vendor_doc = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")}) if vendor_id else None
    commission_pct = float(vendor_doc.get("commission_pct", 15.0)) if vendor_doc else 15.0

    pipe = [
        {"$match": {"vendor_id": vendor_id, "payment_status": "paid", "created_at": {"$gte": since}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "orders": {"$sum": 1},
            "gross": {"$sum": "$total_amount"},
        }},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.orders.aggregate(pipe).to_list(100)
    daily = []
    total_gross = 0.0
    total_orders = 0
    for r in rows:
        gross = r["gross"]
        commission = round(gross * commission_pct / 100, 2)
        payout = round(gross - commission, 2)
        daily.append({
            "date": r["_id"],
            "orders": r["orders"],
            "gross": round(gross, 2),
            "commission": commission,
            "payout": payout,
        })
        total_gross += gross
        total_orders += r["orders"]
    total_commission = round(total_gross * commission_pct / 100, 2)
    total_payout = round(total_gross - total_commission, 2)
    return {
        "commission_pct": commission_pct,
        "days": days,
        "daily": daily,
        "total_orders": total_orders,
        "total_gross": round(total_gross, 2),
        "total_commission": total_commission,
        "total_payout": total_payout,
    }


@api_router.get("/vendor/settings")
async def get_vendor_settings(user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors")
    vendor_id = user.get("vendor_id")
    if not vendor_id:
        raise HTTPException(status_code=404, detail="No vendor linked to this account")
    vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
    return {
        "auto_confirm": bool(vendor.get("auto_confirm", False)),
        "low_stock_threshold": int(vendor.get("low_stock_threshold", 5)),
        "commission_pct": float(vendor.get("commission_pct", 15.0)),
    }


@api_router.patch("/vendor/settings")
async def update_vendor_settings(updates: Dict[str, Any], user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors")
    vendor_id = user.get("vendor_id")
    allowed = {"auto_confirm", "low_stock_threshold"}
    cleaned = {k: v for k, v in updates.items() if k in allowed}
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid fields")
    if "auto_confirm" in cleaned:
        cleaned["auto_confirm"] = bool(cleaned["auto_confirm"])
    if "low_stock_threshold" in cleaned:
        cleaned["low_stock_threshold"] = max(0, int(cleaned["low_stock_threshold"]))
    await db.vendors.update_one({"_id": safe_objectid(vendor_id, "Vendor")}, {"$set": cleaned})
    return {"message": "Settings updated", **cleaned}


@api_router.patch("/menu/{item_id}/availability")
async def quick_toggle_menu_availability(item_id: str, user: dict = Depends(get_current_user)):
    """Vendor-only quick toggle for own menu items (different from site-control)."""
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors")
    vendor_id = user.get("vendor_id")
    item = await db.menu_items.find_one({"_id": safe_objectid(item_id, "Menu item"), "vendor_id": vendor_id})
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    new_avail = not bool(item.get("is_available", True))
    await db.menu_items.update_one({"_id": item["_id"]}, {"$set": {"is_available": new_avail}})
    return {"id": item_id, "is_available": new_avail}


# ============== FILE UPLOAD (LOCAL STORAGE) ==============

UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', '/tmp/cravitoo_uploads'))
try:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
except (PermissionError, OSError):
    # Fallback to /tmp if primary dir not writable (read-only k8s rootfs)
    UPLOAD_DIR = Path('/tmp/cravitoo_uploads')
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e2:
        logger.error(f"Could not create UPLOAD_DIR: {e2}. File uploads will fail until fixed.")

@api_router.post("/upload/menu-image")
async def upload_menu_image(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    # Only Cravitoo (master/site_admin) can upload menu images. Vendors are read-only.
    if user["role"] not in ("master_admin", "site_admin"):
        raise HTTPException(status_code=403, detail="Only Cravitoo admins can upload menu images.")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()[:5]
    if ext not in ("png", "jpg", "jpeg", "webp", "gif"):
        ext = "png"
    fname = f"{uuid.uuid4().hex}.{ext}"
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 5 MB")
    # Validate it's actually an image (not just a relabeled file)
    try:
        from PIL import Image as PILImage
        import io as _io
        img = PILImage.open(_io.BytesIO(content))
        img.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a valid image")
    mime = f"image/{'jpeg' if ext == 'jpg' else ext}"
    # Persist to Emergent Object Storage (durable across redeploys). The
    # serve_upload route decodes the `s_`-prefixed token back to the path.
    from storage import path_to_url, put_object
    from starlette.concurrency import run_in_threadpool
    storage_path = f"cravitoo/menu-images/{fname}"
    try:
        result = await run_in_threadpool(put_object, storage_path, content, mime)
    except Exception as e:
        logger.error(f"Object storage put failed for menu image: {e}")
        raise HTTPException(status_code=502, detail="Could not save image to storage. Please try again.")
    return {"url": path_to_url(result["path"]), "filename": os.path.basename(result["path"]), "size": len(content)}


@api_router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    """Stream an uploaded file. Supports two backends:

    1. **Emergent Object Storage** (persistent) — filenames prefixed `s_` are
       base64-encoded storage paths. Files here survive redeploys.
    2. **Legacy local disk** (`/tmp/cravitoo_uploads`, ephemeral) — anything
       uploaded before the object-storage migration. These will 404 after a
       redeploy — the user must re-upload.
    """
    from storage import filename_to_path, get_object
    from starlette.concurrency import run_in_threadpool
    storage_path = filename_to_path(filename)
    if storage_path is not None:
        try:
            data, content_type = await run_in_threadpool(get_object, storage_path)
        except Exception as e:
            logger.warning(f"Object storage GET failed for {storage_path}: {e}")
            raise HTTPException(
                status_code=404,
                detail="File not found in persistent storage. Please re-upload.",
            )
        return Response(content=data, media_type=content_type)
    # If the filename LOOKED like an object-storage token (s_-prefixed) but we
    # couldn't decode it, don't fall through to the legacy branch — return the
    # friendly 404 immediately (matches the persistent-storage contract).
    if filename.startswith("s_"):
        raise HTTPException(
            status_code=404,
            detail="File not found in persistent storage. Please re-upload.",
        )
    # Legacy path — sanitise + look on local disk (best-effort; ephemeral).
    if not re.match(r'^[a-z]{0,8}_?[a-f0-9]+\.[a-z]+$', filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = UPLOAD_DIR / filename
    if not fpath.exists():
        raise HTTPException(
            status_code=404,
            detail="File not found — the previous upload was lost on redeploy. Please re-upload the document.",
        )
    return FileResponse(str(fpath))


# Admin vendor-management + integrity + onboarding-resend routes extracted to routers/admin.py


# ============== VENDOR: COUNTERS + SALES REPORT ==============

def _require_vendor(user: dict) -> str:
    if user.get("role") != "vendor" or not user.get("vendor_id"):
        raise HTTPException(status_code=403, detail="Vendor account required")
    return user["vendor_id"]


@api_router.get("/vendor/counters")
async def list_vendor_counters(user: dict = Depends(get_current_user)):
    """Distinct counter names in the vendor's menu."""
    vendor_id = _require_vendor(user)
    names = await db.menu_items.distinct("counter", {"vendor_id": vendor_id, "counter": {"$nin": [None, ""]}})
    return sorted(names)


class _CounterAssignBody(BaseModel):
    counter: Optional[str] = None      # None / empty → clears the tag


@api_router.patch("/vendor/menu-items/{item_id}/counter")
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


@api_router.get("/vendor/reports/sales-summary")
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
            "counter": r["_id"],
            "orders": r["orders"],
            "total_amount": round(r["total_amount"] or 0, 2),
            "paid_amount": round(r["paid_amount"] or 0, 2),
            "pending_amount": round(r["pending_amount"] or 0, 2),
        } for r in per_counter],
    }


@api_router.get("/vendor/reports/sales-orders")
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
            "id": str(r["_id"]),
            "collection_code": r.get("collection_code"),
            "counter": r.get("counter") or "—",
            "items": r.get("items", []),
            "quantity": sum(it.get("quantity", 0) for it in r.get("items", [])),
            "amount": r.get("total_amount"),
            "payment_method": r.get("payment_method"),
            "payment_status": r.get("payment_status"),
            "status": r.get("status"),
            "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
            "site_id": r.get("site_id"),
        } for r in rows],
    }


@api_router.get("/vendor/reports/sales-export")
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
        for r in rows:
            items_str = ", ".join(f"{it.get('name','?')} ×{it.get('quantity',0)}" for it in r.get("items", []))
            w.writerow([
                r.get("created_at").isoformat() if r.get("created_at") else "",
                r.get("collection_code") or str(r.get("_id", "")),
                r.get("counter") or "-",
                items_str,
                sum(it.get("quantity", 0) for it in r.get("items", [])),
                f"{r.get('total_amount', 0):.2f}",
                r.get("payment_method") or "-",
                r.get("payment_status") or "-",
                r.get("status") or "-",
            ])
        # Summary footer
        total_orders = len(rows)
        total_amt = sum(r.get("total_amount", 0) for r in rows)
        paid_amt = sum(r.get("total_amount", 0) for r in rows if r.get("payment_status") == "paid")
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
    total_orders = len(rows); total_amt = sum(r.get("total_amount", 0) for r in rows)
    paid_amt = sum(r.get("total_amount", 0) for r in rows if r.get("payment_status") == "paid")
    story.append(Paragraph(
        f"<b>{total_orders}</b> orders · Total <b>₹{total_amt:,.2f}</b> · Paid <b>₹{paid_amt:,.2f}</b>",
        ParagraphStyle("kpi", fontName="Helvetica", fontSize=10, textColor=_c.HexColor("#1A2233")),
    ))
    story.append(Spacer(1, 6))
    data = [["Date/Time", "Order ID", "Counter", "Items", "Qty", "Amt", "Pay Method", "Pay Status", "Status"]]
    for r in rows[:1500]:  # cap PDF at 1500 rows
        items_str = ", ".join(f"{it.get('name','?')} x{it.get('quantity',0)}" for it in r.get("items", []))[:60]
        data.append([
            r.get("created_at").strftime("%d %b %H:%M") if r.get("created_at") else "-",
            r.get("collection_code") or "-",
            (r.get("counter") or "-")[:16],
            items_str,
            sum(it.get("quantity", 0) for it in r.get("items", [])),
            f"₹{r.get('total_amount', 0):.0f}",
            r.get("payment_method") or "-",
            r.get("payment_status") or "-",
            r.get("status") or "-",
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



@api_router.get("/auth/magic/{token}")
async def verify_magic_link(token: str):
    """Public — checks the magic link without consuming it. Frontend calls this
    when the vendor lands on /auth/magic/:token so we can render the right screen
    (Set Password / Reset Password / already-used)."""
    doc = await db.vendor_magic_links.find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="This link is not valid. Ask your admin to send you a new one.")
    if doc.get("used_at"):
        raise HTTPException(status_code=410, detail="This link was already used. Sign in with your email and password, or use Forgot Password.")

    # Optional expiry (kept nullable — onboarding links never expire, but
    # password-reset links may in future). Skip when None.
    expires_at = doc.get("expires_at")
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="This link expired. Ask your admin to send a new one.")

    user_doc = await db.users.find_one({"_id": safe_objectid(doc["vendor_user_id"], "User")})
    if not user_doc or user_doc.get("is_active") is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact your admin.")
    vendor_doc = await db.vendors.find_one({"_id": safe_objectid(doc.get("vendor_id", ""), "Vendor")}) if doc.get("vendor_id") else None
    return {
        "email": doc.get("email") or user_doc.get("email"),
        "vendor_name": vendor_doc.get("name") if vendor_doc else None,
        "purpose": doc.get("purpose", "onboarding"),
        "user_name": user_doc.get("name"),
    }


class _CompleteMagicBody(BaseModel):
    password: str = Field(min_length=8, max_length=128)


@api_router.post("/auth/magic/{token}/complete")
async def complete_magic_link(token: str, body: _CompleteMagicBody, request: Request, response: Response):
    """Public — validates the password FIRST, then atomically consumes the
    magic link and sets the user's password. A failed password attempt does
    NOT burn the token so the user can retry."""
    # 1) Read the token WITHOUT claiming
    doc = await db.vendor_magic_links.find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    if doc.get("used_at"):
        raise HTTPException(status_code=410, detail="This link was already used. Sign in with your email and password.")
    expires_at = doc.get("expires_at")
    now = datetime.now(timezone.utc)
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise HTTPException(status_code=410, detail="This link expired.")

    user_doc = await db.users.find_one({"_id": safe_objectid(doc["vendor_user_id"], "User")})
    if not user_doc or user_doc.get("is_active") is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact your admin.")

    # 2) Validate password BEFORE consuming the token
    pwd = body.password
    if not any(ch.isalpha() for ch in pwd) or not any(ch.isdigit() for ch in pwd):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter and one number.")

    # 3) Atomically claim — first caller wins; if race, second gets 410
    claim = await db.vendor_magic_links.find_one_and_update(
        {"_id": doc["_id"], "used_at": None},
        {"$set": {"used_at": now}},
    )
    if not claim:
        raise HTTPException(status_code=410, detail="This link was just used from another tab.")

    # 4) Hash + persist password
    try:
        from passlib.hash import bcrypt as _bcrypt
        new_hash = _bcrypt.hash(pwd)
    except Exception:
        import bcrypt as _bc
        new_hash = _bc.hashpw(pwd.encode("utf-8"), _bc.gensalt()).decode("utf-8")

    await db.users.update_one(
        {"_id": user_doc["_id"]},
        {"$set": {
            "password_hash": new_hash,
            "password_updated_at": now,
            "password_changed_at": now,
            "failed_attempts": 0,
        }},
    )

    access = create_access_token(str(user_doc["_id"]), user_doc["email"], user_doc["role"])
    refresh = create_refresh_token(str(user_doc["_id"]))
    secure_cookie = is_secure_request(request)
    samesite_value = "none" if secure_cookie else "lax"
    response.set_cookie("access_token", access, httponly=True, secure=secure_cookie,
                        samesite=samesite_value, max_age=900, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=secure_cookie,
                        samesite=samesite_value, max_age=31536000, path="/")
    await audit_log({"id": str(user_doc["_id"]), "email": user_doc["email"], "role": user_doc["role"]},
                    "auth", str(user_doc["_id"]),
                    "magic_link_completed",
                    {"purpose": claim.get("purpose", "onboarding")})
    return {
        "success": True,
        "role": user_doc["role"],
        "email": user_doc["email"],
        "name": user_doc.get("name"),
        "vendor_id": user_doc.get("vendor_id"),
    }


# Backwards-compat alias — old frontend that hit /consume still works but only
# for links that haven't been used yet (returns metadata without setting password).
@api_router.post("/auth/magic/{token}/consume")
async def consume_magic_link_deprecated(token: str):
    raise HTTPException(
        status_code=410,
        detail="This endpoint has been replaced by GET /auth/magic/{token} + POST /auth/magic/{token}/complete. Please refresh your app.",
    )


class _ForgotPasswordBody(BaseModel):
    email: str


@api_router.post("/auth/forgot-password")
async def forgot_password(body: _ForgotPasswordBody, request: Request):
    """Public. Sends a one-tap password-reset link if the email belongs to a
    known active user. Always returns 200 so attackers cannot enumerate emails.

    Rate-limited: max 3 reset emails per email address per hour (spam guard).
    """
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        # Even for garbage input we return the success message to avoid probing.
        return {"success": True, "message": "If this email is registered, a reset link has been sent."}

    # Anti-spam: no more than 3 resets per email per hour
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = await db.vendor_magic_links.count_documents({
        "email": email,
        "purpose": "password_reset",
        "created_at": {"$gte": one_hour_ago},
    })
    if recent >= 3:
        return {"success": True, "message": "If this email is registered, a reset link has been sent."}

    user_doc = await db.users.find_one({"email": email})
    if user_doc and user_doc.get("is_active") is not False:
        token = secrets.token_urlsafe(32)
        await db.vendor_magic_links.insert_one({
            "token": token,
            "vendor_user_id": str(user_doc["_id"]),
            "vendor_id": user_doc.get("vendor_id"),
            "email": email,
            "purpose": "password_reset",
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),   # reset links DO expire, unlike onboarding
            "used_at": None,
            "created_by_admin": None,
            "created_at": datetime.now(timezone.utc),
        })
        public_base = os.environ.get("PUBLIC_APP_URL", "https://app.cravitoo.com").rstrip("/")
        reset_url = f"{public_base}/auth/magic/{token}"
        try:
            import email_service as _es
            html, text = _es.render_password_reset_email(
                name=user_doc.get("name") or "there",
                reset_url=reset_url,
            )
            _es.send_email(email, "Reset your Cravitoo password", html, text)
        except Exception as e:
            logger.warning(f"Password reset email failed for {email}: {e}")

    # Uniform response regardless of user existence
    return {"success": True, "message": "If this email is registered, a reset link has been sent."}



@api_router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, user: dict = Depends(get_current_user)):
    """Hard-delete a vendor and cascade-clean every child record.

    Master Admin only. Removes: vendor row, its vendor_site_mappings,
    menu_items, orders, order_status_history, reservations, vendor login
    user row, and any favorites pointing at this vendor.
    """
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can delete vendors")
    vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    removed: Dict[str, int] = {}

    order_ids = [str(o["_id"]) async for o in db.orders.find({"vendor_id": vendor_id}, {"_id": 1})]
    if order_ids:
        removed["order_status_history"] = (await db.order_status_history.delete_many(
            {"order_id": {"$in": order_ids}}
        )).deleted_count

    removed["orders"] = (await db.orders.delete_many({"vendor_id": vendor_id})).deleted_count
    removed["reservations"] = (await db.reservations.delete_many({"vendor_id": vendor_id})).deleted_count
    removed["pre_order_reservations"] = (
        await db.pre_order_reservations.delete_many({"vendor_id": vendor_id})
    ).deleted_count
    removed["menu_items"] = (await db.menu_items.delete_many({"vendor_id": vendor_id})).deleted_count
    removed["vendor_site_mappings"] = (
        await db.vendor_site_mappings.delete_many({"vendor_id": vendor_id})
    ).deleted_count
    removed["favorites"] = (await db.favorites.delete_many({"vendor_id": vendor_id})).deleted_count
    removed["vendor_users"] = (await db.users.delete_many(
        {"vendor_id": vendor_id, "role": "vendor"}
    )).deleted_count

    await db.vendors.delete_one({"_id": vendor["_id"]})
    await audit_log(user, "vendor", vendor_id, "deleted",
                    {"name": vendor.get("name"), "removed": removed})
    return {"message": f"Vendor '{vendor.get('name')}' deleted", "removed": removed}


# ============== EMPLOYEE: REFUNDS, FAVOURITES ==============

@api_router.get("/refunds")
async def employee_refunds(user: dict = Depends(get_current_user)):
    """Employee sees their own refunded/cancelled orders."""
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees")
    cursor = db.orders.find({
        "user_id": user["id"],
        "$or": [
            {"status": "cancelled"},
            {"refund_status": {"$exists": True, "$nin": [None, ""]}},
        ],
    }).sort("created_at", -1).limit(100)
    out = []
    async for o in cursor:
        out.append({
            "order_id": str(o["_id"]),
            "vendor_id": o.get("vendor_id"),
            "total_amount": o.get("total_amount", 0),
            "status": o.get("status"),
            "refund_status": o.get("refund_status"),
            "payment_status": o.get("payment_status"),
            "cancelled_at": o.get("cancelled_at").isoformat() if o.get("cancelled_at") else None,
            "refunded_at": o.get("refunded_at").isoformat() if o.get("refunded_at") else None,
            "cancelled_by": o.get("cancelled_by"),
            "created_at": o.get("created_at").isoformat() if o.get("created_at") else None,
        })
    return out


@api_router.get("/favorites")
async def list_favorites(user: dict = Depends(get_current_user)):
    """List employee's favorite vendors."""
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees")
    favs = []
    async for f in db.favorites.find({"user_id": user["id"]}).sort("created_at", -1):
        vendor = await db.vendors.find_one({"_id": safe_objectid(f["vendor_id"], "Vendor")})
        if vendor:
            favs.append({
                "vendor_id": f["vendor_id"],
                "name": vendor.get("name"),
                "cuisine_type": vendor.get("cuisine_type"),
                "rating": vendor.get("rating", 0),
                "image_url": vendor.get("image_url"),
                "favorited_at": f.get("created_at").isoformat() if f.get("created_at") else None,
            })
    return favs


@api_router.post("/favorites/{vendor_id}")
async def add_favorite(vendor_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees")
    vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if await db.favorites.find_one({"user_id": user["id"], "vendor_id": vendor_id}):
        return {"message": "Already favorited"}
    await db.favorites.insert_one({
        "user_id": user["id"],
        "vendor_id": vendor_id,
        "created_at": datetime.now(timezone.utc),
    })
    return {"message": "Added to favorites"}


@api_router.delete("/favorites/{vendor_id}")
async def remove_favorite(vendor_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees")
    await db.favorites.delete_one({"user_id": user["id"], "vendor_id": vendor_id})
    return {"message": "Removed from favorites"}


# /orders/last route extracted to routers/orders.py


# Onboarding bulk-import + menu pre-load extracted to /app/backend/routers/onboarding.py


# ============== EMPLOYEE: CURRENT MEAL PERIOD ==============

def get_current_meal_period_default():
    """Return the current meal period based on IST time (no per-site schedule)."""
    from datetime import timezone as tz, timedelta as td
    ist = datetime.now(tz(td(hours=5, minutes=30)))
    h = ist.hour + ist.minute / 60
    if 6 <= h < 11:
        return "breakfast"
    if 11 <= h < 16:
        return "lunch"
    if 16 <= h < 19:
        return "snacks"
    if 19 <= h < 23:
        return "dinner"
    return None


@api_router.get("/meal-period/current")
async def get_current_meal_period_api():
    """Public endpoint — clients use this to filter menu by meal type."""
    return {"period": get_current_meal_period_default()}


# ============== CITIES & CITY ADMINS ==============

def is_city_admin(user):
    return user.get("role") == "city_admin"

def is_city_or_above(user):
    return user.get("role") in ("master_admin", "city_admin")

async def can_access_city(user, city_id):
    if is_master_admin(user):
        return True
    if user.get("role") == "city_admin" and user.get("city_id") == city_id:
        return True
    return False

async def audit_log(user, entity_type, entity_id, action, details=None):
    """Persist an audit trail entry."""
    await db.audit_log.insert_one({
        "user_id": user.get("id"),
        "user_email": user.get("email"),
        "user_role": user.get("role"),
        "entity_type": entity_type,  # "vendor_onboarding" | "city" | "vendor" etc
        "entity_id": entity_id,
        "action": action,  # "created" | "updated" | "approved" | "rejected" | "uploaded_doc" etc
        "details": details or {},
        "created_at": datetime.now(timezone.utc),
    })

@api_router.post("/cities")
async def create_city(data: CityCreate, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    if await db.cities.find_one({"name": data.name, "state": data.state}):
        raise HTTPException(status_code=400, detail="City already exists")
    doc = {
        "name": data.name,
        "state": data.state,
        "region": data.region,
        "country": data.country,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.cities.insert_one(doc)
    city_id = str(res.inserted_id)
    await audit_log(user, "city", city_id, "created", {"name": data.name, "state": data.state})
    return {"id": city_id, **data.model_dump()}

@api_router.get("/cities")
async def list_cities(
    include_archived: bool = False,
    user: dict = Depends(get_current_user),
):
    """Master sees all (optionally including archived); City Admin sees only their city;
    others see only active cities (used for site selection dropdowns)."""
    if is_master_admin(user):
        cursor = db.cities.find({}) if include_archived else db.cities.find({"status": {"$ne": "archived"}})
    elif is_city_admin(user):
        cid = user.get("city_id")
        cursor = db.cities.find({"_id": safe_objectid(cid, "City")}) if cid else db.cities.find({"_id": None})
    else:
        cursor = db.cities.find({"status": "active"})
    cities = []
    async for c in cursor:
        cities.append({
            "id": str(c["_id"]),
            "name": c.get("name"),
            "state": c.get("state"),
            "region": c.get("region"),
            "country": c.get("country", "India"),
            "status": c.get("status", "active"),
        })
    # Include site count per city
    for c in cities:
        c["site_count"] = await db.sites.count_documents({"city_id": c["id"]})
        c["vendor_count"] = await db.vendor_onboarding.count_documents({"city_id": c["id"], "status": "active"})
    return cities

@api_router.get("/cities/{city_id}")
async def get_city(city_id: str, user: dict = Depends(get_current_user)):
    if not await can_access_city(user, city_id):
        raise HTTPException(status_code=403, detail="Access denied")
    city = await db.cities.find_one({"_id": safe_objectid(city_id, "City")})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    return {
        "id": str(city["_id"]),
        "name": city.get("name"),
        "state": city.get("state"),
        "region": city.get("region"),
        "country": city.get("country", "India"),
        "status": city.get("status", "active"),
    }

@api_router.patch("/cities/{city_id}")
async def update_city(city_id: str, payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    allowed = {"name", "state", "region", "country", "status"}
    cleaned = {k: v for k, v in payload.items() if k in allowed}
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid fields")
    await db.cities.update_one({"_id": safe_objectid(city_id, "City")}, {"$set": cleaned})
    await audit_log(user, "city", city_id, "updated", cleaned)
    return {"message": "City updated"}


@api_router.post("/cities/{city_id}/archive")
async def archive_city(city_id: str, user: dict = Depends(get_current_user)):
    """Soft-archive a city. Hides it from sign-up flows but preserves history."""
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    city = await db.cities.find_one({"_id": safe_objectid(city_id, "City")})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    await db.cities.update_one(
        {"_id": city["_id"]},
        {"$set": {"status": "archived", "archived_at": datetime.now(timezone.utc)}},
    )
    await audit_log(user, "city", city_id, "archived", {})
    return {"message": "City archived", "status": "archived"}


@api_router.post("/cities/{city_id}/restore")
async def restore_city(city_id: str, user: dict = Depends(get_current_user)):
    """Restore an archived city back to active."""
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    city = await db.cities.find_one({"_id": safe_objectid(city_id, "City")})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    await db.cities.update_one(
        {"_id": city["_id"]},
        {"$set": {"status": "active"}, "$unset": {"archived_at": ""}},
    )
    await audit_log(user, "city", city_id, "restored", {})
    return {"message": "City restored", "status": "active"}


@api_router.delete("/cities/{city_id}")
async def delete_city(city_id: str, user: dict = Depends(get_current_user)):
    """Hard delete a city. Blocked if any Sites are still linked (per platform hierarchy spec)."""
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    city = await db.cities.find_one({"_id": safe_objectid(city_id, "City")})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    # Hierarchy safety: a City with Sites cannot be deleted (must archive instead)
    linked_sites = await db.sites.count_documents({"city_id": city_id})
    if linked_sites > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {linked_sites} site(s) are linked. Move or archive sites first, or archive this city instead.",
        )
    # Block if a City Admin user is bound to this city
    linked_users = await db.users.count_documents({"city_id": city_id})
    if linked_users > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {linked_users} City Admin(s) are linked. Move them first.",
        )
    await db.cities.delete_one({"_id": city["_id"]})
    await audit_log(user, "city", city_id, "deleted", {"name": city.get("name")})
    return {"message": "City deleted"}

@api_router.post("/admin/city-admins")
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


# ============== VENDOR ONBOARDING ==============

def calc_checklist_pct(checklist: dict) -> int:
    if not checklist:
        return 0
    done = sum(1 for f in CHECKLIST_FIELDS if checklist.get(f))
    return int(done * 100 / len(CHECKLIST_FIELDS))

def onboarding_to_dict(o):
    return {
        "id": str(o["_id"]),
        "vendor_name": o.get("vendor_name"),
        "company_name": o.get("company_name"),
        "contact_person": o.get("contact_person"),
        "mobile_number": o.get("mobile_number"),
        "email": o.get("email"),
        "business_address": o.get("business_address"),
        "cuisine_type": o.get("cuisine_type"),
        "site_id": o.get("site_id"),
        "city_id": o.get("city_id"),
        "status": o.get("status", "draft"),
        "checklist": o.get("checklist", {}),
        "checklist_pct": calc_checklist_pct(o.get("checklist", {})),
        "documents": o.get("documents", {}),
        "draft_menu": o.get("draft_menu", []),
        "vendor_id": o.get("vendor_id"),  # set when approved
        "remarks": o.get("remarks", []),
        "created_by": o.get("created_by"),
        "created_at": o.get("created_at").isoformat() if o.get("created_at") else None,
        "updated_at": o.get("updated_at").isoformat() if o.get("updated_at") else None,
    }

# Onboarding endpoints (create/list/get/patch/checklist/docs/site-review/master-decision/dashboard) extracted to /app/backend/routers/onboarding.py


# ============== CITY PERFORMANCE LEADERBOARD ==============

@api_router.get("/reports/city-leaderboard")
async def city_leaderboard(days: int = 30, user: dict = Depends(get_current_user)):
    """Ranked list of cities by revenue, orders, vendor count, avg checklist."""
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin")
    days = max(1, min(days, 365))
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)

    cities_cursor = db.cities.find({})
    rows = []
    async for c in cities_cursor:
        cid = str(c["_id"])
        site_ids = [str(s["_id"]) async for s in db.sites.find({"city_id": cid}, {"_id": 1})]
        vendor_count = await db.vendor_onboarding.count_documents({"city_id": cid, "status": "active"})
        pending = await db.vendor_onboarding.count_documents({
            "city_id": cid,
            "status": {"$in": ["documents_pending", "under_site_review", "under_master_review", "changes_requested"]}
        })
        in_progress_cursor = db.vendor_onboarding.find({"city_id": cid, "status": {"$nin": ["approved", "active", "rejected"]}})
        pcts = []
        async for o in in_progress_cursor:
            pcts.append(calc_checklist_pct(o.get("checklist", {})))
        avg_pct = round(sum(pcts) / len(pcts), 1) if pcts else 0.0

        revenue, orders = 0.0, 0
        if site_ids:
            user_ids = [str(u["_id"]) async for u in db.users.find({"site_id": {"$in": site_ids}, "role": "employee"}, {"_id": 1})]
            if user_ids:
                pipe = [
                    {"$match": {"user_id": {"$in": user_ids}, "payment_status": "paid", "created_at": {"$gte": since}}},
                    {"$group": {"_id": None, "revenue": {"$sum": "$total_amount"}, "orders": {"$sum": 1}}}
                ]
                async for r in db.orders.aggregate(pipe):
                    revenue = round(r.get("revenue", 0), 2)
                    orders = r.get("orders", 0)

        rows.append({
            "city_id": cid,
            "name": c.get("name", "Unknown"),
            "state": c.get("state", ""),
            "site_count": len(site_ids),
            "vendor_count": vendor_count,
            "pending_onboardings": pending,
            "avg_checklist_pct": avg_pct,
            "orders": orders,
            "revenue": revenue,
        })

    rows.sort(key=lambda r: r["revenue"], reverse=True)
    return {"days": days, "cities": rows, "total_revenue": round(sum(r["revenue"] for r in rows), 2)}


# ============== MASTER ADMIN: ANALYTICS CHARTS ==============

@api_router.get("/reports/charts")
async def master_charts(days: int = 14, user: dict = Depends(get_current_user)):
    """Time-series for charts on master dashboard."""
    if not is_master_admin(user) and user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Access denied")
    days = max(7, min(days, 90))
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)

    # Daily revenue
    rev_pipe = [
        {"$match": {"payment_status": "paid", "created_at": {"$gte": since}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "revenue": {"$sum": "$total_amount"},
            "orders": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    daily = await db.orders.aggregate(rev_pipe).to_list(100)
    daily_revenue = [{"date": d["_id"], "revenue": round(d["revenue"], 2), "orders": d["orders"]} for d in daily]

    # Top dishes by quantity (last N days)
    items_pipe = [
        {"$match": {"payment_status": "paid", "created_at": {"$gte": since}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.menu_item_id",
            "qty": {"$sum": "$items.quantity"},
            "revenue": {"$sum": {"$multiply": ["$items.quantity", "$items.price"]}},
        }},
        {"$sort": {"qty": -1}},
        {"$limit": 5},
    ]
    top_items_raw = await db.orders.aggregate(items_pipe).to_list(5)
    top_dishes = []
    for it in top_items_raw:
        mid = it.get("_id")
        name = "Unknown"
        if mid and ObjectId.is_valid(mid):
            mi = await db.menu_items.find_one({"_id": ObjectId(mid)})
            if mi:
                name = mi.get("name", "Unknown")
        top_dishes.append({"menu_item_id": mid, "name": name, "qty": it["qty"], "revenue": round(it["revenue"], 2)})

    return {"days": days, "daily_revenue": daily_revenue, "top_dishes": top_dishes}


# ============== BULK EMPLOYEE CSV UPLOAD ==============

@api_router.post("/admin/employees/bulk-csv")
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


# Sites, vendor-site mapping, meal schedules, site menu, admin CRUD, master/site reports, employee/my-site
# extracted to /app/backend/routers/sites.py

# ============== WEBSOCKETS ==============

@app.websocket("/ws/orders")
async def websocket_orders(websocket: WebSocket, token: str = Query(...)):
    """Employee WebSocket: subscribes to their own order updates."""
    payload = verify_ws_token(token)
    if not payload:
        await websocket.close(code=1008, reason="Unauthorized")
        return
    user_id = payload["sub"]
    await manager.connect_user(user_id, websocket)
    try:
        # Send initial ping
        await websocket.send_json({"type": "connected", "user_id": user_id})
        while True:
            # Keep alive - clients can send ping, we echo pong
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect_user(user_id, websocket)
    except Exception as e:
        logger.error(f"WS error for user {user_id}: {e}")
        manager.disconnect_user(user_id, websocket)

@app.websocket("/ws/vendor")
async def websocket_vendor(websocket: WebSocket, token: str = Query(...)):
    """Vendor WebSocket: subscribes to their vendor's order events."""
    payload = verify_ws_token(token)
    if not payload:
        await websocket.close(code=1008, reason="Unauthorized")
        return
    user_id = payload["sub"]
    # Lookup vendor_id
    user = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
    if not user or user.get("role") != "vendor" or not user.get("vendor_id"):
        await websocket.close(code=1008, reason="Not a vendor")
        return
    vendor_id = user["vendor_id"]
    await manager.connect_vendor(vendor_id, websocket)
    try:
        await websocket.send_json({"type": "connected", "vendor_id": vendor_id})
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect_vendor(vendor_id, websocket)
    except Exception as e:
        logger.error(f"WS error for vendor {vendor_id}: {e}")
        manager.disconnect_vendor(vendor_id, websocket)

# Pre-order reservation routes extracted to /app/backend/routers/reservations.py
# Router wired below near app.include_router

# Weekly admin reports extracted to /app/backend/routers/admin_reports.py


app.include_router(api_router)

# Modular routers
from routers.reservations import make_router as make_reservations_router  # noqa: E402
from routers.menu_change_requests import make_router as make_menu_change_router  # noqa: E402
from routers.admin_reports import make_router as make_admin_reports_router  # noqa: E402
from routers.onboarding import make_router as make_onboarding_router  # noqa: E402
from routers.sites import make_router as make_sites_router  # noqa: E402
from routers.auth import make_router as make_auth_router  # noqa: E402
from routers.ai_menu_photos import make_router as make_ai_menu_photos_router  # noqa: E402
from routers.notifications_prefs import make_router as make_notifications_prefs_router  # noqa: E402
from routers.broadcasts import make_router as make_broadcasts_router  # noqa: E402
from routers.allowed_domains import make_router as make_allowed_domains_router  # noqa: E402
from routers.exports import make_router as make_exports_router  # noqa: E402
from routers.corporate_clients import make_router as make_corporate_clients_router  # noqa: E402
from routers.billing import make_router as make_billing_router, run_billing_for_period  # noqa: E402
from routers.reset import make_router as make_reset_router  # noqa: E402
from routers.cafeterias import make_router as make_cafeterias_router, ensure_default_cafeterias  # noqa: E402
from routers.orders import make_router as make_orders_router  # noqa: E402
from routers.admin import make_router as make_admin_router  # noqa: E402
app.include_router(make_reservations_router(db, safe_objectid, get_current_user, create_notification), prefix="/api")
app.include_router(make_menu_change_router(db, safe_objectid, get_current_user, create_notification, UPLOAD_DIR), prefix="/api")
app.include_router(make_admin_reports_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_onboarding_router(db, safe_objectid, get_current_user, audit_log, UPLOAD_DIR), prefix="/api")
app.include_router(make_sites_router(db, safe_objectid, get_current_user, hash_password, current_meal_period), prefix="/api")
app.include_router(make_auth_router(
    db, safe_objectid, get_current_user,
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    is_secure_request,
    check_brute_force, record_failed_login, clear_login_attempts,
    LOCKOUT_MINUTES,
), prefix="/api")
app.include_router(make_ai_menu_photos_router(db, safe_objectid, get_current_user, UPLOAD_DIR), prefix="/api")
app.include_router(make_notifications_prefs_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_broadcasts_router(db, safe_objectid, get_current_user, create_notification), prefix="/api")
app.include_router(make_allowed_domains_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_exports_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_corporate_clients_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_billing_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_reset_router(db, get_current_user), prefix="/api")
app.include_router(make_cafeterias_router(db, safe_objectid, get_current_user), prefix="/api")
app.include_router(make_orders_router(
    db, safe_objectid, get_current_user, create_notification, manager,
    generate_pickup_qr, verify_pickup_qr,
), prefix="/api")
app.include_router(make_admin_router(
    db, safe_objectid, get_current_user, is_master_admin, audit_log,
), prefix="/api")


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()