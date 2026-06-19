"""Environment helpers — fail-secure runtime configuration.

The Cravitoo backend uses an explicit `CRAVITOO_ENV` variable to gate
non-production functionality (demo seeding, demo APIs, dev-only endpoints).

Design contract:
- `production` is the SAFE DEFAULT.  Any missing / invalid / unknown value MUST
  be treated as `production` so that demo features are *disabled* on misconfig.
- Only the explicit allow-list ("development", "preview", "staging") enables
  non-production features.
"""

from __future__ import annotations

import os

# Single source of truth — every callsite imports from here.
_PRODUCTION = "production"
_NON_PRODUCTION_VALUES = frozenset({"development", "preview", "staging"})


def get_env() -> str:
    """Return a normalized environment label.

    Unknown / missing values return "production" (fail-secure).
    """
    raw = (os.environ.get("CRAVITOO_ENV") or "").strip().lower()
    if raw in _NON_PRODUCTION_VALUES:
        return raw
    return _PRODUCTION


def is_production() -> bool:
    return get_env() == _PRODUCTION


def is_non_production() -> bool:
    """True only when CRAVITOO_ENV is one of the explicit non-prod values."""
    return get_env() in _NON_PRODUCTION_VALUES
