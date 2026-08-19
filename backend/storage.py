"""Persistent object storage helper (Emergent Object Storage).

Replaces the ephemeral `/tmp/cravitoo_uploads` filesystem with a
durable, cross-pod store so uploaded vendor documents, menu images
and other user files survive redeploys / pod restarts.

Contract:
    - `init_storage()` — call once at FastAPI startup (or lazily on first use).
    - `put_object(path, data, content_type)` — write. Returns dict with `path`,
      `size`, `etag`.
    - `get_object(path)` — read. Returns `(bytes, content_type)`.
    - `path_to_url(path)` — build the frontend-facing `/api/uploads/{filename}`
      URL. The filename portion base64-encodes the storage path so the existing
      GET /api/uploads/{filename} endpoint can decode it back and stream from
      object storage.
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Tuple

import requests

logger = logging.getLogger(__name__)

# Emergent injects INTEGRATION_PROXY_URL only inside its pods; fall back to
# the public host for local dev.
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = "cravitoo"

_storage_key: str | None = None


def init_storage(force: bool = False) -> str:
    """One-time bootstrap. `force=True` re-mints the key if the cached one dies."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY missing — cannot init object storage")
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": EMERGENT_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _with_retry_on_404(fn):
    """Some errors mean the storage_key went inactive — force a re-init and retry once."""
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (403, 404):
                init_storage(force=True)
                return fn(*args, **kwargs)
            raise
    return wrapper


@_with_retry_on_404
def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type or "application/octet-stream"},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


@_with_retry_on_404
def get_object(path: str) -> Tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def path_to_filename(path: str) -> str:
    """Encode a storage path into a URL-safe token so it can round-trip through
    the /api/uploads/{filename} route without needing a wildcard route or
    percent-encoded slashes (which some clients / proxies eat).
    """
    return "s_" + base64.urlsafe_b64encode(path.encode()).decode().rstrip("=")


def filename_to_path(filename: str) -> str | None:
    """Inverse of path_to_filename. Returns None if not an encoded storage token."""
    if not filename.startswith("s_"):
        return None
    token = filename[2:]
    # base64 requires padding to a multiple of 4.
    pad = "=" * (-len(token) % 4)
    try:
        return base64.urlsafe_b64decode(token + pad).decode()
    except Exception:
        return None


def path_to_url(path: str) -> str:
    """Build the frontend-facing URL for a stored object."""
    base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
    fname = path_to_filename(path)
    return f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"
