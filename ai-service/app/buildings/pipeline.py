"""Building-extraction pipeline orchestrator.

    image bytes
      -> preprocess (decode / validate / cap / normalise / georef metadata)
      -> segment    (classical CV default, optional U-Net) per tile, stitched
      -> threshold  -> binary building mask
      -> polygonise (connected components -> contours -> shapely -> simplify -> repair)
      -> validate   (validity / self-intersection / area / duplicate / overlap / bounds)
      -> georeference (WGS84 lon/lat for GeoTIFF; pixel space + NON_GEOREF flag otherwise)
      -> confidence (HIGH / MEDIUM / LOW) + reviewRequired
      -> building candidates + summary

Every result is MODEL OUTPUT / AI_DEMO. Never official data.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from .confidence import level_for, review_required
from .config import settings
from .georef import to_geographic
from .polygonize import mask_to_polygons
from .preprocessing import PreprocessError, prepare, tiles
from .segmentation import get_segmenter
from .validation import validate

pipeline_stages = [
    "Imagery",
    "Image preprocessing",
    "AI building segmentation",
    "Building mask",
    "Post-processing",
    "Polygon extraction",
    "GIS geometry validation",
    "Confidence classification",
    "Building candidates",
]


def _stitch(prepared) -> np.ndarray:
    seg, note = get_segmenter()
    prob = np.zeros_like(prepared.gray, dtype=np.float32)
    count = np.zeros_like(prepared.gray, dtype=np.float32)
    for y0, x0, sub in tiles(prepared):
        p = seg.probability(sub)
        h, w = p.shape
        prob[y0 : y0 + h, x0 : x0 + w] += p
        count[y0 : y0 + h, x0 : x0 + w] += 1.0
    count[count == 0] = 1.0
    return prob / count, seg, note


def run(image_bytes: bytes, filename: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    started = datetime.now(timezone.utc).isoformat()

    try:
        prepared = prepare(image_bytes, filename)
    except PreprocessError as e:
        # caller (Node) maps this to HTTP 400 — it is a client input problem
        return {
            "status": "FAILED",
            "error": str(e),
            "errorKind": "INVALID_INPUT",
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    try:
        prob, seg, seg_note = _stitch(prepared)
    except Exception as e:  # segmentation backend blew up -> graceful, not a crash
        return {
            "status": "MODEL_NOT_AVAILABLE",
            "error": f"segmentation failed: {e}",
            "model": settings.model,
            "georeferenced": prepared.georeferenced,
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    candidates = mask_to_polygons(prob)
    for idx, c in enumerate(candidates):
        c["local_id"] = idx + 1
    candidates = validate(candidates, prepared.width, prepared.height)

    buildings = []
    for c in candidates:
        polygon_geo = None
        area_m2 = None
        ring_geo, geo_status, area_from_geo = to_geographic(c["pixel_polygon"], prepared)
        if ring_geo is not None:
            polygon_geo = {"type": "Polygon", "coordinates": [ring_geo]}
            area_m2 = area_from_geo

        # georef min-area filter (pixel filter already applied in polygonize)
        if area_m2 is not None and area_m2 < settings.min_building_area_m2:
            c["geometry_status"] = "WARNING"
            c["geometry_issues"] = list(c.get("geometry_issues", [])) + [
                f"below minimum building area ({area_m2} m2 < {settings.min_building_area_m2})"
            ]

        conf = float(c["confidence"])
        clvl = level_for(conf)
        gstatus = c["geometry_status"]
        buildings.append(
            {
                "localId": c["local_id"],
                "polygon": polygon_geo,                       # GeoJSON WGS84 or None
                "pixelPolygon": [[round(x, 2), round(y, 2)] for x, y in c["pixel_polygon"]],
                "confidence": conf,
                "confidenceLevel": clvl,
                "geometryStatus": gstatus,
                "geometryIssues": c.get("geometry_issues", []),
                "duplicateOf": c.get("duplicate_of"),
                "overlaps": c.get("overlaps", []),
                "areaM2": area_m2,
                "areaPx": round(c["area_px"], 1),
                "bboxPx": c["bbox_px"],
                "height": None,
                "heightStatus": "UNAVAILABLE",
                "reviewRequired": review_required(clvl, gstatus),
            }
        )

    georeferenced = bool(prepared.georeferenced) and any(b["polygon"] for b in buildings)
    status = "COMPLETED" if buildings else "NO_BUILDINGS"

    summary = {
        "total": len(buildings),
        "high": sum(b["confidenceLevel"] == "HIGH" for b in buildings),
        "medium": sum(b["confidenceLevel"] == "MEDIUM" for b in buildings),
        "low": sum(b["confidenceLevel"] == "LOW" for b in buildings),
        "invalidGeometry": sum(b["geometryStatus"] == "ERROR" for b in buildings),
        "warningGeometry": sum(b["geometryStatus"] == "WARNING" for b in buildings),
        "duplicates": sum(b["duplicateOf"] is not None for b in buildings),
        "reviewRequired": sum(b["reviewRequired"] for b in buildings),
    }

    notes = list(prepared.notes)
    if seg_note:
        notes.append(seg_note)

    return {
        "status": status,
        "model": getattr(seg, "key", settings.model),
        "modelName": getattr(seg, "name", settings.model),
        "modelVersion": getattr(seg, "version", "0"),
        "pipeline": pipeline_stages,
        "georeferenced": georeferenced,
        "geoStatus": "GEOREFERENCED" if georeferenced else "NON_GEOREFERENCED_AI_DEMO",
        "crs": prepared.crs if georeferenced else None,
        "sourceCrs": prepared.crs,
        "imageSize": {"width": prepared.width, "height": prepared.height, "kind": prepared.kind},
        "resolutionM": prepared.resolution_m,
        "bounds": prepared.bounds,
        "thresholds": {
            "buildingConfidenceThreshold": settings.building_confidence_threshold,
            "confHigh": settings.conf_high,
            "confMed": settings.conf_med,
        },
        "buildings": buildings,
        "summary": summary,
        "notes": notes,
        "source": "AI_DEMO",
        "disclaimer": settings.disclaimer,
        "generatedAt": started,
    }
