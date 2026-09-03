"""AI building-footprint extraction pipeline (Phase 3).

Imagery -> preprocess -> segmentation -> mask -> polygonise -> validate ->
georeference -> confidence -> building candidates.

Every output is MODEL OUTPUT / AI_DEMO — never official cadastral / ULPIN /
survey / ownership data.
"""
from .pipeline import run, pipeline_stages  # noqa: F401
from .config import settings  # noqa: F401
