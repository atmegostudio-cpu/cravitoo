from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from bson import ObjectId
import os
import logging
import bcrypt
import jwt
import secrets
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
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
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

class CheckoutRequest(BaseModel):
    order_id: str
    origin_url: str

# Startup Events
@app.on_event("startup")
async def startup_event():
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.companies.create_index("name")
    await db.vendors.create_index("name")
    await db.menu_items.create_index("vendor_id")
    await db.orders.create_index("user_id")
    await db.orders.create_index("vendor_id")
    
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
            "name": "Super Admin",
            "role": "super_admin",
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Super admin created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info(f"Super admin password updated")

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
    
    test_creds_content = f"""# Cravitoo Test Credentials

## Super Admin
- Email: {os.environ.get('ADMIN_EMAIL', 'admin@cravitoo.com')}
- Password: {os.environ.get('ADMIN_PASSWORD', 'admin123')}
- Role: super_admin

## Corporate Admin
- Email: demo@techcorp.com
- Password: demo123
- Role: corporate_admin
- Company: Tech Corp

## Vendor Manager
- Email: vendor@spicekitchen.com
- Password: vendor123
- Role: vendor
- Vendor: Spice Kitchen

## Employee
- Email: employee@techcorp.com
- Password: employee123
- Role: employee
- Company: Tech Corp

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
async def register(data: RegisterRequest, response: Response):
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
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
    return {"id": user_id, "email": email_lower, "name": data.name, "role": data.role}

@api_router.post("/auth/login")
async def login(data: LoginRequest, response: Response):
    email_lower = data.email.lower()
    user = await db.users.find_one({"email": email_lower})
    
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email_lower, user["role"])
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
    return {
        "id": user_id,
        "email": email_lower,
        "name": user["name"],
        "role": user["role"],
        "company_id": user.get("company_id"),
        "vendor_id": user.get("vendor_id")
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
    vendor = await db.vendors.find_one({"_id": ObjectId(vendor_id)})
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
    
    await db.menu_items.update_one({"_id": ObjectId(item_id), "vendor_id": user.get("vendor_id")}, {"$set": data})
    return {"message": "Menu item updated"}

# Order Routes
@api_router.post("/orders")
async def create_order(data: OrderCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail="Only employees can create orders")
    
    total_amount = sum(item.price * item.quantity for item in data.items)
    
    order_doc = {
        "user_id": user["id"],
        "vendor_id": data.vendor_id,
        "items": [item.model_dump() for item in data.items],
        "total_amount": total_amount,
        "status": "pending",
        "payment_status": "pending",
        "delivery_type": data.delivery_type,
        "special_instructions": data.special_instructions,
        "created_at": datetime.now(timezone.utc)
    }
    
    result = await db.orders.insert_one(order_doc)
    order_id = str(result.inserted_id)
    
    return {"id": order_id, "total_amount": total_amount, "status": "pending"}

@api_router.get("/orders")
async def get_orders(user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] == "employee":
        query["user_id"] = user["id"]
    elif user["role"] == "vendor":
        query["vendor_id"] = user.get("vendor_id")
    
    orders = await db.orders.find(query, {"_id": 1, "user_id": 1, "vendor_id": 1, "items": 1, "total_amount": 1, "status": 1, "payment_status": 1, "delivery_type": 1, "created_at": 1}).sort("created_at", -1).to_list(1000)
    for order in orders:
        order["id"] = str(order.pop("_id"))
    return orders

@api_router.patch("/orders/{order_id}")
async def update_order_status(order_id: str, status: str, user: dict = Depends(get_current_user)):
    if user["role"] != "vendor":
        raise HTTPException(status_code=403, detail="Only vendors can update order status")
    
    await db.orders.update_one({"_id": ObjectId(order_id), "vendor_id": user.get("vendor_id")}, {"$set": {"status": status}})
    return {"message": "Order status updated"}

# Payment Routes
@api_router.post("/payments/checkout")
async def create_checkout_session(data: CheckoutRequest, request: Request, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"_id": ObjectId(data.order_id)})
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
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url="")
    status = await stripe_checkout.get_checkout_status(session_id)
    
    transaction = await db.payment_transactions.find_one({"session_id": session_id})
    if transaction and transaction["payment_status"] != "paid" and status.payment_status == "paid":
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