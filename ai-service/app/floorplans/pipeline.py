"""AI floor-plan segmentation pipeline orchestrator (Phase 4).

    image bytes
      -> preprocess   (decode / validate / cap / normalise / optional scale)
      -> segment      (classical CV default, optional semantic head) per tile, stitched
      -> wall mask    -> wall regions + centrelines
      -> rooms        (interior free space -> connected components -> polygons -> heuristic type)
      -> topology     (room graph + doors / openings)
      -> units        (apartment / property-unit inference from the graph)
      -> validation   (deterministic geometry + topology checks)
      -> 3D conversion (LOCAL floor-plan box per unit; z only if an elevation/height is supplied)
      -> envelope

Every result is MODEL OUTPUT / AI_DEMO / DEMO_RESEARCH_DATA. Never official
Tamil Nadu cadastral / Chennai building / ULPIN / ownership data. Coordinates
stay in a LOCAL floor-plan reference — no latitude/longitude is ever invented.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from .classmap import mapping_report
from .confidence import level_for, review_required
from .config import settings
from .preprocessing import PreprocessError, prepare, tiles
from .rooms import detect_rooms
from .segmentation import get_segmenter
from .topology import build_topology
from .units import infer_units
from .validation import validate
from .walls import detect_walls

pipeline_stages = [
    "Floor plan image",
    "Preprocessing",
    "AI semantic segmentation",
    "Structural elements (walls)",
    "Vectorization",
    "Geometry / topology validation",
    "Room detection",
    "Apartment / unit boundary inference",
    "Building / floor association (API layer)",
    "2D unit geometry",
    "3D unit volume",
    "Existing Chennai Cesium viewer",
]


def _stitch(prepared):
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


def _unit_volume(unit, prepared, floor_elevation_m, floor_height_m):
    """LOCAL axis-aligned box for a unit. x/y in metres if scale known, else px.
    z present only when a floor elevation/height is supplied by the caller."""
    minx, miny, maxx, maxy = unit["bboxPx"]
    s = prepared.scale_m_per_px
    if s:
        xmin, xmax = round(minx * s, 3), round(maxx * s, 3)
        ymin, ymax = round(miny * s, 3), round(maxy * s, 3)
        units = "M"
    else:
        xmin, xmax, ymin, ymax = minx, maxx, miny, maxy
        units = "PX"
    zmin = zmax = None
    height_status = "UNAVAILABLE"
    if floor_elevation_m is not None and floor_height_m is not None:
        zmin = round(float(floor_elevation_m), 3)
        zmax = round(float(floor_elevation_m) + float(floor_height_m), 3)
        height_status = "ESTIMATED"  # DEMO — never survey-grade
    return {
        "volumeId": f"FPV-{unit['featureId'].split('-')[-1]}",
        "coordinateReference": prepared.crs,
        "linearUnit": units,
        "xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax,
        "zmin": zmin, "zmax": zmax,
        "heightStatus": height_status,
        "prototype": True,
        "label": "AI floor-plan unit volume (DEMO)",
    }


def run(image_bytes: bytes, filename: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    started = datetime.now(timezone.utc).isoformat()
    scale = opts.get("scale_m_per_px")
    floor_elevation_m = opts.get("floor_elevation_m")
    floor_height_m = opts.get("floor_height_m")

    base = {
        "source": "AI_DEMO",
        "dataClassification": settings.data_classification,
        "dataset": settings.dataset,
        "disclaimer": settings.disclaimer,
        "generatedAt": started,
        "pipeline": pipeline_stages,
    }

    try:
        prepared = prepare(image_bytes, filename, scale)
    except PreprocessError as e:
        return {**base, "status": "FAILED", "error": str(e), "errorKind": "INVALID_INPUT"}

    try:
        prob, seg, seg_note = _stitch(prepared)
    except Exception as e:  # segmentation backend blew up -> graceful, not a crash
        return {
            **base,
            "status": "MODEL_NOT_AVAILABLE",
            "error": f"segmentation failed: {e}",
            "model": settings.model,
        }

    wmask, wall_features, centrelines = detect_walls(prob)
    rooms = detect_rooms(wmask, prob, prepared.scale_m_per_px)
    nodes, edges, doors = build_topology(rooms)
    units, common_areas, unclassified = infer_units(rooms, nodes, edges, prepared.scale_m_per_px)

    report = validate(
        rooms=rooms, units=units, common_areas=common_areas, unclassified=unclassified,
        doors=doors, nodes=nodes, edges=edges,
        width=prepared.width, height=prepared.height, scale_m_per_px=prepared.scale_m_per_px,
    )

    # ---- assemble serialisable features (strip shapely handles) ----
    def _room_out(r):
        clvl = level_for(r["confidence"])
        return {
            "roomId": r["featureId"],
            "featureId": r["featureId"],
            "class": r["class"],
            "roomType": r["roomType"],
            "polygon": {"type": "Polygon", "coordinates": [r["pixelPolygon"]]} if r["pixelPolygon"] else None,
            "pixelPolygon": r["pixelPolygon"],
            "bboxPx": r["bboxPx"],
            "area": r["area"],
            "areaPx": r["areaPx"],
            "areaUnit": r["areaUnit"],
            "areaStatus": r["areaStatus"],
            "confidence": r["confidence"],
            "confidenceLevel": clvl,
            "typeConfidence": r["typeConfidence"],
            "geometryStatus": r["geometryStatus"],
            "geometryIssues": r["geometryIssues"],
            "source": "AI_DEMO",
            "model": getattr(seg, "key", settings.model),
            "modelVersion": getattr(seg, "version", "0"),
            "reviewRequired": bool(review_required(clvl, r["geometryStatus"], ambiguous=r["reviewRequired"])),
        }

    def _unit_out(u):
        clvl = level_for(u["confidence"])
        return {
            "unitId": u["localUnitId"],
            "featureId": u["featureId"],
            "rooms": u["rooms"],
            "roomTypes": u["roomTypes"],
            "unitBoundary": u["unitBoundary"],
            "pixelPolygon": u["pixelPolygon"],
            "bboxPx": u["bboxPx"],
            "area": u["area"],
            "areaPx": u["areaPx"],
            "areaUnit": u["areaUnit"],
            "areaStatus": u["areaStatus"],
            "confidence": u["confidence"],
            "confidenceLevel": clvl,
            "geometryStatus": u["geometryStatus"],
            "ambiguityReasons": u["ambiguityReasons"],
            "volume": _unit_volume(u, prepared, floor_elevation_m, floor_height_m),
            "source": "AI_DEMO",
            "model": getattr(seg, "key", settings.model),
            "modelVersion": getattr(seg, "version", "0"),
            "reviewRequired": bool(review_required(clvl, u["geometryStatus"], ambiguous=u["reviewRequired"])),
        }

    rooms_out = [_room_out(r) for r in rooms]
    units_out = [_unit_out(u) for u in units]
    windows = [d for d in doors if d["class"] == "WINDOW"]  # classical path emits none; kept for schema parity

    status = "COMPLETED" if (rooms_out or wall_features) else "NO_STRUCTURE"

    summary = {
        "walls": len(wall_features),
        "rooms": len(rooms_out),
        "doors": len([d for d in doors if d["class"] == "DOOR"]),
        "openings": len([d for d in doors if d["class"] == "OPENING"]),
        "windows": len(windows),
        "units": len(units_out),
        "commonAreas": len(common_areas),
        "unclassified": len(unclassified),
        "high": sum(x["confidenceLevel"] == "HIGH" for x in rooms_out + units_out),
        "medium": sum(x["confidenceLevel"] == "MEDIUM" for x in rooms_out + units_out),
        "low": sum(x["confidenceLevel"] == "LOW" for x in rooms_out + units_out),
        "invalidGeometry": sum(x["geometryStatus"] == "ERROR" for x in rooms_out + units_out),
        "reviewRequired": sum(x["reviewRequired"] for x in rooms_out + units_out),
        "validationStatus": report["status"],
    }

    notes = list(prepared.notes)
    if seg_note:
        notes.append(seg_note)

    return {
        **base,
        "status": status,
        "model": getattr(seg, "key", settings.model),
        "modelName": getattr(seg, "name", settings.model),
        "modelVersion": getattr(seg, "version", "0"),
        "modelVocab": getattr(seg, "vocab", "classical"),
        "classMap": mapping_report(),
        "crs": prepared.crs,
        "coordinateReference": prepared.coordinate_reference,
        "scaleMPerPx": prepared.scale_m_per_px,
        "imageSize": {"width": prepared.width, "height": prepared.height, "kind": prepared.kind},
        "thresholds": {
            "wallDarkThreshold": settings.wall_dark_threshold,
            "roomMinAreaPx": settings.room_min_area_px,
            "confHigh": settings.conf_high,
            "confMed": settings.conf_med,
            "duplicateIoU": settings.duplicate_iou,
            "overlapIoUFlag": settings.overlap_iou_flag,
        },
        "walls": {
            "count": len(wall_features),
            "features": [
                {k: v for k, v in f.items() if k != "geom"} for f in wall_features[:120]
            ],
            "centrelineSegments": centrelines[:600],
        },
        "rooms": rooms_out,
        "doors": [d for d in doors if d["class"] == "DOOR"],
        "openings": [d for d in doors if d["class"] == "OPENING"],
        "windows": windows,
        "units": units_out,
        "commonAreas": common_areas,
        "unclassified": unclassified,
        "topology": {"nodes": nodes, "edges": edges},
        "validation": report,
        "summary": summary,
        "notes": notes,
    }
