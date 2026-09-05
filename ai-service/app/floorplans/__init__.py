"""AI floor-plan & apartment/unit segmentation pipeline (Phase 4).

Floor plan image -> preprocess -> segmentation -> walls -> vectorization ->
geometry/topology validation -> room detection -> apartment/unit inference ->
2D unit geometry -> 3D (local) unit volume.

Every output is MODEL OUTPUT / AI_DEMO / DEMO_RESEARCH_DATA (dataset:
CubiCasa5K). Never official Tamil Nadu cadastral, Chennai building-approval,
ULPIN, ownership or legally authoritative apartment-boundary data.
"""
from .config import settings  # noqa: F401
from .pipeline import pipeline_stages, run  # noqa: F401
