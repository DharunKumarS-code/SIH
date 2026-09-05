"""LAS/LAZ point-cloud validation + chunked reading (laspy).

Chunked reading (laspy's ChunkIterator) means the raw point records are never
all resident in memory at once — only a bounded per-chunk block plus the
running DEM/DSM grids (see dem.py / dsm.py), regardless of file size, up to
`settings.max_points`.

LAZ (compressed) support depends on an optional backend (lazrs or laszip). If
none is installed, laspy raises on `.chunk_iterator()` for a LAZ file and this
module reports a clear, non-fabricated failure rather than pretending to read
compressed data.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np

from .config import settings

try:
    import laspy

    _HAS_LASPY = True
except Exception:  # pragma: no cover
    _HAS_LASPY = False


class LasError(Exception):
    """Malformed / unreadable point cloud — a client input problem (HTTP 400 upstream)."""


ASPRS_GROUND_CODE = 2


@dataclass
class LasInfo:
    pointCount: int
    bounds: dict  # xmin,xmax,ymin,ymax,zmin,zmax (native units)
    crs: str | None
    crsStatus: str
    versionMajor: int
    versionMinor: int
    pointFormatId: int
    classificationAvailable: bool
    classificationCodesPresent: list
    scales: tuple
    offsets: tuple
    notes: list
    issues: list  # [{rule, status, message}]


def _open(data: bytes):
    if not _HAS_LASPY:
        raise LasError("laspy is not available in this ai-service deployment.")
    if not data or len(data) < 4:
        raise LasError("Empty or truncated point-cloud upload.")
    magic = data[:4]
    if magic not in (b"LASF",):
        raise LasError('Not a LAS/LAZ file — missing the "LASF" file signature.')
    try:
        return laspy.open(io.BytesIO(data))
    except Exception as e:
        raise LasError(f"Could not open point cloud: {e}") from e


def validate(data: bytes) -> tuple:
    """Header + light sampling validation. Does not require a full read.
    Returns (LasInfo, status) where status is VALID | WARNING | ERROR.
    """
    with _open(data) as reader:
        header = reader.header
        issues = []
        notes = []

        point_count = int(header.point_count)
        if point_count == 0:
            issues.append({"rule": "EMPTY_POINT_CLOUD", "status": "ERROR", "message": "Point cloud contains zero points."})
        elif point_count < 50:
            issues.append({
                "rule": "INSUFFICIENT_POINT_DENSITY", "status": "WARNING",
                "message": f"Only {point_count} points — too sparse for reliable ground/surface classification.",
            })

        mins = list(header.mins)
        maxs = list(header.maxs)
        bounds = {"xmin": mins[0], "xmax": maxs[0], "ymin": mins[1], "ymax": maxs[1], "zmin": mins[2], "zmax": maxs[2]}
        for k in ("xmin", "xmax", "ymin", "ymax"):
            if not np.isfinite(bounds[k]):
                issues.append({"rule": "INVALID_COORDINATE_RANGE", "status": "ERROR", "message": f"Non-finite {k} in header bounds."})
        if bounds["xmin"] > bounds["xmax"] or bounds["ymin"] > bounds["ymax"]:
            issues.append({"rule": "INVALID_COORDINATE_RANGE", "status": "ERROR", "message": "Header min/max bounds are inverted."})
        if bounds["zmax"] - bounds["zmin"] > 5000:
            issues.append({
                "rule": "ELEVATION_RANGE_IMPLAUSIBLE", "status": "WARNING",
                "message": f"Z range spans {bounds['zmax'] - bounds['zmin']:.0f} m — check units / outlier points.",
            })

        crs = None
        try:
            crs_obj = header.parse_crs()
            crs = crs_obj.to_string() if crs_obj else None
        except Exception:
            crs = None
        crs_status = "UNKNOWN" if crs is None else "MATCHED"
        if crs is None:
            notes.append("No CRS found in LAS VLRs/GeoKeys — crsStatus UNKNOWN. Horizontal integration requires review.")

        dims = set(reader.header.point_format.dimension_names)
        classification_available = "classification" in dims
        codes_present = []
        if classification_available:
            try:
                sample = next(reader.chunk_iterator(min(point_count, settings.chunk_points)), None)
                if sample is not None:
                    codes_present = sorted(int(c) for c in np.unique(np.asarray(sample.classification)))
            except Exception:
                classification_available = False
                notes.append("Classification dimension present but unreadable — treated as unavailable.")
        if not classification_available:
            notes.append("No LiDAR classification codes available — ground classification will use the deterministic fallback heuristic (see docs/17).")
        elif ASPRS_GROUND_CODE not in codes_present:
            notes.append(f"Classification codes present {codes_present} do not include ASPRS ground (2) — fallback heuristic will be used.")

        status = "ERROR" if any(i["status"] == "ERROR" for i in issues) else ("WARNING" if issues else "VALID")

        return LasInfo(
            pointCount=point_count,
            bounds=bounds,
            crs=crs,
            crsStatus=crs_status,
            versionMajor=header.version.major,
            versionMinor=header.version.minor,
            pointFormatId=header.point_format.id,
            classificationAvailable=classification_available and ASPRS_GROUND_CODE in codes_present,
            classificationCodesPresent=codes_present,
            scales=tuple(header.scales),
            offsets=tuple(header.offsets),
            notes=notes,
            issues=issues,
        ), status


def chunk_iterator(data: bytes):
    """Yield (x, y, z, classification|None) numpy arrays, chunked, capped at
    settings.max_points total. classification is None if the dimension is
    absent (fallback ground classification must be used).
    """
    with _open(data) as reader:
        has_class = "classification" in reader.header.point_format.dimension_names
        seen = 0
        for chunk in reader.chunk_iterator(settings.chunk_points):
            if seen >= settings.max_points:
                break
            x = np.asarray(chunk.x, dtype="float64")
            y = np.asarray(chunk.y, dtype="float64")
            z = np.asarray(chunk.z, dtype="float64")
            take = min(len(x), settings.max_points - seen)
            cls = np.asarray(chunk.classification, dtype="int32")[:take] if has_class else None
            yield x[:take], y[:take], z[:take], cls
            seen += take
