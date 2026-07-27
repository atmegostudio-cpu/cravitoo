"""Regression test for the "Master admin password resets to admin123" bug.

Reproduces the exact scenario the client reported:
1. Master admin logs in with the seeded password.
2. Changes password via /auth/change-password.
3. Backend restarts (seed_admin runs again).
4. New password MUST still work; old (.env) password MUST NOT work.

Before the fix (server.py::seed_admin), step 4 failed because seed_admin
was overwriting password_hash whenever the stored hash did not match the
.env ADMIN_PASSWORD.
"""
import os
import sys
import pytest
import pytest_asyncio
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

# Make the backend package importable regardless of pytest's CWD.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from server import seed_admin, hash_password, verify_password  # noqa: E402


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    """Point server.db at a throwaway Mongo database for this test."""
    import server
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    dbname = f"cravitoo_test_seedadmin_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    original_db = server.db
    server.db = client[dbname]
    try:
        yield server.db
    finally:
        await client.drop_database(dbname)
        server.db = original_db
        client.close()


@pytest.mark.asyncio
async def test_seed_admin_preserves_changed_password(isolated_db, monkeypatch):
    admin_email = "admin@cravitoo.test"
    bootstrap_pw = "admin123"
    new_pw = "MyNewPassword!42"

    monkeypatch.setenv("ADMIN_EMAIL", admin_email)
    monkeypatch.setenv("ADMIN_PASSWORD", bootstrap_pw)

    # 1st boot — creates the admin with the bootstrap password.
    await seed_admin()
    row = await isolated_db.users.find_one({"email": admin_email})
    assert row is not None
    assert verify_password(bootstrap_pw, row["password_hash"])

    # User changes their password via change-password endpoint (simulated).
    await isolated_db.users.update_one(
        {"email": admin_email},
        {"$set": {"password_hash": hash_password(new_pw)}},
    )

    # 2nd boot (simulated) — seed_admin runs again but must NOT touch pw.
    await seed_admin()

    row = await isolated_db.users.find_one({"email": admin_email})
    assert verify_password(new_pw, row["password_hash"]), \
        "REGRESSION: seed_admin overwrote the changed password back to bootstrap value"
    assert not verify_password(bootstrap_pw, row["password_hash"]), \
        "REGRESSION: bootstrap password is unexpectedly still valid"


@pytest.mark.asyncio
async def test_seed_admin_restores_role_but_leaves_password(isolated_db, monkeypatch):
    """If an existing admin row somehow has the wrong role, seed_admin
    should fix the role WITHOUT resetting the password."""
    admin_email = "admin@cravitoo.test"
    new_pw = "AnotherPw!7"
    monkeypatch.setenv("ADMIN_EMAIL", admin_email)
    monkeypatch.setenv("ADMIN_PASSWORD", "admin123")

    await isolated_db.users.insert_one({
        "email": admin_email,
        "password_hash": hash_password(new_pw),
        "name": "Was Employee",
        "role": "employee",  # wrong role
        "created_at": datetime.now(timezone.utc),
    })

    await seed_admin()

    row = await isolated_db.users.find_one({"email": admin_email})
    assert row["role"] == "master_admin"
    assert row["name"] == "Master Admin"
    assert verify_password(new_pw, row["password_hash"]), \
        "seed_admin must not overwrite an existing admin's password"
