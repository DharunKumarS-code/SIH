"""LAND STACK — elevation / LiDAR / DEM / DSM pipeline (Phase 5, additive).

    LAS/LAZ point cloud  -\
                           +-> ground classification -> DEM  -\
    DEM raster (direct)  -/                                    +-> DSM - DEM
    DSM raster (direct)  ----> surface classification -> DSM  -/      -> building height

Every result is MODEL OUTPUT / estimated. Real, authoritative Chennai LiDAR/DEM/
DSM data has not been sourced for this prototype — see docs/17. Inputs are
labelled ELEVATION_DEMO / RESEARCH_DATA / TEST_FIXTURE / MODEL_OUTPUT and this
package never fabricates a value it cannot derive from real input.
"""
from .config import settings
from .pipeline import pipeline_stages, run_process, run_validate

__all__ = ["settings", "pipeline_stages", "run_process", "run_validate"]
