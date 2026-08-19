"""Heuristic Veg / Non-Veg classifier for Indian corporate menus.

The Indian corporate food market is heavily vegetarian by default. A menu
row is classified as non-veg ONLY if its name / description contains a
strong non-veg keyword (chicken, mutton, fish, egg, prawn, beef, pork,
lamb, keema, ...). Everything else is treated as veg — this matches the
FSSAI green-dot / brown-dot standard and prevents Cravitoo from ever
mis-labelling paneer, sabzi, dal or chai as "non-veg" (a serious
religious / dietary safety issue).

The classifier is intentionally conservative on veg-side: paneer, aloo,
veg, sabzi, dal explicitly force veg=True even if a stray token like
"kebab" appears (paneer tikka kebab is veg).
"""
from __future__ import annotations

import re
from typing import Iterable

# Strong non-veg tokens. Word-boundary regex means substrings never match
# (e.g. "peach" wouldn't hit "prawn"). Order-independent.
NON_VEG_TOKENS = (
    r"chicken", r"mutton", r"fish", r"prawn", r"prawns", r"shrimp",
    r"beef", r"pork", r"lamb", r"keema", r"kheema", r"gosht",
    r"seekh", r"tandoori\s+chicken", r"butter\s+chicken", r"egg", r"eggs",
    r"omelette", r"omlette", r"omelet", r"bhurji",
    r"anda", r"crab", r"squid", r"tuna", r"salmon", r"bacon",
    r"sausage", r"salami", r"pepperoni", r"ham",
    r"meat", r"turkey", r"duck", r"venison", r"quail",
)

# Strong veg tokens — override non-veg matches so paneer-tikka-kebab stays veg.
VEG_TOKENS = (
    r"paneer", r"aloo", r"potato", r"sabzi", r"sabji", r"subzi",
    r"veg\b", r"veggie", r"vegetarian",
    r"dal\b", r"daal", r"khichdi", r"kheer", r"idli", r"dosa",
    r"upma", r"poha", r"vada\b", r"medu\s+vada",
    r"chana", r"channa", r"chole", r"rajma",
    r"palak", r"bhindi", r"gobi", r"gobhi", r"cauliflower", r"cabbage",
    r"mushroom", r"corn\b", r"peas\b", r"matar",
    r"masala\s+dosa", r"pizza\s+margherita",
    r"tofu", r"soya", r"soy\b", r"sprouts?",
)

NON_VEG_RE = re.compile(r"\b(?:" + "|".join(NON_VEG_TOKENS) + r")\b", re.IGNORECASE)
VEG_RE = re.compile(r"\b(?:" + "|".join(VEG_TOKENS) + r")\b", re.IGNORECASE)


def classify_veg(name: str, description: str = "") -> bool:
    """Return True if the item should be tagged vegetarian.

    Rules (in order):
      1. Explicit veg keyword anywhere → veg (True). Handles "paneer kebab",
         "veg biryani", "aloo tikki" etc.
      2. Explicit non-veg keyword → non-veg (False).
      3. Nothing matched → veg (True). Indian corporate default.
    """
    haystack = f"{name} {description}".strip()
    if VEG_RE.search(haystack):
        return True
    if NON_VEG_RE.search(haystack):
        return False
    return True


def reclassify_batch(items: Iterable[dict]) -> tuple[list[dict], int]:
    """Re-classify each item's `is_vegetarian` field using classify_veg().

    Returns `(items, changed_count)`. Non-destructive: only flips the flag
    when the classifier produces a different result — items already
    labelled consistently are left alone.
    """
    changed = 0
    updated = []
    for it in items:
        current = bool(it.get("is_vegetarian", False))
        predicted = classify_veg(it.get("name", ""), it.get("description", ""))
        if current != predicted:
            it = {**it, "is_vegetarian": predicted}
            changed += 1
        updated.append(it)
    return updated, changed
