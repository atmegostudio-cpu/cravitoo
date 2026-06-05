"""
AI Photo Suggestions for menu items (iter18).

Master Admin generates food photos via OpenAI gpt-image-1 (Emergent LLM Key)
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
from typing import Optional

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


def make_router(db, safe_objectid, get_current_user, UPLOAD_DIR: Path):
    r = APIRouter()

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

    return r
