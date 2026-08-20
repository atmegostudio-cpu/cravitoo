"""Heuristic allergen classifier for Indian corporate menus.

Given a dish name + description, returns the list of canonical allergen
tokens present. Used by the vendor onboarding Excel import and the
bulk-reclassify endpoints so vendors don't have to hand-tag every row.

Canonical taxonomy (matches the multi-select in MenuTab.js and the
employee Preferences allergen picker):

    milk       - dairy, paneer, ghee, curd, butter, cream, cheese, milk-based sweets
    nuts       - tree nuts: cashew, almond, walnut, pistachio, hazelnut, pecan
    peanuts    - peanuts / groundnut / moongfali / gujarati chikki
    gluten     - wheat, atta, maida, roti, naan, paratha, bread, pasta, biscuit
    soy        - soya, tofu, soy sauce, edamame
    sesame     - til, sesame seed, hummus, tahini
    egg        - anda, omelette, egg-based mayo, cake with eggs
    fish       - fish, salmon, tuna, sardine
    shellfish  - prawn, shrimp, crab, lobster, squid, calamari
    mustard    - mustard seed, sarson, kasundi

Rule: word-boundary regex, order-independent, deduplicated. Empty
list means "no known allergens detected" — the vendor can still
select them manually in the UI.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Tuple

# The public canonical keys - keep in sync with the frontend picker.
ALLERGEN_KEYS: Tuple[str, ...] = (
    "milk", "nuts", "peanuts", "gluten", "soy",
    "sesame", "egg", "fish", "shellfish", "mustard",
)

# User-facing labels for the UI (single source of truth).
ALLERGEN_LABELS: Dict[str, str] = {
    "milk": "Milk / Dairy",
    "nuts": "Nuts",
    "peanuts": "Peanuts",
    "gluten": "Gluten / Wheat",
    "soy": "Soy",
    "sesame": "Sesame",
    "egg": "Egg",
    "fish": "Fish",
    "shellfish": "Shellfish",
    "mustard": "Mustard",
}

# Token buckets. Each list is a set of regex fragments that will be
# joined with `|` and wrapped in `\b(?:...)\b`. Keep tokens lowercase.
_TOKENS: Dict[str, Tuple[str, ...]] = {
    "milk": (
        r"milk", r"dairy", r"paneer", r"ghee", r"curd", r"dahi", r"yogurt", r"yoghurt",
        r"butter", r"cream", r"cheese", r"khoya", r"khoa", r"mawa", r"malai",
        r"kheer", r"rabri", r"kulfi", r"lassi", r"gulab\s+jamun", r"rasmalai",
        r"rasgulla", r"barfi", r"burfi", r"peda", r"mishti\s+doi", r"custard",
        r"condensed\s+milk", r"evaporated\s+milk", r"milkshake",
    ),
    "nuts": (
        r"cashew", r"kaju", r"almond", r"badam", r"walnut", r"akhrot",
        r"pistachio", r"pista", r"hazelnut", r"pecan", r"macadamia",
        r"brazil\s+nut", r"chestnut", r"pine\s+nut", r"nutty",
    ),
    "peanuts": (
        r"peanut", r"peanuts", r"groundnut", r"moongfali", r"mungfali", r"singdana",
        r"chikki",
    ),
    "gluten": (
        r"wheat", r"atta", r"maida", r"suji", r"rava", r"semolina",
        r"roti", r"naan", r"paratha", r"paratha's", r"kulcha", r"chapati",
        r"phulka", r"puri", r"bhatura", r"bread", r"toast", r"sandwich",
        r"burger", r"bun", r"pasta", r"noodles?", r"macaroni", r"lasagna",
        r"pizza", r"biscuit", r"cookie", r"cake", r"cracker", r"pretzel",
        r"dosa\s+wrap", r"seitan",
    ),
    "soy": (
        r"soy\b", r"soya", r"soybean", r"tofu", r"edamame", r"tempeh",
        r"soy\s+sauce", r"tamari", r"miso",
    ),
    "sesame": (
        r"sesame", r"til\b", r"tahini", r"hummus", r"benne",
    ),
    "egg": (
        r"egg", r"eggs", r"anda", r"omelette", r"omlette", r"omelet",
        r"bhurji", r"scrambled", r"mayonnaise", r"mayo\b",
    ),
    "fish": (
        r"fish", r"salmon", r"tuna", r"sardine", r"mackerel", r"pomfret",
        r"anchovy", r"cod\b", r"tilapia", r"rohu", r"katla", r"hilsa",
    ),
    "shellfish": (
        r"prawn", r"prawns", r"shrimp", r"crab", r"lobster",
        r"squid", r"calamari", r"oyster", r"scallop", r"mussel", r"clam",
    ),
    "mustard": (
        r"mustard", r"sarson", r"rai\b", r"kasundi",
    ),
}

_COMPILED: Dict[str, re.Pattern] = {
    key: re.compile(r"\b(?:" + "|".join(tokens) + r")\b", re.IGNORECASE)
    for key, tokens in _TOKENS.items()
}


def classify_allergens(name: str, description: str = "") -> List[str]:
    """Return the sorted list of canonical allergen keys detected in the text.

    The result respects `ALLERGEN_KEYS` insertion order so the UI can render
    badges in a consistent sequence.
    """
    haystack = f"{name} {description}".strip()
    if not haystack:
        return []
    hits: List[str] = []
    for key in ALLERGEN_KEYS:
        if _COMPILED[key].search(haystack):
            hits.append(key)
    return hits


def normalize_allergens(values: Iterable) -> List[str]:
    """Filter an incoming allergen list to the canonical keys only.

    Accepts strings in any case and drops unknown / duplicate values.
    Preserves canonical order.
    """
    if not values:
        return []
    lowered = {str(v).strip().lower() for v in values if v}
    return [k for k in ALLERGEN_KEYS if k in lowered]


def reclassify_batch(items: Iterable[dict], only_missing: bool = True) -> Tuple[List[dict], int]:
    """Re-run the classifier over every item's `allergens` field.

    Args:
        items: iterable of dicts (draft_menu row or menu_items doc)
        only_missing: if True (default), leave items that already have a
            non-empty `allergens` list untouched — the vendor's manual
            selection wins. Set False to overwrite everything.

    Returns `(items, changed_count)` — non-destructive on unchanged rows.
    """
    changed = 0
    updated: List[dict] = []
    for it in items:
        current = it.get("allergens")
        has_current = isinstance(current, list) and len(current) > 0
        if only_missing and has_current:
            updated.append(it)
            continue
        predicted = classify_allergens(it.get("name", ""), it.get("description", ""))
        if predicted != (current or []):
            it = {**it, "allergens": predicted}
            changed += 1
        updated.append(it)
    return updated, changed
