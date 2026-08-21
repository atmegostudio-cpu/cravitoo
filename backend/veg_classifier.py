"""Heuristic Veg / Non-Veg classifier for Indian corporate menus.

The classifier is *safety-first*: an item is treated as non-veg the
moment a strong meat/egg/fish token appears, even if it also carries an
otherwise-veg word (e.g. "Chicken Corn Soup" — the corn cannot rescue
it). Only explicit veg tokens that are NEVER meat (paneer, aloo, dal…)
can win over an ambiguous name.

The Indian corporate market is heavily vegetarian by default, so items
with **no** matching token stay veg — matching FSSAI green-dot / brown-
dot marketing conventions.
"""
from __future__ import annotations

import re
from typing import Iterable

# Strong non-veg tokens — a match here forces non-veg **unconditionally**,
# even in the presence of an otherwise-veg word. These are always meat.
DEFINITE_NON_VEG_TOKENS = (
    r"chicken", r"mutton", r"fish", r"prawn", r"prawns", r"shrimp",
    r"beef", r"pork", r"lamb", r"keema", r"kheema", r"gosht",
    r"crab", r"squid", r"tuna", r"salmon", r"bacon",
    r"sausage", r"salami", r"pepperoni", r"ham\b",
    r"meat", r"meatball", r"turkey", r"duck", r"venison", r"quail",
    r"tandoori\s+chicken", r"butter\s+chicken",
)

# Ambiguous non-veg tokens — usually meat but can be veg with the right
# qualifier (e.g. "Paneer Tikka", "Veg Kebab"). A match here only wins
# when NO strong veg override is present.
AMBIGUOUS_NON_VEG_TOKENS = (
    r"egg", r"eggs", r"omelette", r"omlette", r"omelet", r"bhurji", r"anda",
    r"seekh", r"kebab", r"kabab", r"tikka",
)

# Veg-only tokens that trump ambiguous non-veg tokens — items containing
# these stay veg even if "kebab" / "tikka" appears (Paneer Tikka Kebab).
# Keep this list **tight**: only tokens that are ALWAYS the star of the
# dish belong here. Everyday veggies (corn, peas, mushroom, palak,
# cauliflower) are NOT here — they routinely appear as sides to chicken
# / mutton dishes.
STRONG_VEG_TOKENS = (
    r"paneer", r"aloo", r"sabzi", r"sabji", r"subzi",
    r"vegetarian", r"veg\s+(?:only|thali|meal|combo|biryani|pulao|starter)",
    r"dal\b", r"daal", r"khichdi",
    r"idli", r"dosa", r"upma", r"poha", r"vada\b", r"medu\s+vada",
    r"chana", r"channa", r"chole", r"rajma",
    r"masala\s+dosa", r"pizza\s+margherita",
    r"tofu", r"soya\s+chunk", r"sprouts?",
    r"vegetable", r"veggie",
)

# Explicit "non-veg" phrase — case-insensitive, allows hyphens/spaces.
EXPLICIT_NON_VEG_RE = re.compile(r"\bnon[\s-]?veg(?:etarian)?\b", re.IGNORECASE)
DEFINITE_NON_VEG_RE = re.compile(r"\b(?:" + "|".join(DEFINITE_NON_VEG_TOKENS) + r")\b", re.IGNORECASE)
AMBIGUOUS_NON_VEG_RE = re.compile(r"\b(?:" + "|".join(AMBIGUOUS_NON_VEG_TOKENS) + r")\b", re.IGNORECASE)
STRONG_VEG_RE = re.compile(r"\b(?:" + "|".join(STRONG_VEG_TOKENS) + r")\b", re.IGNORECASE)

# Legacy aliases (kept so any external test / helper still importing them
# continues to work — do NOT remove without checking usages).
NON_VEG_TOKENS = DEFINITE_NON_VEG_TOKENS + AMBIGUOUS_NON_VEG_TOKENS
NON_VEG_RE = re.compile(r"\b(?:" + "|".join(NON_VEG_TOKENS) + r")\b", re.IGNORECASE)


def classify_veg(name: str, description: str = "") -> bool:
    """Return True if the item should be tagged vegetarian.

    Safety-first rule order:

      1. Explicit "non-veg" phrase → non-veg. Wins over everything.
      2. Definite meat token (chicken, mutton, fish, beef, pork, keema,
         prawn, crab, tuna, salmon, bacon, sausage, meat, turkey, duck…)
         → non-veg. Definite meat cannot be rescued by veg words —
         "Chicken Corn Soup", "Chicken Dal", "Palak Chicken" are all non-veg.
      3. Ambiguous non-veg token (kebab, tikka, egg, anda, seekh) AND no
         strong veg override (paneer, aloo, dal, tofu…) → non-veg.
      4. Strong veg token → veg.
      5. Nothing matched → veg (Indian corporate FSSAI default).
    """
    haystack = f"{name} {description}".strip()

    if EXPLICIT_NON_VEG_RE.search(haystack):
        return False
    if DEFINITE_NON_VEG_RE.search(haystack):
        return False

    has_ambiguous_non_veg = bool(AMBIGUOUS_NON_VEG_RE.search(haystack))
    has_strong_veg = bool(STRONG_VEG_RE.search(haystack))

    if has_ambiguous_non_veg and not has_strong_veg:
        return False
    return True


def reclassify_batch(items: Iterable[dict], only_missing: bool = False) -> tuple[list[dict], int]:
    """Re-classify each item's ``is_vegetarian`` field using classify_veg().

    Args:
        items: iterable of dicts to reclassify.
        only_missing: if True, only items whose ``is_vegetarian`` is
            missing / None are updated — items with an explicit True /
            False are preserved (respects manual overrides).

    Returns ``(items, changed_count)``.
    """
    changed = 0
    updated: list[dict] = []
    for it in items:
        current = it.get("is_vegetarian")
        if only_missing and current is not None:
            updated.append(it)
            continue
        predicted = classify_veg(it.get("name", ""), it.get("description", ""))
        if bool(current) != predicted:
            it = {**it, "is_vegetarian": predicted}
            changed += 1
        updated.append(it)
    return updated, changed
