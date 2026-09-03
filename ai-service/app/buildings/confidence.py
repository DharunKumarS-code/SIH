"""Model confidence -> HIGH / MEDIUM / LOW (documented, configurable cutoffs).

These levels are a model-output triage aid ONLY. They do not represent any
government certification, survey accuracy or legal status.
"""
from __future__ import annotations

from .config import settings


def level_for(confidence: float) -> str:
    if confidence >= settings.conf_high:
        return "HIGH"
    if confidence >= settings.conf_med:
        return "MEDIUM"
    return "LOW"


def review_required(confidence_level: str, geometry_status: str) -> bool:
    return confidence_level == "LOW" or geometry_status != "VALID"
