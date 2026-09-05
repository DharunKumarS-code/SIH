"""Model confidence -> HIGH / MEDIUM / LOW for floor-plan features (Phase 4).

Configurable, documented cutoffs shared with the building pipeline
(``AI_CONF_HIGH`` / ``AI_CONF_MED``). These levels are a triage aid only — they
carry no government certification, survey-accuracy or legal meaning.
"""
from __future__ import annotations

from .config import settings


def level_for(confidence: float) -> str:
    if confidence >= settings.conf_high:
        return "HIGH"
    if confidence >= settings.conf_med:
        return "MEDIUM"
    return "LOW"


def review_required(confidence_level: str, geometry_status: str, *, ambiguous: bool = False) -> bool:
    return confidence_level == "LOW" or geometry_status != "VALID" or ambiguous
