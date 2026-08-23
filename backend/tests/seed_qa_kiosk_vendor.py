"""Seed / cleanup the throw-away QA Kiosk vendor for frontend kiosk testing.

Usage:
  python seed_qa_kiosk_vendor.py seed
  python seed_qa_kiosk_vendor.py cleanup
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

VENDOR_EMAIL = "qa_kiosk_vendor@example.com"
VENDOR_PASSWORD = "KioskQA123!"
VENDOR_NAME = "QA Kiosk Vendor"


def seed():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    existing_v = db.vendors.find_one({"name": VENDOR_NAME})
    if existing_v:
        vendor_id = existing_v["_id"]
    else:
        vendor_id = db.vendors.insert_one({
            "name": VENDOR_NAME,
            "description": "Throw-away QA vendor for kiosk UI tests",
            "cuisine": "Test",
            "created_at": datetime.now(timezone.utc),
            "is_active": True,
        }).inserted_id

    hashed = bcrypt.hashpw(VENDOR_PASSWORD.encode(), bcrypt.gensalt()).decode()
    db.users.update_one(
        {"email": VENDOR_EMAIL},
        {"$set": {
            "email": VENDOR_EMAIL,
            "password_hash": hashed,
            "name": VENDOR_NAME,
            "role": "vendor",
            "vendor_id": str(vendor_id),
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    print(f"SEEDED vendor_id={vendor_id} email={VENDOR_EMAIL}")


def cleanup():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.users.delete_many({"email": VENDOR_EMAIL})
    db.vendors.delete_many({"name": VENDOR_NAME})
    print("CLEANED")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "seed"
    if action == "seed":
        seed()
    elif action == "cleanup":
        cleanup()
    else:
        print("usage: seed_qa_kiosk_vendor.py seed|cleanup")
        sys.exit(1)
