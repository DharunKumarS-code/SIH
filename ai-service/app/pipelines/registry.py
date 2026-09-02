"""Feature registry + the building-extraction / change-detection pipeline
skeleton (spec sections 25-26). Mock implementations produce deterministic,
clearly-simulated output; swap in real InferenceModel subclasses here."""
from __future__ import annotations

import hashlib

FEATURES = [
    {"key": "building-footprint", "name": "Building Footprint Detection", "input": "Satellite / drone tile", "output": "Polygon footprints + confidence"},
    {"key": "change-detection", "name": "Change Detection", "input": "Two-date imagery", "output": "New construction / expansion / demolition"},
    {"key": "floorplan-segmentation", "name": "Floor Plan Segmentation", "input": "Scanned floor plan", "output": "Rooms / units / common areas"},
    {"key": "height-estimation", "name": "Building Height Estimation", "input": "Imagery + shadow / DSM", "output": "Height (m) + floor count"},
    {"key": "risk-detection", "name": "Property Risk Detection", "input": "Records + spatial context", "output": "Risk flags"},
]

# Building extraction pipeline stages (documented for the UI / docs).
EXTRACTION_PIPELINE = [
    "Satellite / Drone Image",
    "Preprocessing",
    "Building Segmentation",
    "Building Footprint",
    "Height Estimation",
    "3D Building Generation",
    "Floor Estimation",
    "Property Unit Mapping",
]

CHANGE_DETECTION_PIPELINE = [
    "Previous imagery",
    "Current imagery",
    "AI comparison",
    "Detected building change",
    "Officer review",
    "Update property record",
]


def _r(seed: str) -> float:
    h = hashlib.sha256(seed.encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def run_feature(feature: str, payload: dict) -> dict:
    ulpin = payload.get("ulpin", "TN-CHN-123456789")
    r = _r(feature + repr(sorted(payload.items())))

    if feature == "building-footprint":
        return {
            "pipeline": EXTRACTION_PIPELINE,
            "detections": [
                {"candidateId": f"det-B0{i}", "confidence": round(0.85 + _r(f'{ulpin}{i}') * 0.13, 3),
                 "matchedBuildingId": f"{ulpin}-B0{i}"}
                for i in range(1, 6)
            ],
            "summary": {"detected": 5, "matchedToRecords": 5},
        }

    if feature == "change-detection":
        return {
            "pipeline": CHANGE_DETECTION_PIPELINE,
            "window": {"from": payload.get("frm", "2022-01"), "to": payload.get("to", "2025-01")},
            "changes": [
                {"changeId": "chg-01", "type": "New Construction", "geometryRef": "PCL-CHN-SHLN-05", "confidence": 0.9, "review": "pending"},
                {"changeId": "chg-02", "type": "Building Expansion", "geometryRef": f"{ulpin}-B04", "confidence": 0.77, "review": "pending"},
                {"changeId": "chg-03", "type": "No Significant Change" if r > 0.5 else "Demolition", "geometryRef": "PCL-CHN-SHLN-08", "confidence": 0.6, "review": "pending"},
            ],
        }

    if feature == "floorplan-segmentation":
        fn = payload.get("floor_number", 2)
        n = payload.get("units", 6)
        segments = [
            {"label": f"U{fn * 100 + i + 1}", "class": "unit", "areaSqft": 900 + int(_r(str(i)) * 500),
             "confidence": round(0.8 + _r(str(i)) * 0.15, 3)}
            for i in range(n)
        ]
        segments += [
            {"label": "CORRIDOR", "class": "common", "areaSqft": 220, "confidence": 0.88},
            {"label": "STAIR", "class": "common", "areaSqft": 140, "confidence": 0.9},
        ]
        return {"floor": payload.get("floor", "F02"), "segments": segments}

    if feature == "height-estimation":
        return {
            "estimates": [
                {"buildingId": f"{ulpin}-B0{i}",
                 "estimatedHeightM": round(30 + _r(f'h{i}') * 20, 1),
                 "estimatedFloors": 9 + i,
                 "method": "shadow-length + DSM (simulated)"}
                for i in range(1, 6)
            ]
        }

    if feature == "risk-detection":
        return {
            "ulpin": ulpin,
            "risks": [
                {"flag": "Tax mismatch", "severity": "medium" if r > 0.6 else "low",
                 "detail": "Assessed area differs from registered built-up area for some units."},
                {"flag": "Encumbrance active", "severity": "info",
                 "detail": "Parcel carries an active mortgage per EC adapter."},
                {"flag": "Eco-sensitive proximity", "severity": "low",
                 "detail": "Within 800 m of a demo eco-sensitive buffer."},
            ],
            "compositeRiskScore": round(0.28 + r * 0.4, 2),
        }

    return {"error": f'Unknown feature "{feature}"', "known": [f["key"] for f in FEATURES]}
