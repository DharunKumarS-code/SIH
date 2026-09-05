"""Intelligent 2D/3D topology validation — deterministic geometry engine
(Phase 7).

Python's only role here (same pattern as Phase 6's app/gnss module) is the
one genuine computational-geometry gap in the Node backend: exact planar
polygon validity/self-intersection/overlap-area via shapely. Everything else
— tolerances, severity, hierarchy/containment rules, 3D volume checks,
spatial-index prefiltering, result assembly, persistence — is deterministic
JavaScript in backend/src/services/topology/ (reusing Phase 2's
geometry3d/volume.js AABB math and Phase 6's gnss/geomUtils.js ring helpers).
If this service is unreachable, the affected rules report
GEOMETRY_ENGINE_UNAVAILABLE rather than guessing a validity/overlap outcome.

No ML model is used or implied anywhere in this module.
"""
from .config import settings
from .geometry import analyze_polygon, pair_metrics, to_planar_ring

__all__ = ["settings", "analyze_polygon", "pair_metrics", "to_planar_ring"]
