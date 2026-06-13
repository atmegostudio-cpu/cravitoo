"""
AI Photo Suggestions for menu items.

Master Admin generates food photos via OpenAI gpt-image-1
when vendors haven't supplied their own photos.

Endpoints:
  POST /api/ai/menu-photos/suggest      — generate 1-3 photo variants for a prompt
  POST /api/ai/menu-photos/apply        — pick a generated photo and save as menu_item.image_url

Built as a make_router(...) factory.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class MenuPhotoSuggestRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    prompt_override: Optional[str] = Field(None, max_length=500)
    is_vegetarian: Optional[bool] = None
    cuisine_hint: Optional[str] = Field(None, max_length=60)
    count: int = Field(1, ge=1, le=3)


class MenuPhotoApplyRequest(BaseModel):
    menu_item_id: str
    photo_filename: str  # one of the filenames returned by /suggest


def _build_default_prompt(data: MenuPhotoSuggestRequest) -> str:
    """Compose a high-quality photorealistic food prompt.

    The brief comes from menu metadata so the photo actually matches the dish.
    """
    if data.prompt_override:
        # Even with override, append the canonical styling so output stays usable.
        base = data.prompt_override.strip()
    else:
        veg_tag = ""
        if data.is_vegetarian is True:
            veg_tag = " vegetarian"
        elif data.is_vegetarian is False:
            veg_tag = " non-vegetarian"
        cuisine_tag = f" {data.cuisine_hint.strip()}" if data.cuisine_hint else ""
        base = f"Photorealistic{cuisine_tag}{veg_tag} dish of {data.name}, plated on a clean white ceramic plate"

    styling = (
        ", overhead 45° angle, soft natural daylight from the left, "
        "shallow depth of field, garnish in focus, restaurant quality, "
        "vibrant true colours, no text, no watermark, no logo, no people, "
        "no plastic packaging, square 1:1 aspect"
    )
    return f"{base}{styling}"


class BulkFillRequest(BaseModel):
    site_id: Optional[str] = None
    vendor_id: Optional[str] = None
    max_items: int = Field(20, ge=1, le=50, description="Hard cap to control cost — defaults to 20 (~$0.80)")
    dry_run: bool = False


def make_router(db, safe_objectid, get_current_user, UPLOAD_DIR: Path):
    r = APIRouter()

    async def _generate_one_image(image_gen, prompt: str) -> Optional[bytes]:
        try:
            imgs = await image_gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
            return imgs[0] if imgs else None
        except Exception as e:
            logger.warning(f"AI image gen failed for one item: {e}")
            return None

    @r.post("/ai/menu-photos/suggest")
    async def suggest_menu_photos(data: MenuPhotoSuggestRequest, user: dict = Depends(get_current_user)):
        """Generate 1-3 photo variants for the given dish.
        Saves each to UPLOAD_DIR and returns their URLs (not yet attached to any menu item)."""
        if user.get("role") not in ("master_admin", "site_admin"):
            raise HTTPException(status_code=403, detail="Only Cravitoo admins can generate menu photos.")

        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="AI image generation is not configured. Please contact platform admin.",
            )

        # Lazy import — keeps server boot fast and isolates the failure mode if SDK breaks.
        try:
            from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
        except ImportError as e:
            logger.error(f"emergentintegrations import failed: {e}")
            raise HTTPException(status_code=500, detail="Image generation library not available.")

        prompt = _build_default_prompt(data)
        logger.info(f"AI menu-photo prompt (n={data.count}) by {user.get('email')}: {prompt[:120]}")

        image_gen = OpenAIImageGeneration(api_key=api_key)
        try:
            images = await image_gen.generate_images(
                prompt=prompt,
                model="gpt-image-1",
                number_of_images=data.count,
            )
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise HTTPException(status_code=502, detail=f"AI couldn't generate the image right now: {str(e)[:200]}")

        if not images:
            raise HTTPException(status_code=502, detail="No image was generated. Please retry.")

        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        suggestions = []
        for img_bytes in images:
            fname = f"ai_{uuid.uuid4().hex}.png"
            fpath = UPLOAD_DIR / fname
            try:
                with open(fpath, "wb") as f:
                    f.write(img_bytes)
            except Exception as e:
                logger.error(f"Failed to save AI image {fname}: {e}")
                continue
            url = f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"
            suggestions.append({
                "filename": fname,
                "url": url,
                "size": len(img_bytes),
            })

        if not suggestions:
            raise HTTPException(status_code=500, detail="Could not save generated images to storage.")

        # Persist a log so we can audit AI usage (cost control)
        await db.ai_image_generations.insert_one({
            "user_id": user["id"],
            "user_email": user["email"],
            "user_role": user["role"],
            "prompt": prompt,
            "menu_item_name": data.name,
            "count_requested": data.count,
            "count_generated": len(suggestions),
            "filenames": [s["filename"] for s in suggestions],
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "prompt_used": prompt,
            "count": len(suggestions),
            "suggestions": suggestions,
        }

    @r.post("/ai/menu-photos/apply")
    async def apply_menu_photo(data: MenuPhotoApplyRequest, user: dict = Depends(get_current_user)):
        """Save the chosen AI photo as the menu item's image_url. Master Admin only
        (matches the existing menu lock-down policy)."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can update menu photos.")

        # Validate filename pattern (defence-in-depth — paths must be just the filename, no traversal)
        fname = data.photo_filename.strip()
        if not fname.startswith("ai_") or "/" in fname or "\\" in fname or ".." in fname:
            raise HTTPException(status_code=400, detail="Invalid photo filename")

        fpath = UPLOAD_DIR / fname
        if not fpath.exists():
            raise HTTPException(status_code=404, detail="Generated photo not found — it may have expired. Regenerate.")

        item = await db.menu_items.find_one({"_id": safe_objectid(data.menu_item_id, "Menu item")})
        if not item:
            raise HTTPException(status_code=404, detail="Menu item not found")

        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        url = f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"

        await db.menu_items.update_one(
            {"_id": item["_id"]},
            {"$set": {
                "image_url": url,
                "image_source": "ai_generated",
                "image_updated_at": datetime.now(timezone.utc),
                "image_updated_by": user["email"],
            }},
        )
        return {
            "menu_item_id": data.menu_item_id,
            "image_url": url,
            "message": "Menu photo updated.",
        }

    @r.post("/ai/menu-photos/bulk-fill")
    async def bulk_fill_menu_photos(data: BulkFillRequest, user: dict = Depends(get_current_user)):
        """Generate AI photos for ALL menu items that don't have one. Master Admin only.

        Cost-capped via `max_items` (default 20 = ~$0.80 USD = ~₹70). Use `dry_run=true`
        to preview which items would be filled without spending credit.
        """
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Only Master Admin can bulk-fill menu photos.")

        # Build the filter
        query: Dict[str, Any] = {
            "$or": [{"image_url": None}, {"image_url": ""}, {"image_url": {"$exists": False}}],
        }
        if data.vendor_id:
            query["vendor_id"] = data.vendor_id
        if data.site_id:
            # Find vendors mapped to this site, then filter menu items by those vendors
            mapping_cursor = db.vendor_site_mappings.find({"site_id": data.site_id, "status": "active"}, {"vendor_id": 1})
            vendor_ids = [m["vendor_id"] async for m in mapping_cursor]
            if not vendor_ids:
                return {"filled": 0, "skipped": 0, "errors": [], "total_candidates": 0, "dry_run": data.dry_run, "message": "No vendors mapped to this site"}
            query["vendor_id"] = {"$in": vendor_ids}

        # Find candidates (capped)
        candidates_cursor = db.menu_items.find(query).limit(data.max_items)
        candidates: List[Dict[str, Any]] = []
        async for it in candidates_cursor:
            candidates.append(it)

        if data.dry_run:
            return {
                "filled": 0,
                "skipped": 0,
                "errors": [],
                "total_candidates": len(candidates),
                "candidate_names": [c.get("name", "?") for c in candidates[:30]],
                "dry_run": True,
                "estimated_cost_inr": round(len(candidates) * 3.5, 1),  # ~$0.04 each × ~₹85/USD
                "message": f"Would generate AI photos for {len(candidates)} item(s) at ~₹{round(len(candidates) * 3.5, 1)}",
            }

        if not candidates:
            return {"filled": 0, "skipped": 0, "errors": [], "total_candidates": 0, "message": "All menu items already have photos."}

        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="AI image generation is not configured.")
        try:
            from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
        except ImportError:
            raise HTTPException(status_code=500, detail="Image generation library not available.")

        image_gen = OpenAIImageGeneration(api_key=api_key)
        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")

        filled = 0
        skipped = 0
        errors: List[Dict[str, Any]] = []
        items_filled: List[Dict[str, Any]] = []

        for it in candidates:
            name = it.get("name", "")
            if not name:
                skipped += 1
                errors.append({"id": str(it["_id"]), "error": "missing name"})
                continue
            req = MenuPhotoSuggestRequest(
                name=name,
                is_vegetarian=it.get("is_vegetarian"),
                cuisine_hint=it.get("category") or None,
                count=1,
            )
            prompt = _build_default_prompt(req)
            img_bytes = await _generate_one_image(image_gen, prompt)
            if not img_bytes:
                skipped += 1
                errors.append({"id": str(it["_id"]), "name": name, "error": "generation failed"})
                continue
            fname = f"ai_{uuid.uuid4().hex}.png"
            try:
                fpath = UPLOAD_DIR / fname
                with open(fpath, "wb") as f:
                    f.write(img_bytes)
            except Exception as e:
                skipped += 1
                errors.append({"id": str(it["_id"]), "name": name, "error": f"save failed: {e}"})
                continue
            url = f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"
            await db.menu_items.update_one(
                {"_id": it["_id"]},
                {"$set": {
                    "image_url": url,
                    "image_source": "ai_generated_bulk",
                    "image_updated_at": datetime.now(timezone.utc),
                    "image_updated_by": user["email"],
                }},
            )
            filled += 1
            items_filled.append({"id": str(it["_id"]), "name": name, "image_url": url})

        # Audit log
        await db.ai_image_generations.insert_one({
            "user_id": user["id"],
            "user_email": user["email"],
            "user_role": user["role"],
            "operation": "bulk_fill",
            "site_id": data.site_id,
            "vendor_id": data.vendor_id,
            "max_items_requested": data.max_items,
            "filled": filled,
            "skipped": skipped,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "filled": filled,
            "skipped": skipped,
            "errors": errors,
            "total_candidates": len(candidates),
            "items_filled": items_filled,
            "estimated_cost_inr": round(filled * 3.5, 1),
            "dry_run": False,
        }

    return r
