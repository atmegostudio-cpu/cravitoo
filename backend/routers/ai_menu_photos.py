"""
AI Photo Suggestions for menu items.

Master Admin generates food photos via OpenAI gpt-image-1
when vendors haven't supplied their own photos.

Endpoints:
  POST /api/ai/menu-photos/suggest       — generate 1-3 photo variants for a prompt
  POST /api/ai/menu-photos/suggest-free  — free variant (Unsplash + Pollinations)
  POST /api/ai/menu-photos/apply         — pick a generated photo and save as menu_item.image_url
  POST /api/ai/menu-photos/bulk-fill     — bulk generate + attach for items missing photos

Built as a make_router(...) factory.
"""

from __future__ import annotations

import logging
import os
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from storage import path_to_url, put_object

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────
COST_PER_IMAGE_INR = 3.5  # ~$0.04 × ~₹85/USD (gpt-image-1 pricing)
STYLING_SUFFIX = (
    ", overhead 45° angle, soft natural daylight from the left, "
    "shallow depth of field, garnish in focus, restaurant quality, "
    "vibrant true colours, no text, no watermark, no logo, no people, "
    "no plastic packaging, square 1:1 aspect"
)


# ── Request models ──────────────────────────────────────────────────────────
class MenuPhotoSuggestRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    prompt_override: Optional[str] = Field(None, max_length=500)
    is_vegetarian: Optional[bool] = None
    cuisine_hint: Optional[str] = Field(None, max_length=60)
    count: int = Field(1, ge=1, le=3)


class MenuPhotoApplyRequest(BaseModel):
    menu_item_id: str
    # Either photo_url (preferred, the full Object-Storage URL returned by
    # /suggest) or photo_filename (legacy: the basename inside the URL).
    # We accept both for backward compat but always store the URL.
    photo_url: Optional[str] = None
    photo_filename: Optional[str] = None


class BulkFillRequest(BaseModel):
    site_id: Optional[str] = None
    vendor_id: Optional[str] = None
    max_items: int = Field(200, ge=1, le=500, description="Hard cap to control cost (paid) or runtime (free). Defaults to 200.")
    dry_run: bool = False
    source: str = Field("paid", description="'paid' → gpt-image-1 (₹3.5/item). 'free' → Unsplash + Pollinations (₹0).")


class MenuPhotoRegenerateRequest(BaseModel):
    source: str = Field("free", description="'free' → Unsplash + Pollinations (₹0). 'paid' → gpt-image-1 (~₹3.5).")


class MenuPhotoFreeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=300)
    is_vegetarian: bool = False
    cuisine_hint: Optional[str] = None
    count: int = Field(default=1, ge=1, le=4)


# ── Prompt helpers ──────────────────────────────────────────────────────────
def _build_default_prompt(data: MenuPhotoSuggestRequest) -> str:
    """Compose a high-quality photorealistic food prompt.

    The brief comes from menu metadata so the photo actually matches the dish.
    """
    if data.prompt_override:
        base = data.prompt_override.strip()
    else:
        veg_tag = ""
        if data.is_vegetarian is True:
            veg_tag = " vegetarian"
        elif data.is_vegetarian is False:
            veg_tag = " non-vegetarian"
        cuisine_tag = f" {data.cuisine_hint.strip()}" if data.cuisine_hint else ""
        base = f"Photorealistic{cuisine_tag}{veg_tag} dish of {data.name}, plated on a clean white ceramic plate"
    return f"{base}{STYLING_SUFFIX}"


# ── Storage helpers ─────────────────────────────────────────────────────────
async def _save_image_to_storage(
    img_bytes: bytes,
    prefix: str,
    ext: str = "png",
    content_type: str = "image/png",
) -> Dict[str, Any]:
    """Persist bytes to Emergent Object Storage and return {filename, storage_path, url, size}."""
    fname = f"{prefix}_{uuid.uuid4().hex}.{ext}"
    storage_path = f"cravitoo/ai-menu-photos/{fname}" if prefix == "ai" else f"cravitoo/menu-photos-free/{fname}"
    result = await run_in_threadpool(put_object, storage_path, img_bytes, content_type)
    return {
        "filename": os.path.basename(result["path"]),
        "storage_path": result["path"],
        "url": path_to_url(result["path"]),
        "size": len(img_bytes),
    }


def _load_image_gen_or_raise():
    """Return an OpenAIImageGeneration instance or raise a well-typed HTTPException."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="AI image generation is not configured. Please contact platform admin.",
        )
    try:
        from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
    except ImportError as e:
        logger.error(f"emergentintegrations import failed: {e}")
        raise HTTPException(status_code=500, detail="Image generation library not available.")
    return OpenAIImageGeneration(api_key=api_key)


async def _generate_one_image(image_gen, prompt: str) -> Optional[bytes]:
    """Best-effort single-image generation. Returns None on failure (caller decides)."""
    try:
        imgs = await image_gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
        return imgs[0] if imgs else None
    except Exception as e:
        logger.warning(f"AI image gen failed for one item: {e}")
        return None


def _free_photo_urls(body: MenuPhotoFreeRequest) -> List[tuple]:
    """Build the ordered fallback list of (source_label, url) for the free photo path."""
    veg_hint = "vegetarian" if body.is_vegetarian else ""
    cuisine = (body.cuisine_hint or "indian").lower()
    query = ",".join(filter(None, [body.name.strip(), veg_hint, cuisine, "food", "plated"]))
    prompt = f"appetizing {body.name}, {cuisine} food, professional food photography"
    return [
        ("unsplash", f"https://source.unsplash.com/800x600/?{urllib.parse.quote(query)}"),
        ("pollinations",
         f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}?width=800&height=600&nologo=true"),
    ]


async def _try_fetch_free_photo(url: str) -> Optional[bytes]:
    """Return image bytes from a free source, or None on failure."""
    try:
        resp = await run_in_threadpool(lambda: requests.get(url, timeout=30, allow_redirects=True))
        if resp.status_code != 200 or len(resp.content) < 1024:
            return None
        if not resp.headers.get("Content-Type", "image/jpeg").startswith("image/"):
            return None
        return resp.content
    except Exception as e:
        logger.warning(f"Free photo fetch failed for {url[:80]}: {e}")
        return None


def _menu_photo_url(fname: str) -> str:
    """Build the public URL for a stored menu photo filename token."""
    base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
    return f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"


# ── Router factory ──────────────────────────────────────────────────────────
def make_router(db, safe_objectid, get_current_user, UPLOAD_DIR: Path):
    r = APIRouter()

    def _require_admin(user: dict, roles=("master_admin", "site_admin")):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Only Cravitoo admins can generate menu photos.")

    @r.post("/ai/menu-photos/suggest")
    async def suggest_menu_photos(data: MenuPhotoSuggestRequest, user: dict = Depends(get_current_user)):
        """Generate 1-3 photo variants for the given dish.
        Saves each to Emergent Object Storage and returns their URLs (not yet attached to any menu item)."""
        _require_admin(user)

        image_gen = _load_image_gen_or_raise()
        prompt = _build_default_prompt(data)
        logger.info(f"AI menu-photo prompt (n={data.count}) by {user.get('email')}: {prompt[:120]}")

        try:
            images = await image_gen.generate_images(
                prompt=prompt, model="gpt-image-1", number_of_images=data.count,
            )
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise HTTPException(status_code=502, detail=f"AI couldn't generate the image right now: {str(e)[:200]}")

        if not images:
            raise HTTPException(status_code=502, detail="No image was generated. Please retry.")

        suggestions = []
        for img_bytes in images:
            try:
                suggestions.append(await _save_image_to_storage(img_bytes, "ai"))
            except Exception as e:
                logger.error(f"Object storage save failed for AI image: {e}")
                continue

        if not suggestions:
            raise HTTPException(status_code=500, detail="Could not save generated images to storage.")

        await db.ai_image_generations.insert_one({
            "user_id": user["id"], "user_email": user["email"], "user_role": user["role"],
            "prompt": prompt, "menu_item_name": data.name,
            "count_requested": data.count, "count_generated": len(suggestions),
            "filenames": [s["filename"] for s in suggestions],
            "cost_inr": round(len(suggestions) * COST_PER_IMAGE_INR, 2),
            "created_at": datetime.now(timezone.utc),
        })

        return {"prompt_used": prompt, "count": len(suggestions), "suggestions": suggestions}

    @r.post("/ai/menu-photos/suggest-free")
    async def suggest_free_menu_photo(body: MenuPhotoFreeRequest, user: dict = Depends(get_current_user)):
        """Free menu photo (no LLM key spend).

        Strategy: try Unsplash Source (real food photography, always high
        quality) first; on failure or empty response, fall back to
        Pollinations.ai (FLUX under the hood, keyless). Bytes get uploaded
        to Emergent Object Storage so the URL survives redeploys.
        """
        _require_admin(user)

        for source, url in _free_photo_urls(body):
            content = await _try_fetch_free_photo(url)
            if content is None:
                continue
            try:
                saved = await _save_image_to_storage(content, "free", ext="jpg", content_type="image/jpeg")
            except Exception as e:
                logger.warning(f"Free source '{source}' storage save failed: {e}")
                continue

            await db.ai_image_generations.insert_one({
                "created_at": datetime.now(timezone.utc),
                "user_id": user.get("id"), "user_email": user.get("email"),
                "source": source, "cost_inr": 0, "count_generated": 1,
                "item_name": body.name,
            })
            return {
                "source": source,
                "suggestions": [{"url": saved["url"], "storage_path": saved["storage_path"], "size": saved["size"]}],
            }

        raise HTTPException(
            status_code=502,
            detail="All free photo sources are unavailable right now. Try again or use the paid AI button.",
        )

    @r.post("/ai/menu-photos/apply")
    async def apply_menu_photo(data: MenuPhotoApplyRequest, user: dict = Depends(get_current_user)):
        """Save the chosen AI photo as the menu item's image_url.

        Master Admin only (matches the existing menu lock-down policy).

        The client should send the full ``photo_url`` returned by
        ``/suggest`` (or ``/suggest-free``). We also accept the legacy
        ``photo_filename`` argument, in which case we rebuild the URL —
        but the file MUST be an ``s_``-prefixed Object-Storage token,
        otherwise the resulting URL would 404 on ``serve_upload``.
        """
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can update menu photos.")

        # 1. Prefer photo_url — most robust across storage backends.
        url: Optional[str] = None
        if data.photo_url:
            url = data.photo_url.strip()
            # Basic sanity: only allow same-app URLs or object-storage paths.
            if not (url.startswith("/api/uploads/") or url.startswith("http://") or url.startswith("https://")):
                raise HTTPException(status_code=400, detail="Invalid photo URL")

        # 2. Fall back to filename for backward compatibility.
        elif data.photo_filename:
            fname = data.photo_filename.strip()
            if "/" in fname or "\\" in fname or ".." in fname:
                raise HTTPException(status_code=400, detail="Invalid photo filename")
            # Only object-storage tokens are actually serveable; the old
            # ``ai_<hex>.png`` local-disk names would 404 for customers.
            if not fname.startswith("s_"):
                raise HTTPException(
                    status_code=400,
                    detail="Legacy photo filename cannot be applied — please regenerate this photo.",
                )
            url = _menu_photo_url(fname)
        else:
            raise HTTPException(status_code=400, detail="Provide either photo_url or photo_filename")

        item = await db.menu_items.find_one({"_id": safe_objectid(data.menu_item_id, "Menu item")})
        if not item:
            raise HTTPException(status_code=404, detail="Menu item not found")

        await db.menu_items.update_one(
            {"_id": item["_id"]},
            {"$set": {
                "image_url": url,
                "image_source": "ai_generated",
                "image_updated_at": datetime.now(timezone.utc),
                "image_updated_by": user["email"],
            }},
        )
        return {"menu_item_id": data.menu_item_id, "image_url": url, "message": "Menu photo updated."}

    async def _bulk_candidates(data: BulkFillRequest) -> List[Dict[str, Any]]:
        """Return the list of menu_items eligible for bulk-fill (respecting scope + cap)."""
        query: Dict[str, Any] = {
            "$or": [{"image_url": None}, {"image_url": ""}, {"image_url": {"$exists": False}}],
        }
        if data.vendor_id:
            query["vendor_id"] = data.vendor_id
        if data.site_id:
            mapping_cursor = db.vendor_site_mappings.find(
                {"site_id": data.site_id, "status": "active"}, {"vendor_id": 1},
            )
            vendor_ids = [m["vendor_id"] async for m in mapping_cursor]
            if not vendor_ids:
                return []
            query["vendor_id"] = {"$in": vendor_ids}
        return [it async for it in db.menu_items.find(query).limit(data.max_items)]

    async def _bulk_fill_one(image_gen, item: Dict[str, Any], user_email: str) -> Dict[str, Any]:
        """Generate + attach an AI photo for a single menu item. Returns a status dict."""
        name = item.get("name", "")
        item_id = str(item["_id"])
        if not name:
            return {"ok": False, "id": item_id, "error": "missing name"}

        req = MenuPhotoSuggestRequest(
            name=name,
            is_vegetarian=item.get("is_vegetarian"),
            cuisine_hint=item.get("category") or None,
            count=1,
        )
        img_bytes = await _generate_one_image(image_gen, _build_default_prompt(req))
        if not img_bytes:
            return {"ok": False, "id": item_id, "name": name, "error": "generation failed"}

        try:
            saved = await _save_image_to_storage(img_bytes, "ai")
        except Exception as e:
            return {"ok": False, "id": item_id, "name": name, "error": f"storage failed: {e}"}

        await db.menu_items.update_one(
            {"_id": item["_id"]},
            {"$set": {
                "image_url": saved["url"],
                "image_source": "ai_generated_bulk",
                "image_updated_at": datetime.now(timezone.utc),
                "image_updated_by": user_email,
            }},
        )
        return {"ok": True, "id": item_id, "name": name, "image_url": saved["url"]}

    async def _bulk_fill_one_free(item: Dict[str, Any], user_email: str) -> Dict[str, Any]:
        """Zero-cost variant of _bulk_fill_one — uses Unsplash + Pollinations."""
        name = item.get("name", "")
        item_id = str(item["_id"])
        if not name:
            return {"ok": False, "id": item_id, "error": "missing name"}

        req = MenuPhotoFreeRequest(
            name=name,
            description=item.get("description") or "",
            is_vegetarian=bool(item.get("is_vegetarian")),
            cuisine_hint=item.get("category") or None,
            count=1,
        )
        used_source = None
        content = None
        for source, url in _free_photo_urls(req):
            content = await _try_fetch_free_photo(url)
            if content is not None:
                used_source = source
                break
        if not content:
            return {"ok": False, "id": item_id, "name": name, "error": "all free sources failed"}

        try:
            saved = await _save_image_to_storage(content, "free", ext="jpg", content_type="image/jpeg")
        except Exception as e:
            return {"ok": False, "id": item_id, "name": name, "error": f"storage failed: {e}"}

        await db.menu_items.update_one(
            {"_id": item["_id"]},
            {"$set": {
                "image_url": saved["url"],
                "image_source": f"free_bulk_{used_source}",
                "image_updated_at": datetime.now(timezone.utc),
                "image_updated_by": user_email,
            }},
        )
        return {"ok": True, "id": item_id, "name": name, "image_url": saved["url"], "source": used_source}

    @r.post("/ai/menu-photos/bulk-fill")
    async def bulk_fill_menu_photos(data: BulkFillRequest, user: dict = Depends(get_current_user)):
        """Generate photos for ALL menu items that don't have one. Master Admin only.

        Two modes:
          - ``source="paid"`` (default): gpt-image-1 via Emergent LLM key,
            capped at ~₹3.5/item. Best quality, but costs money.
          - ``source="free"``: Unsplash + Pollinations.ai fallback chain,
            ₹0 cost. Slower and lower fidelity but great for MVP launches.

        Cost-capped via ``max_items``. Use ``dry_run=true`` to preview which
        items would be filled without spending credit.
        """
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can bulk-fill menu photos.")

        candidates = await _bulk_candidates(data)
        is_free = (data.source or "paid").lower() == "free"
        per_item_cost = 0.0 if is_free else COST_PER_IMAGE_INR

        if data.dry_run:
            return {
                "filled": 0, "skipped": 0, "errors": [],
                "total_candidates": len(candidates),
                "candidate_names": [c.get("name", "?") for c in candidates[:30]],
                "dry_run": True,
                "source": "free" if is_free else "paid",
                "estimated_cost_inr": round(len(candidates) * per_item_cost, 1),
                "message": (
                    f"Would fetch FREE photos for {len(candidates)} item(s) at ₹0."
                    if is_free else
                    f"Would generate AI photos for {len(candidates)} item(s) at ~₹{round(len(candidates) * COST_PER_IMAGE_INR, 1)}"
                ),
            }

        if not candidates:
            return {"filled": 0, "skipped": 0, "errors": [], "total_candidates": 0,
                    "source": "free" if is_free else "paid",
                    "message": "All menu items already have photos."}

        image_gen = None if is_free else _load_image_gen_or_raise()

        filled, skipped = 0, 0
        errors: List[Dict[str, Any]] = []
        items_filled: List[Dict[str, Any]] = []

        for it in candidates:
            if is_free:
                result = await _bulk_fill_one_free(it, user["email"])
            else:
                result = await _bulk_fill_one(image_gen, it, user["email"])
            if result["ok"]:
                filled += 1
                items_filled.append({"id": result["id"], "name": result["name"], "image_url": result["image_url"]})
            else:
                skipped += 1
                errors.append({k: v for k, v in result.items() if k != "ok"})

        await db.ai_image_generations.insert_one({
            "user_id": user["id"], "user_email": user["email"], "user_role": user["role"],
            "operation": "bulk_fill",
            "source": "free" if is_free else "paid",
            "site_id": data.site_id, "vendor_id": data.vendor_id,
            "max_items_requested": data.max_items,
            "filled": filled, "skipped": skipped,
            "cost_inr": round(filled * per_item_cost, 2),
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "filled": filled, "skipped": skipped, "errors": errors[:20],
            "total_candidates": len(candidates),
            "items_filled": items_filled[:20],  # cap payload
            "source": "free" if is_free else "paid",
            "estimated_cost_inr": round(filled * per_item_cost, 1),
            "dry_run": False,
        }

    @r.post("/ai/menu-photos/regenerate/{menu_item_id}")
    async def regenerate_menu_photo(
        menu_item_id: str,
        body: MenuPhotoRegenerateRequest,
        user: dict = Depends(get_current_user),
    ):
        """Swap the current photo on a single menu item.

        The most common use case: a Free bulk-fill produced a mediocre
        photo and Master Admin wants to upgrade just that one row to a
        paid AI photo. Pass ``source="paid"`` to force gpt-image-1;
        pass ``source="free"`` to retry Unsplash + Pollinations.

        Auth:
          - ``master_admin``: any item, any source
          - ``vendor``: only items they own, FREE source only (paid AI
            is admin-only for cost control)
        Overwrites ``image_url`` unconditionally — it's the *regenerate*
        endpoint, not *fill only if missing*.
        """
        item = await db.menu_items.find_one({"_id": safe_objectid(menu_item_id, "Menu item")})
        if not item:
            raise HTTPException(status_code=404, detail="Menu item not found")

        role = user.get("role")
        is_admin = role == "master_admin"
        is_owning_vendor = role == "vendor" and item.get("vendor_id") == user.get("vendor_id")
        if not (is_admin or is_owning_vendor):
            raise HTTPException(status_code=403, detail="Only Master Admin or the owning vendor can regenerate this photo.")

        is_free = (body.source or "free").lower() == "free"
        # Cost control: vendors can only use the FREE source (₹0). Paid
        # AI generation stays admin-only so a compromised vendor account
        # can't drain the Emergent LLM budget.
        if not is_admin and not is_free:
            raise HTTPException(
                status_code=403,
                detail="Vendors can only use the free photo source. Ask Master Admin to run paid AI generation.",
            )

        if is_free:
            result = await _bulk_fill_one_free(item, user["email"])
        else:
            image_gen = _load_image_gen_or_raise()
            result = await _bulk_fill_one(image_gen, item, user["email"])

        if not result["ok"]:
            raise HTTPException(status_code=502, detail=result.get("error") or "Photo generation failed")

        await db.ai_image_generations.insert_one({
            "user_id": user["id"], "user_email": user["email"], "user_role": role,
            "operation": "regenerate",
            "menu_item_id": menu_item_id,
            "menu_item_name": item.get("name"),
            "source": "free" if is_free else "paid",
            "cost_inr": 0.0 if is_free else COST_PER_IMAGE_INR,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "menu_item_id": menu_item_id,
            "image_url": result["image_url"],
            "source": "free" if is_free else "paid",
            "cost_inr": 0.0 if is_free else COST_PER_IMAGE_INR,
        }

    return r
