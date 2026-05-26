from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, WebSocket, WebSocketDisconnect, Query, UploadFile, File
from fastapi.responses import JSONResponse
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
import json
import asyncio
import hmac
import hashlib
import razorpay
import io
import openpyxl
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionResponse, CheckoutStatusResponse, CheckoutSessionRequest

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

app = FastAPI()
api_router = APIRouter(prefix="/api")

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

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
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
        user["_id"] = str(user["_id"])
        user["id"] = user["_id"]
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Models
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "employee"
    company_id: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(alias="_id")
    email: str
    name: str
    role: str
    company_id: Optional[str] = None
    vendor_id: Optional[str] = None
    created_at: datetime

class CompanyCreate(BaseModel):
    name: str
    address: str
    contact_email: EmailStr
    contact_phone: str

class CompanyResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    address: str
    contact_email: str
    contact_phone: str
    status: str
    created_at: datetime

class VendorCreate(BaseModel):
    name: str
    description: str
    cuisine_type: str
    contact_email: EmailStr
    contact_phone: str

class VendorResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    description: str
    cuisine_type: str
    contact_email: str
    contact_phone: str
    rating: float
    status: str
    created_at: datetime

class MenuItemCreate(BaseModel):
    name: str
    description: str
    category: str
    price: float
    image_url: Optional[str] = None
    is_vegetarian: bool = False
    is_available: bool = True

class MenuItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    vendor_id: str
    name: str
    description: str
    category: str
    price: float
    image_url: Optional[str] = None
    is_vegetarian: bool
    is_available: bool
    created_at: datetime

class OrderItemInput(BaseModel):
    menu_item_id: str
    quantity: int
    price: float

class OrderCreate(BaseModel):
    vendor_id: str
    items: List[OrderItemInput]
    delivery_type: str = "pickup"
    special_instructions: Optional[str] = None

class OrderResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    vendor_id: str
    items: List[Dict[str, Any]]
    total_amount: float
    status: str
    delivery_type: str
    special_instructions: Optional[str] = None
    created_at: datetime

class AIRecommendationRequest(BaseModel):
    user_preferences: Optional[str] = None
    dietary_restrictions: Optional[str] = None

# ====== Multi-tenant Site Models ======

class SiteCreate(BaseModel):
    name: str
    company_id: Optional[str] = None
    address: str
    city: str
    contact_email: EmailStr
    contact_phone: str
    # Ordering controls
    allow_pre_order: bool = True
    allow_cash_carry: bool = True
    allow_company_paid: bool = False
    allow_employee_paid: bool = True

class VendorSiteMappingCreate(BaseModel):
    vendor_id: str
    site_id: str

class MealScheduleEntry(BaseModel):
    meal_period: str  # 'breakfast' | 'lunch' | 'snacks' | 'dinner'
    start_time: str  # "07:30"
    end_time: str    # "10:30"
    enabled: bool = True

class MealScheduleUpdate(BaseModel):
    schedules: List[MealScheduleEntry]

class SiteAdminCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    site_id: str

class SuperAdminCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    assigned_sites: List[str]

class MasterAdminCreate(BaseModel):
    email: EmailStr  # MUST be @cravitoo.com
    password: str
    name: str

class MenuItemSiteUpdate(BaseModel):
    is_available: Optional[bool] = None
    price: Optional[float] = None
    show_price: Optional[bool] = None
    meal_periods: Optional[List[str]] = None

class CheckoutRequest(BaseModel):
    order_id: str
    origin_url: str

class ReviewCreate(BaseModel):
    vendor_id: str
    order_id: str
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None

class PreferencesUpdate(BaseModel):
    dietary_preferences: Optional[List[str]] = None
    allergies: Optional[List[str]] = None
    favorite_cuisines: Optional[List[str]] = None

class SubscriptionCreate(BaseModel):
    vendor_id: str
    plan_type: str
    meal_type: str
    duration_days: int

class EmployeeCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    department: Optional[str] = None
    employee_id: Optional[str] = None

class BulkOrderItem(BaseModel):
    user_email: EmailStr
    items: List[OrderItemInput]

class BulkOrderCreate(BaseModel):
    vendor_id: str
    orders: List[BulkOrderItem]
    delivery_type: str = "pickup"
    sponsored: bool = False
    occasion: Optional[str] = None

class EventCateringCreate(BaseModel):
    vendor_id: str
    event_name: str
    event_date: str
    headcount: int
    menu_items: List[OrderItemInput]
    notes: Optional[str] = None

class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    type: str = "info"

class LoyaltyRedeemRequest(BaseModel):
    points: int
    order_id: str

from enum import Enum

class OrderStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    preparing = "preparing"
    ready = "ready"
    completed = "completed"
    cancelled = "cancelled"

# Helper - safe ObjectId parsing
def safe_objectid(id_str: str, entity_name: str = "Resource") -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=404, detail=f"{entity_name} not found")

# Helper - detect if request is HTTPS
def is_secure_request(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    return forwarded_proto == "https" or request.url.scheme == "https"

# Helper - generate QR code data for order pickup
def generate_pickup_qr(order_id: str) -> str:
    import hashlib
    qr_hash = hashlib.sha256(f"{order_id}{JWT_SECRET}".encode()).hexdigest()[:16]
    return f"CRAVITOO-PICKUP-{order_id}-{qr_hash}"

def verify_pickup_qr(qr_code: str, order_id: str) -> bool:
    import hashlib
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
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.companies.create_index("name")
    await db.vendors.create_index("name")
    await db.menu_items.create_index("vendor_id")
    await db.menu_items.create_index("site_id")
    await db.orders.create_index("user_id")
    await db.orders.create_index("vendor_id")
    await db.orders.create_index("site_id")
    await db.notifications.create_index("user_id")
    await db.notifications.create_index("created_at")
    await db.sites.create_index("name")
    await db.vendor_site_mappings.create_index([("vendor_id", 1), ("site_id", 1)], unique=True)
    await db.meal_schedules.create_index("site_id", unique=True)
    
    await seed_admin()
    await seed_demo_data()

async def seed_admin():
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
    else:
        updates = {}
        if existing.get("role") != "master_admin":
            updates["role"] = "master_admin"
            updates["name"] = "Master Admin"
        if not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})
            logger.info("Master admin updated")

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
        logger.info(f"Demo company created: Tech Corp")
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
        logger.info(f"Demo corporate admin created")
    
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
        logger.info(f"Demo vendor created: Spice Kitchen")
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
        logger.info(f"Demo vendor user created")
    
    if not await db.users.find_one({"email": demo_employee_email}):
        await db.users.insert_one({
            "email": demo_employee_email,
            "password_hash": hash_password("employee123"),
            "name": "John Doe",
            "role": "employee",
            "company_id": company_id,
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Demo employee created")
    
    if await db.menu_items.count_documents({"vendor_id": vendor_id}) == 0:
        menu_items = [
            {"vendor_id": vendor_id, "name": "Paneer Tikka", "description": "Grilled cottage cheese with spices", "category": "Appetizer", "price": 180.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Butter Chicken", "description": "Creamy tomato curry with tender chicken", "category": "Main Course", "price": 280.0, "is_vegetarian": False, "is_available": True, "image_url": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Dal Makhani", "description": "Black lentils in rich creamy gravy", "category": "Main Course", "price": 220.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1546833999-b9f581a1996d", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Garlic Naan", "description": "Soft bread with garlic butter", "category": "Bread", "price": 60.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1628840042765-356cda07504e", "created_at": datetime.now(timezone.utc)},
            {"vendor_id": vendor_id, "name": "Gulab Jamun", "description": "Sweet milk dumplings in sugar syrup", "category": "Dessert", "price": 80.0, "is_vegetarian": True, "is_available": True, "image_url": "https://images.unsplash.com/photo-1589119908995-c6b5f3e3bf6a", "created_at": datetime.now(timezone.utc)}
        ]
        await db.menu_items.insert_many(menu_items)
        logger.info(f"Demo menu items created")
    
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
        logger.info(f"Demo site created with meal schedules")
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
    Path("/app/memory").mkdir(exist_ok=True)
    Path("/app/memory/test_credentials.md").write_text(test_creds_content)

# Auth Routes
@api_router.post("/auth/register")
async def register(data: RegisterRequest, request: Request, response: Response):
    email_lower = data.email.lower()
    existing = await db.users.find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_doc = {
        "email": email_lower,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": data.role,
        "created_at": datetime.now(timezone.utc)
    }
    
    if data.company_id:
        user_doc["company_id"] = data.company_id
    
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email_lower, data.role)
    refresh_token = create_refresh_token(user_id)
    
    secure_cookie = is_secure_request(request)
    samesite_value = "none" if secure_cookie else "lax"
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=secure_cookie, samesite=samesite_value, max_age=604800, path="/")
    
    return {"id": user_id, "email": email_lower, "name": data.name, "role": data.role, "access_token": access_token, "refresh_token": refresh_token}

@api_router.post("/auth/login")
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

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}

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
@api_router.post("/vendors")
async def create_vendor(data: VendorCreate, user: dict = Depends(get_current_user)):
    if user["role"] not in ["super_admin", "corporate_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    vendor_doc = {
        **data.model_dump(),
        "rating": 0.0,
        "status": "active",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.vendors.insert_one(vendor_doc)
    return {"id": str(result.inserted_id), **data.model_dump(), "rating": 0.0, "status": "active"}

@api_router.get("/vendors")
async def get_vendors():
    vendors = await db.vendors.find({"status": "active"}, {"_id": 1, "name": 1, "description": 1, "cuisine_type": 1, "rating": 1, "status": 1}).to_list(1000)
    for vendor in vendors:
        vendor["id"] = str(vendor.pop("_id"))
    return vendors

@api_router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str):
    vendor = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    vendor["id"] = str(vendor.pop("_id"))
    return vendor

# Menu Routes
@api_router.post("/menu")
async def create_menu_item(data: MenuItemCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can create menu items")
    
    menu_doc = {
        **data.model_dump(),
        "vendor_id": user.get("vendor_id"),
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.menu_items.insert_one(menu_doc)
    return {"id": str(result.inserted_id), **data.model_dump()}

@api_router.get("/menu/{vendor_id}")
async def get_menu(vendor_id: str):
    menu_items = await db.menu_items.find({"vendor_id": vendor_id, "is_available": True}, {"_id": 1, "name": 1, "description": 1, "category": 1, "price": 1, "image_url": 1, "is_vegetarian": 1, "is_available": 1}).to_list(1000)
    for item in menu_items:
        item["id"] = str(item.pop("_id"))
    return menu_items

@api_router.patch("/menu/{item_id}")
async def update_menu_item(item_id: str, data: Dict[str, Any], user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can update menu items")
    
    await db.menu_items.update_one({"_id": safe_objectid(item_id, "Menu item"), "vendor_id": user.get("vendor_id")}, {"$set": data})
    return {"message": "Menu item updated"}

# Order Routes
@api_router.post("/orders")
async def create_order(data: OrderCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can create orders")
    
    # Server-side price validation - look up actual prices from DB
    validated_items = []
    total_amount = 0.0
    for item in data.items:
        menu_item = await db.menu_items.find_one({"_id": safe_objectid(item.menu_item_id, "Menu item")})
        if not menu_item:
            raise HTTPException(status_code=400, detail=f"Menu item {item.menu_item_id} not found")
        if not menu_item.get("is_available", False):
            raise HTTPException(status_code=400, detail=f"Menu item {menu_item['name']} is not available")
        actual_price = menu_item["price"]
        validated_items.append({
            "menu_item_id": item.menu_item_id,
            "name": menu_item["name"],
            "quantity": item.quantity,
            "price": actual_price
        })
        total_amount += actual_price * item.quantity
    
    order_doc = {
        "user_id": user["id"],
        "vendor_id": data.vendor_id,
        "items": validated_items,
        "total_amount": total_amount,
        "status": "pending",
        "payment_status": "pending",
        "delivery_type": data.delivery_type,
        "special_instructions": data.special_instructions,
        "created_at": datetime.now(timezone.utc)
    }
    
    result = await db.orders.insert_one(order_doc)
    order_id = str(result.inserted_id)
    
    # Generate QR code for pickup
    qr_code = generate_pickup_qr(order_id)
    await db.orders.update_one({"_id": result.inserted_id}, {"$set": {"pickup_qr": qr_code}})
    
    # Notify vendor of new order
    vendor_users = await db.users.find({"vendor_id": data.vendor_id, "role": "vendor"}).to_list(10)
    for vu in vendor_users:
        await create_notification(
            str(vu["_id"]),
            "New Order Received",
            f"You have a new order for ₹{total_amount:.2f}",
            "order"
        )

    # Broadcast WebSocket event to vendor
    await manager.send_to_vendor(data.vendor_id, {
        "type": "new_order",
        "order_id": order_id,
        "status": "pending",
        "amount": total_amount,
        "items_count": len(validated_items)
    })

    return {"id": order_id, "total_amount": total_amount, "status": "pending", "pickup_qr": qr_code}

@api_router.get("/orders")
async def get_orders(user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] == "employee":
        query["user_id"] = user["id"]
    elif user["role"] == "vendor":
        query["vendor_id"] = user.get("vendor_id")
    
    orders = await db.orders.find(query, {"_id": 1, "user_id": 1, "vendor_id": 1, "items": 1, "total_amount": 1, "status": 1, "payment_status": 1, "delivery_type": 1, "created_at": 1, "pickup_qr": 1}).sort("created_at", -1).to_list(1000)
    for order in orders:
        order["id"] = str(order.pop("_id"))
    return orders

@api_router.patch("/orders/{order_id}")
async def update_order_status(order_id: str, status: OrderStatus, user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can update order status")
    
    order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order"), "vendor_id": user.get("vendor_id")})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found or not yours")
    
    await db.orders.update_one(
        {"_id": safe_objectid(order_id, "Order")},
        {"$set": {"status": status.value}}
    )

    # Notify employee with push + ws
    status_messages = {
        "confirmed": "Your order has been confirmed!",
        "preparing": "Your food is being prepared",
        "ready": "Your order is ready for pickup!",
        "completed": "Order completed. Enjoy your meal!",
        "cancelled": "Your order was cancelled"
    }
    msg = status_messages.get(status.value, f"Order status: {status.value}")
    await create_notification(
        order["user_id"],
        f"Order #{order_id[-8:]}",
        msg,
        "order"
    )

    # Broadcast WebSocket event
    await manager.send_to_user(order["user_id"], {
        "type": "order_update",
        "order_id": order_id,
        "status": status.value
    })

    return {"message": "Order status updated", "status": status.value}

@api_router.post("/orders/{order_id}/verify-pickup")
async def verify_pickup(order_id: str, qr_code: str, user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can verify pickup")
    
    order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order"), "vendor_id": user.get("vendor_id")})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if not verify_pickup_qr(qr_code, order_id):
        raise HTTPException(status_code=400, detail="Invalid QR code")
    
    await db.orders.update_one({"_id": safe_objectid(order_id, "Order")}, {"$set": {"status": "completed"}})
    return {"message": "Pickup verified successfully", "order_id": order_id}

# Payment Routes
@api_router.post("/payments/checkout")
async def create_checkout_session(data: CheckoutRequest, request: Request, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"_id": safe_objectid(data.order_id, "Order")})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if order["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    
    host_url = data.origin_url
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=webhook_url)
    
    success_url = f"{host_url}/employee/orders?session_id={{{{CHECKOUT_SESSION_ID}}}}"
    cancel_url = f"{host_url}/employee/orders"
    
    checkout_request = CheckoutSessionRequest(
        amount=order["total_amount"],
        currency="inr",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"order_id": data.order_id, "user_id": user["id"]}
    )
    
    session = await stripe_checkout.create_checkout_session(checkout_request)
    
    await db.payment_transactions.insert_one({
        "order_id": data.order_id,
        "user_id": user["id"],
        "session_id": session.session_id,
        "amount": order["total_amount"],
        "currency": "inr",
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/payments/status/{session_id}")
async def get_checkout_status(session_id: str, user: dict = Depends(get_current_user)):
    transaction = await db.payment_transactions.find_one({"session_id": session_id})
    if not transaction:
        raise HTTPException(status_code=404, detail="Payment session not found")
    
    # Authorization scope - only owner or vendor of the order can check
    if transaction["user_id"] != user["id"] and user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Not authorized to view this payment")
    
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url="")
    status = await stripe_checkout.get_checkout_status(session_id)
    
    if transaction["payment_status"] != "paid" and status.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": "paid"}}
        )
        await db.orders.update_one(
            {"_id": ObjectId(transaction["order_id"])},
            {"$set": {"payment_status": "paid", "status": "confirmed"}}
        )
    
    return {"payment_status": status.payment_status, "amount": status.amount_total / 100}

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url="")
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        if webhook_response.payment_status == "paid":
            transaction = await db.payment_transactions.find_one({"session_id": webhook_response.session_id})
            if transaction and transaction["payment_status"] != "paid":
                await db.payment_transactions.update_one(
                    {"session_id": webhook_response.session_id},
                    {"$set": {"payment_status": "paid"}}
                )
                await db.orders.update_one(
                    {"_id": ObjectId(transaction["order_id"])},
                    {"$set": {"payment_status": "paid", "status": "confirmed"}}
                )
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Webhook error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

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
async def create_notification(user_id: str, title: str, message: str, notif_type: str = "info"):
    await db.notifications.insert_one({
        "user_id": user_id,
        "title": title,
        "message": message,
        "type": notif_type,
        "read": False,
        "created_at": datetime.now(timezone.utc)
    })

# Menu CRUD - DELETE
@api_router.delete("/menu/{item_id}")
async def delete_menu_item(item_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can delete menu items")
    result = await db.menu_items.delete_one({"_id": safe_objectid(item_id, "Menu item"), "vendor_id": user.get("vendor_id")})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return {"message": "Menu item deleted"}

@api_router.get("/menu/vendor/all")
async def get_my_menu(user: dict = Depends(get_current_user)):
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

# Bulk Team Ordering
@api_router.post("/orders/bulk")
async def create_bulk_order(data: BulkOrderCreate, user: dict = Depends(get_current_user)):
    if user["role"] not in ["corporate_admin", "employee"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    bulk_order_id = str(ObjectId())
    total_amount = 0.0
    individual_orders = []
    skipped = []
    
    for bulk_item in data.orders:
        target_user = await db.users.find_one({"email": bulk_item.user_email.lower()})
        if not target_user:
            skipped.append({"email": bulk_item.user_email, "reason": "user_not_found"})
            continue
        
        validated_items = []
        order_total = 0.0
        invalid_item_ids = []
        for item in bulk_item.items:
            try:
                menu_obj_id = ObjectId(item.menu_item_id)
            except Exception:
                invalid_item_ids.append(item.menu_item_id)
                continue
            menu_item = await db.menu_items.find_one({"_id": menu_obj_id})
            if not menu_item or not menu_item.get("is_available", False):
                invalid_item_ids.append(item.menu_item_id)
                continue
            actual_price = menu_item["price"]
            validated_items.append({
                "menu_item_id": item.menu_item_id,
                "name": menu_item["name"],
                "quantity": item.quantity,
                "price": actual_price
            })
            order_total += actual_price * item.quantity
        
        if not validated_items:
            skipped.append({"email": bulk_item.user_email, "reason": "no_valid_items", "invalid_item_ids": invalid_item_ids})
            continue
        
        order_doc = {
            "user_id": str(target_user["_id"]),
            "vendor_id": data.vendor_id,
            "items": validated_items,
            "total_amount": order_total,
            "status": "pending",
            "payment_status": "paid" if data.sponsored else "pending",
            "delivery_type": data.delivery_type,
            "bulk_order_id": bulk_order_id,
            "sponsored": data.sponsored,
            "sponsored_by": user["id"] if data.sponsored else None,
            "occasion": data.occasion,
            "created_at": datetime.now(timezone.utc)
        }
        result = await db.orders.insert_one(order_doc)
        order_id = str(result.inserted_id)
        qr_code = generate_pickup_qr(order_id)
        await db.orders.update_one({"_id": result.inserted_id}, {"$set": {"pickup_qr": qr_code, "status": "confirmed" if data.sponsored else "pending"}})
        
        await create_notification(
            str(target_user["_id"]),
            f"New {'Sponsored ' if data.sponsored else ''}Order",
            f"You have a new order{' (sponsored by company)' if data.sponsored else ''}{' - ' + data.occasion if data.occasion else ''}",
            "order"
        )
        
        total_amount += order_total
        individual_orders.append({"order_id": order_id, "user_email": bulk_item.user_email, "amount": order_total})
    
    await db.bulk_orders.insert_one({
        "_id": ObjectId(bulk_order_id),
        "created_by": user["id"],
        "vendor_id": data.vendor_id,
        "total_amount": total_amount,
        "order_count": len(individual_orders),
        "sponsored": data.sponsored,
        "occasion": data.occasion,
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"bulk_order_id": bulk_order_id, "total_amount": total_amount, "orders": individual_orders, "skipped": skipped}

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

RAZORPAY_MOCK_MODE = os.environ.get('RAZORPAY_MOCK_MODE', 'true').lower() == 'true'

def get_razorpay_client():
    """Get razorpay client if not in mock mode, else None"""
    if RAZORPAY_MOCK_MODE:
        return None
    return razorpay.Client(auth=(os.environ['RAZORPAY_KEY_ID'], os.environ['RAZORPAY_KEY_SECRET']))

class RazorpayOrderCreate(BaseModel):
    order_id: str  # internal Cravitoo order ID

class RazorpayVerify(BaseModel):
    order_id: str  # Cravitoo order ID
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str

@api_router.post("/payments/razorpay/create-order")
async def razorpay_create_order(data: RazorpayOrderCreate, user: dict = Depends(get_current_user)):
    """Create a Razorpay order linked to a Cravitoo order. Works in mock mode."""
    order = await db.orders.find_one({"_id": safe_objectid(data.order_id, "Order"), "user_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Order already paid")

    amount_paise = int(order["total_amount"] * 100)

    if RAZORPAY_MOCK_MODE:
        # Mock: generate a fake razorpay_order_id
        razorpay_order_id = f"order_mock_{secrets.token_hex(8)}"
        await db.payment_transactions.insert_one({
            "order_id": data.order_id,
            "user_id": user["id"],
            "provider": "razorpay",
            "razorpay_order_id": razorpay_order_id,
            "amount": amount_paise,
            "currency": "INR",
            "payment_status": "created",
            "mock_mode": True,
            "created_at": datetime.now(timezone.utc)
        })
        return {
            "razorpay_order_id": razorpay_order_id,
            "amount": amount_paise,
            "currency": "INR",
            "key_id": os.environ['RAZORPAY_KEY_ID'],
            "mock_mode": True,
            "cravitoo_order_id": data.order_id
        }
    else:
        client_rzp = get_razorpay_client()
        razor_order = client_rzp.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1,
            "receipt": data.order_id[:40]
        })
        await db.payment_transactions.insert_one({
            "order_id": data.order_id,
            "user_id": user["id"],
            "provider": "razorpay",
            "razorpay_order_id": razor_order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "payment_status": "created",
            "mock_mode": False,
            "created_at": datetime.now(timezone.utc)
        })
        return {
            "razorpay_order_id": razor_order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "key_id": os.environ['RAZORPAY_KEY_ID'],
            "mock_mode": False,
            "cravitoo_order_id": data.order_id
        }

@api_router.post("/payments/razorpay/verify")
async def razorpay_verify(data: RazorpayVerify, user: dict = Depends(get_current_user)):
    """Verify Razorpay payment signature and mark order as paid."""
    order = await db.orders.find_one({"_id": safe_objectid(data.order_id, "Order"), "user_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if RAZORPAY_MOCK_MODE:
        # Mock: skip signature verification, accept any payment_id
        pass
    else:
        # Verify HMAC signature
        body = f"{data.razorpay_order_id}|{data.razorpay_payment_id}"
        expected_signature = hmac.new(
            os.environ['RAZORPAY_KEY_SECRET'].encode(),
            body.encode(),
            hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected_signature, data.razorpay_signature):
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    # Mark order as paid
    await db.payment_transactions.update_one(
        {"razorpay_order_id": data.razorpay_order_id},
        {"$set": {
            "payment_status": "paid",
            "razorpay_payment_id": data.razorpay_payment_id,
            "razorpay_signature": data.razorpay_signature,
            "paid_at": datetime.now(timezone.utc)
        }}
    )
    await db.orders.update_one(
        {"_id": safe_objectid(data.order_id, "Order")},
        {"$set": {"payment_status": "paid", "status": "confirmed"}}
    )

    # Notify vendor (push + websocket)
    vendor_users = await db.users.find({"vendor_id": order["vendor_id"], "role": "vendor"}).to_list(10)
    for vu in vendor_users:
        await create_notification(
            str(vu["_id"]),
            "Order Paid & Confirmed",
            f"Order #{data.order_id[-8:]} has been paid. Total ₹{order['total_amount']:.2f}",
            "order"
        )

    # Broadcast via WebSocket
    await manager.send_to_user(user["id"], {
        "type": "order_update",
        "order_id": data.order_id,
        "status": "confirmed",
        "payment_status": "paid"
    })
    await manager.send_to_vendor(order["vendor_id"], {
        "type": "new_order",
        "order_id": data.order_id,
        "status": "confirmed",
        "amount": order["total_amount"]
    })

    return {"verified": True, "payment_status": "paid", "order_status": "confirmed"}

# ============== ORDER CANCELLATION & REFUND ==============

CANCEL_WINDOW_SECONDS = int(os.environ.get('CANCEL_WINDOW_SECONDS', '300'))  # 5 min default

@api_router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str, user: dict = Depends(get_current_user)):
    """Customer cancels their own order — only within CANCEL_WINDOW_SECONDS and before vendor confirms."""
    order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if user["role"] != "employee" or order.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="You can only cancel your own orders")
    if order.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Order is already cancelled")
    if order.get("status") not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Cannot cancel order with status '{order.get('status')}' — vendor has already started preparing it")

    created_at = order.get("created_at")
    if isinstance(created_at, datetime):
        # MongoDB returns naive datetimes — assume UTC
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()
        if elapsed > CANCEL_WINDOW_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Cancellation window of {CANCEL_WINDOW_SECONDS // 60} minutes has passed",
            )

    # If paid → mark for refund (mock-mode auto-refund; real-mode would call Razorpay refund API)
    refund_status = None
    if order.get("payment_status") == "paid":
        if RAZORPAY_MOCK_MODE:
            refund_status = "refunded_mock"
        else:
            try:
                tx = await db.payment_transactions.find_one({"cravitoo_order_id": order_id})
                pay_id = tx and tx.get("razorpay_payment_id")
                if pay_id:
                    client_rp = get_razorpay_client()
                    client_rp.payment.refund(pay_id, {"amount": int(order["total_amount"] * 100)})
                    refund_status = "refunded"
                else:
                    refund_status = "refund_pending"
            except Exception as e:
                logger.error(f"Razorpay refund failed for order {order_id}: {e}")
                refund_status = "refund_failed"

    await db.orders.update_one(
        {"_id": safe_objectid(order_id, "Order")},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": datetime.now(timezone.utc),
            "cancelled_by": "customer",
            **({"refund_status": refund_status} if refund_status else {}),
        }}
    )

    # Notify vendor
    vendor_users = await db.users.find({"vendor_id": order["vendor_id"], "role": "vendor"}).to_list(10)
    for vu in vendor_users:
        await create_notification(
            str(vu["_id"]),
            "Order Cancelled",
            f"Customer cancelled order #{order_id[-8:]}",
            "order"
        )
    await manager.send_to_vendor(order["vendor_id"], {
        "type": "order_update",
        "order_id": order_id,
        "status": "cancelled",
    })
    await manager.send_to_user(user["id"], {
        "type": "order_update",
        "order_id": order_id,
        "status": "cancelled",
    })

    return {"message": "Order cancelled", "refund_status": refund_status}

@api_router.post("/orders/{order_id}/refund")
async def refund_order(order_id: str, user: dict = Depends(get_current_user)):
    """Vendor or master_admin issues a refund (e.g. customer no-show, food unavailable)."""
    if user["role"] not in ("vendor", "master_admin"):
        raise HTTPException(status_code=403, detail="Only vendors or master admin can issue refunds")
    order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if user["role"] == "vendor" and order.get("vendor_id") != user.get("vendor_id"):
        raise HTTPException(status_code=403, detail="Not your order")
    if order.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Order is not paid — nothing to refund")
    if order.get("refund_status") in ("refunded", "refunded_mock"):
        raise HTTPException(status_code=400, detail="Order already refunded")

    refund_status = "refunded_mock"
    if not RAZORPAY_MOCK_MODE:
        try:
            tx = await db.payment_transactions.find_one({"cravitoo_order_id": order_id})
            pay_id = tx and tx.get("razorpay_payment_id")
            if pay_id:
                client_rp = get_razorpay_client()
                client_rp.payment.refund(pay_id, {"amount": int(order["total_amount"] * 100)})
                refund_status = "refunded"
            else:
                refund_status = "refund_pending"
        except Exception as e:
            logger.error(f"Razorpay refund failed for order {order_id}: {e}")
            raise HTTPException(status_code=500, detail="Refund failed at gateway")

    await db.orders.update_one(
        {"_id": safe_objectid(order_id, "Order")},
        {"$set": {
            "status": "cancelled",
            "refund_status": refund_status,
            "refunded_at": datetime.now(timezone.utc),
            "cancelled_by": user["role"],
        }}
    )

    await create_notification(
        order["user_id"],
        "Order Refunded",
        f"Your order #{order_id[-8:]} has been refunded (₹{order['total_amount']:.2f})",
        "order"
    )
    await manager.send_to_user(order["user_id"], {
        "type": "order_update",
        "order_id": order_id,
        "status": "cancelled",
        "refund_status": refund_status,
    })

    return {"message": "Refund issued", "refund_status": refund_status, "amount": order["total_amount"]}

# ============== SITES & MULTI-LEVEL ADMIN ==============

def is_master_admin(user: dict) -> bool:
    return user.get("role") == "master_admin"

def is_master_or_super(user: dict) -> bool:
    return user.get("role") in ("master_admin", "super_admin")

def can_access_site(user: dict, site_id: str) -> bool:
    role = user.get("role")
    if role == "master_admin":
        return True
    if role == "super_admin":
        return site_id in (user.get("assigned_sites") or [])
    if role == "site_admin":
        return user.get("site_id") == site_id
    return False

# Sites CRUD (Master Admin)
@api_router.post("/sites")
async def create_site(data: SiteCreate, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can create sites")
    doc = {
        **data.model_dump(),
        "status": "active",
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.sites.insert_one(doc)
    site_id = str(result.inserted_id)
    # Default meal schedule
    await db.meal_schedules.insert_one({
        "site_id": site_id,
        "schedules": [
            {"meal_period": "breakfast", "start_time": "07:30", "end_time": "10:30", "enabled": True},
            {"meal_period": "lunch", "start_time": "12:00", "end_time": "15:00", "enabled": True},
            {"meal_period": "snacks", "start_time": "16:00", "end_time": "18:00", "enabled": True},
            {"meal_period": "dinner", "start_time": "19:00", "end_time": "22:00", "enabled": False},
        ],
        "updated_at": datetime.now(timezone.utc),
    })
    return {"id": site_id, **data.model_dump()}

@api_router.get("/sites")
async def list_sites(user: dict = Depends(get_current_user)):
    query = {}
    if user.get("role") == "super_admin":
        ids = [safe_objectid(s, "Site") for s in (user.get("assigned_sites") or [])]
        if not ids:
            return []
        query["_id"] = {"$in": ids}
    elif user.get("role") == "site_admin":
        sid = user.get("site_id")
        if not sid:
            return []
        query["_id"] = safe_objectid(sid, "Site")
    elif user.get("role") == "employee":
        sid = user.get("site_id")
        if not sid:
            return []
        query["_id"] = safe_objectid(sid, "Site")
    elif user.get("role") == "vendor":
        # Vendor sees sites they're mapped to
        mappings = await db.vendor_site_mappings.find({"vendor_id": user.get("vendor_id")}).to_list(500)
        site_ids = [safe_objectid(m["site_id"], "Site") for m in mappings]
        if not site_ids:
            return []
        query["_id"] = {"$in": site_ids}
    # master_admin sees all sites
    
    sites = await db.sites.find(query).sort("name", 1).to_list(1000)
    for s in sites:
        s["id"] = str(s.pop("_id"))
        if isinstance(s.get("created_at"), datetime):
            s["created_at"] = s["created_at"].isoformat()
    return sites

@api_router.get("/sites/{site_id}")
async def get_site(site_id: str, user: dict = Depends(get_current_user)):
    if not (is_master_admin(user) or can_access_site(user, site_id) or
            user.get("role") == "employee" and user.get("site_id") == site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site["id"] = str(site.pop("_id"))
    if isinstance(site.get("created_at"), datetime):
        site["created_at"] = site["created_at"].isoformat()
    return site

@api_router.patch("/sites/{site_id}")
async def update_site(site_id: str, updates: Dict[str, Any], user: dict = Depends(get_current_user)):
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    allowed = {"name", "address", "city", "contact_email", "contact_phone",
               "allow_pre_order", "allow_cash_carry", "allow_company_paid", "allow_employee_paid"}
    # `status` field can only be changed by master_admin
    if is_master_admin(user):
        allowed = allowed | {"status"}
    cleaned = {k: v for k, v in updates.items() if k in allowed}
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    await db.sites.update_one({"_id": safe_objectid(site_id, "Site")}, {"$set": cleaned})
    return {"message": "Site updated"}

# Vendor-Site Mapping (Master/Super Admin)
@api_router.post("/sites/{site_id}/vendors")
async def map_vendor_to_site(site_id: str, data: VendorSiteMappingCreate, user: dict = Depends(get_current_user)):
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.vendor_site_mappings.find_one({"vendor_id": data.vendor_id, "site_id": site_id})
    if existing:
        raise HTTPException(status_code=400, detail="Vendor already mapped to this site")
    await db.vendor_site_mappings.insert_one({
        "vendor_id": data.vendor_id,
        "site_id": site_id,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
    })
    return {"message": "Vendor mapped to site"}

@api_router.get("/sites/{site_id}/vendors")
async def list_site_vendors(site_id: str, user: dict = Depends(get_current_user)):
    # Allow employees of this site to list vendors too
    if not (can_access_site(user, site_id) or
            (user.get("role") == "employee" and user.get("site_id") == site_id)):
        raise HTTPException(status_code=403, detail="Access denied")
    mappings = await db.vendor_site_mappings.find({"site_id": site_id, "status": "active"}).to_list(500)
    vendor_ids = [safe_objectid(m["vendor_id"], "Vendor") for m in mappings]
    if not vendor_ids:
        return []
    vendors = await db.vendors.find({"_id": {"$in": vendor_ids}, "status": "active"}).to_list(500)
    for v in vendors:
        v["id"] = str(v.pop("_id"))
    return vendors

@api_router.delete("/sites/{site_id}/vendors/{vendor_id}")
async def unmap_vendor(site_id: str, vendor_id: str, user: dict = Depends(get_current_user)):
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    await db.vendor_site_mappings.delete_one({"vendor_id": vendor_id, "site_id": site_id})
    return {"message": "Vendor unmapped"}

# Meal Schedules per Site
@api_router.get("/sites/{site_id}/schedule")
async def get_site_schedule(site_id: str, user: dict = Depends(get_current_user)):
    if not (can_access_site(user, site_id) or
            (user.get("role") == "employee" and user.get("site_id") == site_id)):
        raise HTTPException(status_code=403, detail="Access denied")
    sched = await db.meal_schedules.find_one({"site_id": site_id})
    if not sched:
        return {"site_id": site_id, "schedules": []}
    return {
        "site_id": site_id,
        "schedules": sched.get("schedules", []),
    }

@api_router.put("/sites/{site_id}/schedule")
async def update_site_schedule(site_id: str, data: MealScheduleUpdate, user: dict = Depends(get_current_user)):
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    await db.meal_schedules.update_one(
        {"site_id": site_id},
        {"$set": {"schedules": [s.model_dump() for s in data.schedules], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"message": "Schedule updated"}

# Current meal period helper
def current_meal_period(schedules: list) -> Optional[str]:
    from datetime import time as dt_time
    now = datetime.now(timezone.utc).astimezone()
    current = now.strftime("%H:%M")
    for s in schedules:
        if s.get("enabled") and s.get("start_time") <= current <= s.get("end_time"):
            return s["meal_period"]
    return None

# Site Menu (Site Admin / Employee dynamic)
@api_router.get("/sites/{site_id}/menu")
async def get_site_menu(
    site_id: str,
    meal_period: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    # Allow employees of this site
    if not (can_access_site(user, site_id) or
            (user.get("role") == "employee" and user.get("site_id") == site_id) or
            user.get("role") == "vendor"):
        raise HTTPException(status_code=403, detail="Access denied")
    
    query = {"site_id": site_id}
    if meal_period:
        query["meal_periods"] = meal_period
    # Site admin / Master sees all; Employee sees only available
    if user.get("role") == "employee":
        query["is_available"] = True
    
    items = await db.menu_items.find(query).to_list(2000)
    for item in items:
        item["id"] = str(item.pop("_id"))
        if isinstance(item.get("created_at"), datetime):
            item["created_at"] = item["created_at"].isoformat()
    return items

@api_router.patch("/menu/{item_id}/site-control")
async def site_admin_menu_control(item_id: str, data: MenuItemSiteUpdate, user: dict = Depends(get_current_user)):
    """Site admin (or master/super) toggles availability, pricing, show_price, or meal_periods on a menu item."""
    item = await db.menu_items.find_one({"_id": safe_objectid(item_id, "Menu item")})
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    if not (is_master_admin(user) or can_access_site(user, item.get("site_id", ""))):
        raise HTTPException(status_code=403, detail="Access denied")
    cleaned = {k: v for k, v in data.model_dump().items() if v is not None}
    if not cleaned:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.menu_items.update_one({"_id": safe_objectid(item_id, "Menu item")}, {"$set": cleaned})
    return {"message": "Menu item updated"}

# Excel Menu Upload (Site Admin)
@api_router.post("/sites/{site_id}/menu/upload-excel")
async def upload_menu_excel(
    site_id: str,
    vendor_id: str = Query(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Upload an Excel (.xlsx) file with menu items.
    Expected columns: name, description, category, price, is_vegetarian, image_url (optional), meal_periods (comma-separated)
    """
    if not (is_master_admin(user) or can_access_site(user, site_id)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")
    
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = workbook.active
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {str(e)}")
    
    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="Excel must contain at least a header row and one data row")
    
    headers = [str(h).strip().lower() if h else "" for h in rows[0]]
    required = ["name", "description", "category", "price"]
    missing = [c for c in required if c not in headers]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing)}")
    
    name_idx = headers.index("name")
    desc_idx = headers.index("description")
    cat_idx = headers.index("category")
    price_idx = headers.index("price")
    veg_idx = headers.index("is_vegetarian") if "is_vegetarian" in headers else None
    img_idx = headers.index("image_url") if "image_url" in headers else None
    meal_idx = headers.index("meal_periods") if "meal_periods" in headers else None
    
    inserted = 0
    errors = []
    for i, row in enumerate(rows[1:], start=2):
        try:
            if not row[name_idx]:
                continue
            meal_periods = ["lunch"]
            if meal_idx is not None and row[meal_idx]:
                meal_periods = [m.strip().lower() for m in str(row[meal_idx]).split(",") if m.strip()]
            doc = {
                "vendor_id": vendor_id,
                "site_id": site_id,
                "name": str(row[name_idx]).strip(),
                "description": str(row[desc_idx] or "").strip(),
                "category": str(row[cat_idx] or "Main Course").strip(),
                "price": float(row[price_idx] or 0),
                "is_vegetarian": bool(row[veg_idx]) if veg_idx is not None else True,
                "is_available": True,
                "show_price": True,
                "meal_periods": meal_periods,
                "image_url": str(row[img_idx]).strip() if img_idx is not None and row[img_idx] else None,
                "created_at": datetime.now(timezone.utc),
            }
            await db.menu_items.insert_one(doc)
            inserted += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    
    return {"inserted": inserted, "errors": errors, "site_id": site_id, "vendor_id": vendor_id}

# Master Admin: Create Site Admin / Super Admin
@api_router.post("/admin/site-admins")
async def create_site_admin(data: SiteAdminCreate, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can create site admins")
    email_lower = data.email.lower()
    if await db.users.find_one({"email": email_lower}):
        raise HTTPException(status_code=400, detail="Email already registered")
    # Validate site exists
    site = await db.sites.find_one({"_id": safe_objectid(data.site_id, "Site")})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    result = await db.users.insert_one({
        "email": email_lower,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "site_admin",
        "site_id": data.site_id,
        "created_at": datetime.now(timezone.utc),
    })
    return {"id": str(result.inserted_id), "email": email_lower, "role": "site_admin", "site_id": data.site_id}

@api_router.post("/admin/super-admins")
async def create_super_admin(data: SuperAdminCreate, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can create super admins")
    email_lower = data.email.lower()
    if await db.users.find_one({"email": email_lower}):
        raise HTTPException(status_code=400, detail="Email already registered")
    # Validate assigned_sites exist
    if data.assigned_sites:
        site_oids = [safe_objectid(sid, "Site") for sid in data.assigned_sites]
        existing = await db.sites.count_documents({"_id": {"$in": site_oids}})
        if existing != len(data.assigned_sites):
            raise HTTPException(status_code=404, detail="One or more assigned_sites not found")
    result = await db.users.insert_one({
        "email": email_lower,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "super_admin",
        "assigned_sites": data.assigned_sites,
        "created_at": datetime.now(timezone.utc),
    })
    return {"id": str(result.inserted_id), "email": email_lower, "role": "super_admin", "assigned_sites": data.assigned_sites}

@api_router.post("/admin/master-admins")
async def create_master_admin(data: MasterAdminCreate, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can create master admins")
    email_lower = data.email.lower()
    if not email_lower.endswith("@cravitoo.com"):
        raise HTTPException(status_code=400, detail="Master admin email must be @cravitoo.com")
    if await db.users.find_one({"email": email_lower}):
        raise HTTPException(status_code=400, detail="Email already registered")
    result = await db.users.insert_one({
        "email": email_lower,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "master_admin",
        "created_at": datetime.now(timezone.utc),
    })
    return {"id": str(result.inserted_id), "email": email_lower, "role": "master_admin"}

@api_router.get("/admin/admins")
async def list_admins(user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can list admins")
    admins = await db.users.find(
        {"role": {"$in": ["master_admin", "super_admin", "site_admin"]}},
        {"_id": 1, "email": 1, "name": 1, "role": 1, "site_id": 1, "assigned_sites": 1, "created_at": 1}
    ).to_list(1000)
    for a in admins:
        a["id"] = str(a.pop("_id"))
        if isinstance(a.get("created_at"), datetime):
            a["created_at"] = a["created_at"].isoformat()
    return admins

@api_router.delete("/admin/admins/{admin_id}")
async def delete_admin(admin_id: str, user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Only master admin can delete admins")
    admin = await db.users.find_one({"_id": safe_objectid(admin_id, "Admin"), "role": {"$in": ["super_admin", "site_admin", "master_admin"]}})
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    if admin.get("email") == os.environ.get("ADMIN_EMAIL", "admin@cravitoo.com"):
        raise HTTPException(status_code=400, detail="Cannot delete the seed master admin")
    await db.users.delete_one({"_id": safe_objectid(admin_id, "Admin")})
    return {"message": "Admin deleted"}

# Reports
@api_router.get("/reports/master-dashboard")
async def master_dashboard(user: dict = Depends(get_current_user)):
    if not is_master_admin(user):
        raise HTTPException(status_code=403, detail="Master admin only")
    total_sites = await db.sites.count_documents({"status": "active"})
    total_vendors = await db.vendors.count_documents({"status": "active"})
    total_users = await db.users.count_documents({})
    total_employees = await db.users.count_documents({"role": "employee"})
    total_orders = await db.orders.count_documents({})
    paid_orders = await db.orders.count_documents({"payment_status": "paid"})
    
    rev_pipe = [
        {"$match": {"payment_status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]
    rev = await db.orders.aggregate(rev_pipe).to_list(1)
    total_revenue = rev[0]["total"] if rev else 0
    
    # Top sites
    site_pipe = [
        {"$match": {"payment_status": "paid", "site_id": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$site_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
        {"$sort": {"revenue": -1}},
        {"$limit": 5}
    ]
    top_sites_raw = await db.orders.aggregate(site_pipe).to_list(5)
    top_sites = []
    for ts in top_sites_raw:
        if not ts.get("_id") or not ObjectId.is_valid(ts["_id"]):
            continue
        site = await db.sites.find_one({"_id": ObjectId(ts["_id"])})
        if site:
            top_sites.append({
                "site_id": ts["_id"],
                "name": site.get("name", "Unknown"),
                "orders": ts["orders"],
                "revenue": ts["revenue"],
            })
    
    # Top vendors
    vendor_pipe = [
        {"$match": {"payment_status": "paid"}},
        {"$group": {"_id": "$vendor_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
        {"$sort": {"revenue": -1}},
        {"$limit": 5}
    ]
    top_vendors_raw = await db.orders.aggregate(vendor_pipe).to_list(5)
    top_vendors = []
    for tv in top_vendors_raw:
        if not tv.get("_id") or not ObjectId.is_valid(tv["_id"]):
            continue
        vendor = await db.vendors.find_one({"_id": ObjectId(tv["_id"])})
        if vendor:
            top_vendors.append({
                "vendor_id": tv["_id"],
                "name": vendor.get("name", "Unknown"),
                "orders": tv["orders"],
                "revenue": tv["revenue"],
            })
    
    return {
        "total_sites": total_sites,
        "total_vendors": total_vendors,
        "total_users": total_users,
        "total_employees": total_employees,
        "total_orders": total_orders,
        "paid_orders": paid_orders,
        "total_revenue": round(total_revenue, 2),
        "top_sites": top_sites,
        "top_vendors": top_vendors,
    }

@api_router.get("/reports/site/{site_id}")
async def site_report(site_id: str, user: dict = Depends(get_current_user)):
    if not can_access_site(user, site_id):
        raise HTTPException(status_code=403, detail="Access denied")
    total_orders = await db.orders.count_documents({"site_id": site_id})
    paid_orders = await db.orders.count_documents({"site_id": site_id, "payment_status": "paid"})
    rev_pipe = [
        {"$match": {"site_id": site_id, "payment_status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]
    rev = await db.orders.aggregate(rev_pipe).to_list(1)
    total_revenue = rev[0]["total"] if rev else 0
    
    # By vendor
    by_vendor_pipe = [
        {"$match": {"site_id": site_id, "payment_status": "paid"}},
        {"$group": {"_id": "$vendor_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
        {"$sort": {"revenue": -1}}
    ]
    by_vendor_raw = await db.orders.aggregate(by_vendor_pipe).to_list(100)
    by_vendor = []
    for bv in by_vendor_raw:
        vendor = await db.vendors.find_one({"_id": safe_objectid(bv["_id"], "Vendor")})
        if vendor:
            by_vendor.append({
                "vendor_id": bv["_id"],
                "name": vendor.get("name", "Unknown"),
                "orders": bv["orders"],
                "revenue": round(bv["revenue"], 2),
            })
    
    employees_at_site = await db.users.count_documents({"site_id": site_id, "role": "employee"})
    
    return {
        "site_id": site_id,
        "total_orders": total_orders,
        "paid_orders": paid_orders,
        "total_revenue": round(total_revenue, 2),
        "employees": employees_at_site,
        "vendors": by_vendor,
    }

# Add site_id to order creation
@api_router.get("/employee/my-site")
async def get_my_site(user: dict = Depends(get_current_user)):
    """Helper for employee app: returns the employee's site + vendors + meal schedule + ordering options."""
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    site_id = user.get("site_id")
    if not site_id:
        raise HTTPException(status_code=404, detail="No site assigned to your account")
    site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site["id"] = str(site.pop("_id"))
    if isinstance(site.get("created_at"), datetime):
        site["created_at"] = site["created_at"].isoformat()
    schedule = await db.meal_schedules.find_one({"site_id": site_id})
    schedules = schedule.get("schedules", []) if schedule else []
    current_period = current_meal_period(schedules)
    
    mappings = await db.vendor_site_mappings.find({"site_id": site_id, "status": "active"}).to_list(500)
    vendor_ids = [safe_objectid(m["vendor_id"], "Vendor") for m in mappings]
    vendors = []
    if vendor_ids:
        vlist = await db.vendors.find({"_id": {"$in": vendor_ids}, "status": "active"}).to_list(500)
        for v in vlist:
            v["id"] = str(v.pop("_id"))
            vendors.append(v)
    
    return {
        "site": site,
        "vendors": vendors,
        "meal_schedule": schedules,
        "current_meal_period": current_period,
        "ordering_modes": {
            "pre_order": site.get("allow_pre_order", True),
            "cash_carry": site.get("allow_cash_carry", True),
            "company_paid": site.get("allow_company_paid", False),
            "employee_paid": site.get("allow_employee_paid", True),
        },
    }

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

app.include_router(api_router)

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