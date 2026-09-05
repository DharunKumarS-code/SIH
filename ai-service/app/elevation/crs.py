"""CRS / vertical-datum comparison helpers (spec section 5 — CRITICAL).

Horizontal CRS mismatches between a DEM and a DSM are detected here and
reported as `crsStatus`. This module NEVER silently reprojects a whole raster;
per-building sampling instead re-projects the (always WGS84) footprint into
each raster's own CRS independently (see raster_io.sample_footprint), which
sidesteps needing a combined DEM/DSM reprojection while still keeping every
comparison honest and logged.

Vertical datum is not something rasterio/pyproj can reliably read off a plain
GeoTIFF, so it is treated as caller-supplied metadata (`verticalDatum` form
field). Two datasets are only compared when both declare one; otherwise the
result is explicitly UNKNOWN rather than assumed to match.
"""
from __future__ import annotations

try:
    from pyproj import CRS

    _HAS_PYPROJ = True
except Exception:  # pragma: no cover
    _HAS_PYPROJ = False


def normalise_crs(crs_like) -> "CRS | None":
    if not crs_like or not _HAS_PYPROJ:
        return None
    try:
        return CRS.from_user_input(crs_like)
    except Exception:
        return None


def compare_horizontal_crs(crs_a, crs_b) -> tuple[str, str]:
    """Return (status, note). status in CRS_STATUS."""
    a = normalise_crs(crs_a)
    b = normalise_crs(crs_b)
    if a is None or b is None:
        return "UNKNOWN", "Horizontal CRS is missing or unparsable for one or both datasets — review required."
    if a.equals(b):
        return "MATCHED", f"Horizontal CRS matches ({a.to_string()})."
    if a.to_authority() and a.to_authority() == b.to_authority():
        return "MATCHED", f"Horizontal CRS matches ({':'.join(a.to_authority())})."
    return "MISMATCH", f"Horizontal CRS differs: {a.to_string()} vs {b.to_string()}. Not combined without an explicit transform."


def compare_vertical_datum(datum_a: str | None, datum_b: str | None) -> tuple[str, str]:
    if not datum_a or not datum_b:
        return "UNKNOWN", "Vertical datum was not supplied for one or both datasets — cannot be confirmed, not assumed."
    if str(datum_a).strip().upper() == str(datum_b).strip().upper():
        return "MATCHED", f"Vertical datum matches ({datum_a})."
    return "MISMATCH", f"Vertical datum differs: {datum_a} vs {datum_b}. Heights are not reconciled across datums."


def combined_status(h_status: str, v_status: str) -> str:
    """Worst-of rollup used for the dataset-pair `crsStatus` field."""
    rank = {"MATCHED": 0, "REPROJECTED": 1, "UNKNOWN": 2, "MISMATCH": 3}
    return h_status if rank.get(h_status, 2) >= rank.get(v_status, 2) else v_status
