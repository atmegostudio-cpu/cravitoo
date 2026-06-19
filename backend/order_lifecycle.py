"""Order lifecycle state machine.

Single source of truth for valid order-status transitions. The PATCH
`/api/orders/{order_id}` endpoint and any vendor/admin-triggered status
changes must call `assert_transition_allowed` before persisting.

Terminal states: completed, cancelled, expired, no_show, rejected.

Transition graph:

    pending     ──► confirmed
                ──► cancelled
                ──► rejected
                ──► expired      (auto, via background sweep — see expire_stale_orders)

    confirmed   ──► preparing
                ──► cancelled
                ──► rejected

    preparing   ──► ready
                ──► cancelled

    ready       ──► completed
                ──► no_show

    completed   ──► (terminal)
    cancelled   ──► (terminal)
    expired     ──► (terminal)
    no_show     ──► (terminal)
    rejected    ──► (terminal)

Time bounds:
- ORDER_EXPIRY_HOURS  : pending orders older than this auto-transition to `expired`.
- ORDER_STALE_HOURS   : orders in any non-terminal state older than this become
                        read-only (their status cannot be mutated further).

Concurrency: state changes use a conditional update on `{ _id, status: <from> }`
so two simultaneous transitions cannot both succeed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import HTTPException


TERMINAL_STATES = frozenset({"completed", "cancelled", "expired", "no_show", "rejected"})

# Vendor-controlled forward transitions
VENDOR_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending":   frozenset({"confirmed", "rejected"}),
    "confirmed": frozenset({"preparing", "rejected"}),
    "preparing": frozenset({"ready"}),
    "ready":     frozenset({"completed", "no_show"}),
}

# Customer-controlled transitions (employee cancellations)
CUSTOMER_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending":   frozenset({"cancelled"}),
    "confirmed": frozenset({"cancelled"}),
}

# Master / Corporate Admin overrides (full set of forward + cancellation)
ADMIN_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending":   frozenset({"confirmed", "cancelled", "rejected", "expired"}),
    "confirmed": frozenset({"preparing", "cancelled", "rejected"}),
    "preparing": frozenset({"ready", "cancelled"}),
    "ready":     frozenset({"completed", "no_show"}),
}

# System-triggered transitions (cron / background sweep)
SYSTEM_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending":   frozenset({"expired"}),
    "ready":     frozenset({"no_show"}),
}


# Time bounds (override via env if needed)
ORDER_EXPIRY_HOURS = 24    # pending orders auto-expire after this many hours
ORDER_STALE_HOURS = 48     # any non-terminal order this old becomes immutable


def _allowed_for_actor(actor_role: str, current_status: str) -> frozenset[str]:
    """Return the set of statuses the actor is allowed to move *to*."""
    if actor_role == "vendor":
        return VENDOR_TRANSITIONS.get(current_status, frozenset())
    if actor_role == "employee":
        return CUSTOMER_TRANSITIONS.get(current_status, frozenset())
    if actor_role in ("master_admin", "super_admin", "corporate_admin", "site_admin", "city_admin"):
        return ADMIN_TRANSITIONS.get(current_status, frozenset())
    if actor_role == "system":
        return SYSTEM_TRANSITIONS.get(current_status, frozenset())
    return frozenset()


def assert_transition_allowed(
    order: dict,
    target_status: str,
    actor_role: str,
    now: Optional[datetime] = None,
) -> None:
    """Raise HTTPException unless `order.status -> target_status` is permitted
    for `actor_role` and the order isn't already stale/terminal.

    Pure function — does NOT touch the DB.  Callers use it just before doing the
    conditional update.
    """
    current = (order.get("status") or "").strip().lower()
    target = (target_status or "").strip().lower()

    if not target:
        raise HTTPException(status_code=400, detail="Status is required")

    if current == target:
        # Idempotent no-op — but still report so callers don't double-fire
        # notifications / webhooks.
        raise HTTPException(
            status_code=409,
            detail=f"Order is already in '{current}'. No change applied.",
        )

    if current in TERMINAL_STATES:
        raise HTTPException(
            status_code=409,
            detail=f"Order is already in terminal state '{current}' and cannot be changed.",
        )

    now = now or datetime.now(timezone.utc)
    created_at = order.get("created_at")
    if isinstance(created_at, datetime):
        # Be tolerant of naive datetimes from older records.
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age = now - created_at
        if age > timedelta(hours=ORDER_STALE_HOURS) and target not in TERMINAL_STATES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Order is older than {ORDER_STALE_HOURS}h and is now read-only. "
                    "Use a refund or no-show flow instead."
                ),
            )

    allowed = _allowed_for_actor(actor_role, current)
    if target not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid transition '{current}' → '{target}' for role '{actor_role}'. "
                f"Allowed: {sorted(allowed) or 'none'}."
            ),
        )


async def apply_transition(
    db,
    order_id_objid,
    from_status: str,
    to_status: str,
    actor: dict,
) -> bool:
    """Atomically move the order from `from_status` → `to_status`.

    Uses a conditional update so two simultaneous calls don't both succeed.
    Writes an entry into `order_status_history`.

    Returns True if the update happened, False if another writer beat us.
    """
    now = datetime.now(timezone.utc)
    res = await db.orders.update_one(
        {"_id": order_id_objid, "status": from_status},
        {
            "$set": {
                "status": to_status,
                "status_updated_at": now,
            }
        },
    )
    if res.modified_count != 1:
        return False

    await db.order_status_history.insert_one({
        "order_id": str(order_id_objid),
        "from_status": from_status,
        "to_status": to_status,
        "actor_id": actor.get("id"),
        "actor_email": actor.get("email"),
        "actor_role": actor.get("role"),
        "created_at": now,
    })
    return True


async def expire_stale_orders(db) -> int:
    """Background sweep — auto-expire pending orders older than ORDER_EXPIRY_HOURS.

    Returns the count of orders expired.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=ORDER_EXPIRY_HOURS)
    stale = db.orders.find({
        "status": "pending",
        "created_at": {"$lt": cutoff},
    }, {"_id": 1, "user_id": 1, "vendor_id": 1, "created_at": 1})

    n = 0
    async for row in stale:
        ok = await apply_transition(
            db,
            row["_id"],
            "pending",
            "expired",
            {"id": "system", "email": "system@cravitoo.local", "role": "system"},
        )
        if ok:
            n += 1
    return n
