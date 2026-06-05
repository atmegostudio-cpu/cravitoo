"""
Pydantic models for the Cravitoo backend.

Extracted from server.py during the iteration 12 refactor (Feb 2026).
All models are pure data shapes — they do not import from server.py to avoid circular imports.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field, ConfigDict, EmailStr


# ============== AUTH ==============

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


# ============== COMPANY ==============

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


# ============== VENDOR ==============

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


# ============== MENU ==============

class MenuItemCreate(BaseModel):
    name: str
    description: str
    category: str
    price: float
    image_url: Optional[str] = None
    is_vegetarian: bool = False
    is_available: bool = True
    vendor_id: Optional[str] = None  # master_admin must supply; vendors cannot create menu items


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


class MenuItemSiteUpdate(BaseModel):
    is_available: Optional[bool] = None
    price: Optional[float] = None
    show_price: Optional[bool] = None
    meal_periods: Optional[List[str]] = None


# ============== ORDERS ==============

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


class OrderStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    preparing = "preparing"
    ready = "ready"
    completed = "completed"
    cancelled = "cancelled"


class CheckoutRequest(BaseModel):
    order_id: str
    origin_url: str


# ============== AI ==============

class AIRecommendationRequest(BaseModel):
    user_preferences: Optional[str] = None
    dietary_restrictions: Optional[str] = None


# ============== SITES (Multi-tenant) ==============

class SiteCreate(BaseModel):
    name: str
    company_id: Optional[str] = None
    city_id: Optional[str] = None  # Link to City entity (new)
    address: str
    city: str  # Free-text city name (legacy)
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
    end_time: str  # "10:30"
    enabled: bool = True


class MealScheduleUpdate(BaseModel):
    schedules: List[MealScheduleEntry]


# ============== CITY & VENDOR ONBOARDING ==============

class CityCreate(BaseModel):
    name: str  # e.g. "Bangalore", "Mumbai"
    state: str  # e.g. "Karnataka"
    country: str = "India"


class CityAdminCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    city_id: str


class VendorOnboardingBasic(BaseModel):
    vendor_name: str
    company_name: str
    contact_person: str
    mobile_number: str
    email: EmailStr
    business_address: str
    cuisine_type: Optional[str] = "Multi-cuisine"
    site_id: str


class VendorOnboardingUpdate(BaseModel):
    vendor_name: Optional[str] = None
    company_name: Optional[str] = None
    contact_person: Optional[str] = None
    mobile_number: Optional[str] = None
    business_address: Optional[str] = None
    cuisine_type: Optional[str] = None


class ChecklistUpdate(BaseModel):
    gst_verified: Optional[bool] = None
    pan_verified: Optional[bool] = None
    fssai_verified: Optional[bool] = None
    bank_verified: Optional[bool] = None
    menu_uploaded: Optional[bool] = None
    pricing_verified: Optional[bool] = None
    documents_uploaded: Optional[bool] = None
    site_visit_completed: Optional[bool] = None
    commercial_terms_accepted: Optional[bool] = None
    agreement_signed: Optional[bool] = None
    notes: Optional[str] = None


class OnboardingDecision(BaseModel):
    decision: str  # "approve" | "reject" | "request_changes"
    remarks: Optional[str] = None


CHECKLIST_FIELDS = [
    "gst_verified", "pan_verified", "fssai_verified", "bank_verified",
    "menu_uploaded", "pricing_verified", "documents_uploaded",
    "site_visit_completed", "commercial_terms_accepted", "agreement_signed",
]

DOC_TYPES = [
    "gst_certificate", "pan_card", "fssai_license", "shop_establishment",
    "bank_details", "cancelled_cheque", "msme_certificate", "insurance",
]

ONBOARDING_STATUSES = [
    "draft", "documents_pending", "under_site_review",
    "changes_requested", "under_master_review", "approved",
    "rejected", "active",
]


# ============== ADMINS ==============

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


# ============== REVIEWS / PREFERENCES / SUBSCRIPTIONS ==============

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


# ============== EMPLOYEES / BULK / EVENTS ==============

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


# ============== NOTIFICATIONS / LOYALTY ==============

class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    type: str = "info"


class LoyaltyRedeemRequest(BaseModel):
    points: int
    order_id: str


# ============== PAYMENTS (Razorpay) ==============

class RazorpayOrderCreate(BaseModel):
    order_id: str  # internal Cravitoo order ID


class RazorpayVerify(BaseModel):
    order_id: Optional[str] = None  # Cravitoo order ID — optional; if omitted, looked up via razorpay_order_id
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str


# ============== PUSH NOTIFICATIONS ==============

class PushTokenRegister(BaseModel):
    token: str
    platform: Optional[str] = None  # 'ios' | 'android'
    variant: Optional[str] = None  # 'customer' | 'vendor'
