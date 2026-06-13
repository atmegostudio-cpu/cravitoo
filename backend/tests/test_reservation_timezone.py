"""Regression tests for the IST timezone bug in reservations.

Bug: At Indian afternoon/evening (when UTC is still the previous calendar day
relative to IST midnight), the reservation system was computing the wrong
"tomorrow" and the wrong cutoff_at, causing all meal slots to show
"Cutoff passed" during business hours.

These tests freeze the clock at known IST times and verify the helpers
return the right IST dates and the right UTC cutoff moments.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import pytest

sys.path.insert(0, "/app/backend")

from routers.reservations import (
    IST,
    _cutoff_for_delivery_date,
    _ist_date_of,
    _parse_delivery_date,
)


# ---- helpers ----

def _freeze_ist(year, month, day, hour, minute):
    """Return a context that pins _now_ist() to the given IST clock time."""
    fake_ist = datetime(year, month, day, hour, minute, 0, tzinfo=IST)
    return patch("routers.reservations._now_ist", return_value=fake_ist), fake_ist


# ---- tests ----

class TestReservationTimezone:
    """The bug only manifested in the IST midnight–8 PM window. Cover all edges."""

    def test_midnight_ist_tomorrow_is_next_day(self):
        """At 00:30 IST on June 5, tomorrow should be June 6 (not 5)."""
        ctx, _ = _freeze_ist(2026, 6, 5, 0, 30)
        with ctx:
            delivery = _parse_delivery_date(None)
            assert _ist_date_of(delivery).isoformat() == "2026-06-06"

    def test_afternoon_ist_tomorrow_is_next_day(self):
        """3:33 PM IST on June 5 (the exact failing screenshot scenario)."""
        ctx, fake_ist = _freeze_ist(2026, 6, 5, 15, 33)
        with ctx:
            delivery = _parse_delivery_date(None)
            assert _ist_date_of(delivery).isoformat() == "2026-06-06"
            cutoff = _cutoff_for_delivery_date(delivery, {"cutoff_hour": 20})
            now_utc = fake_ist.astimezone(timezone.utc)
            assert now_utc < cutoff, "At 3:33 PM IST, 8 PM cutoff must NOT have passed"

    def test_one_minute_before_cutoff(self):
        """7:59 PM IST → cutoff (8 PM IST) NOT passed."""
        ctx, fake_ist = _freeze_ist(2026, 6, 5, 19, 59)
        with ctx:
            delivery = _parse_delivery_date(None)
            cutoff = _cutoff_for_delivery_date(delivery, {"cutoff_hour": 20})
            assert fake_ist.astimezone(timezone.utc) < cutoff

    def test_one_minute_after_cutoff(self):
        """8:01 PM IST → cutoff (8 PM IST) HAS passed."""
        ctx, fake_ist = _freeze_ist(2026, 6, 5, 20, 1)
        with ctx:
            delivery = _parse_delivery_date(None)
            cutoff = _cutoff_for_delivery_date(delivery, {"cutoff_hour": 20})
            assert fake_ist.astimezone(timezone.utc) >= cutoff

    def test_explicit_date_string_parses_as_ist_midnight(self):
        """Caller passes '2026-06-10' → that's midnight IST on June 10."""
        delivery = _parse_delivery_date("2026-06-10")
        assert _ist_date_of(delivery).isoformat() == "2026-06-10"
        # The UTC representation should be the IST midnight, i.e. June 9 18:30 UTC
        assert delivery == datetime(2026, 6, 9, 18, 30, 0, tzinfo=timezone.utc)

    def test_cutoff_uses_day_BEFORE_delivery(self):
        """Cutoff for June 10 delivery must be on June 9 at the configured hour IST."""
        delivery = _parse_delivery_date("2026-06-10")
        cutoff = _cutoff_for_delivery_date(delivery, {"cutoff_hour": 20, "cutoff_minute": 0})
        # 20:00 IST on June 9 = 14:30 UTC on June 9
        assert cutoff == datetime(2026, 6, 9, 14, 30, 0, tzinfo=timezone.utc)

    def test_cutoff_respects_custom_hour(self):
        """Site admin can set cutoff to 15:00 IST. Verify it lands correctly."""
        delivery = _parse_delivery_date("2026-06-10")
        cutoff = _cutoff_for_delivery_date(delivery, {"cutoff_hour": 15, "cutoff_minute": 30})
        # 15:30 IST on June 9 = 10:00 UTC on June 9
        assert cutoff == datetime(2026, 6, 9, 10, 0, 0, tzinfo=timezone.utc)

    def test_bad_date_format_raises(self):
        """Invalid date string → HTTP 400 via HTTPException."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _parse_delivery_date("not-a-date")
        assert exc.value.status_code == 400

    @pytest.mark.parametrize("h,m", [(0, 0), (5, 30), (12, 0), (18, 30), (23, 59)])
    def test_tomorrow_is_always_today_plus_one_ist(self, h, m):
        """Across all hours of the IST day, 'tomorrow' must be IST today + 1 day."""
        ctx, fake_ist = _freeze_ist(2026, 6, 5, h, m)
        with ctx:
            delivery = _parse_delivery_date(None)
            assert _ist_date_of(delivery) == fake_ist.date() + timedelta(days=1), \
                f"At {h:02d}:{m:02d} IST, tomorrow should be {fake_ist.date() + timedelta(days=1)}"
