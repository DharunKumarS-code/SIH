"""Explicit model-class -> normalised application-class mapping (Phase 4).

Raw model label vocabularies (CubiCasa5K, or any future semantic-segmentation
head) do NOT automatically match this application's classes. This module is the
single documented mapping layer:

    raw model class  ->  normalised APP class  (config.APP_CLASSES)

CubiCasa5K ships two label groups — *rooms* and *icons*. The room group is what
Phase 4 consumes for space/unit inference; the icon group contributes
doors/windows. Anything unmapped becomes ``OTHER`` (never dropped silently).
"""
from __future__ import annotations

from .config import APP_CLASSES

# ---------------------------------------------------------------------------
# CubiCasa5K "room" classes  (per the dataset's model/labelling docs)
# ---------------------------------------------------------------------------
CUBICASA_ROOM_MAP: dict[str, str] = {
    "Background": "OTHER",
    "Outdoor": "OTHER",
    "Wall": "WALL",
    "Kitchen": "KITCHEN",
    "Living Room": "LIVING_ROOM",
    "LivingRoom": "LIVING_ROOM",
    "Bed Room": "BEDROOM",
    "Bedroom": "BEDROOM",
    "Bath": "BATHROOM",
    "Bathroom": "BATHROOM",
    "Entry": "CORRIDOR",
    "Hallway": "CORRIDOR",
    "Railing": "OTHER",
    "Storage": "OTHER",
    "Garage": "OTHER",
    "Undefined": "OTHER",
    "Room": "ROOM",
    "Corridor": "CORRIDOR",
    "Stairs": "STAIR",
    "Staircase": "STAIR",
}

# ---------------------------------------------------------------------------
# CubiCasa5K "icon" classes -> architectural features
# ---------------------------------------------------------------------------
CUBICASA_ICON_MAP: dict[str, str] = {
    "No Icon": "OTHER",
    "Window": "WINDOW",
    "Door": "DOOR",
    "Closet": "OTHER",
    "Electrical Applience": "OTHER",
    "Toilet": "BATHROOM",
    "Sink": "OTHER",
    "Sauna Bench": "OTHER",
    "Fire Place": "OTHER",
    "Bathtub": "BATHROOM",
    "Chimney": "OTHER",
}

# The classical-CV segmenter emits these internal tokens.
CLASSICAL_MAP: dict[str, str] = {
    "wall": "WALL",
    "space": "ROOM",
    "opening": "DOOR",
    "exterior": "OTHER",
}

REGISTRY: dict[str, dict[str, str]] = {
    "cubicasa5k-rooms": CUBICASA_ROOM_MAP,
    "cubicasa5k-icons": CUBICASA_ICON_MAP,
    "classical": CLASSICAL_MAP,
}


def normalise(raw_label: str, vocab: str = "classical") -> str:
    """Project a raw model label onto an APP class. Unknown -> 'OTHER'."""
    table = REGISTRY.get(vocab, CLASSICAL_MAP)
    mapped = table.get(str(raw_label), table.get(str(raw_label).strip().title(), "OTHER"))
    return mapped if mapped in APP_CLASSES else "OTHER"


def mapping_report() -> dict:
    """Documented mapping, surfaced by GET /floorplans/config."""
    return {vocab: dict(table) for vocab, table in REGISTRY.items()}
