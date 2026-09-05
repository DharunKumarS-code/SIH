"""Phase 4 — AI floor-plan & apartment/unit segmentation pipeline tests.

Deterministic; no internet; uses the small synthetic fixture
(``tests/fixtures/floorplan_demo.png``).
"""
import io

import numpy as np
import pytest
from PIL import Image

from app.floorplans import run
from app.floorplans.classmap import normalise
from app.floorplans.config import APP_CLASSES
from app.floorplans.preprocessing import PreprocessError, prepare, tiles


# --------------------------------------------------------------- preprocessing
def test_prepare_rejects_empty_and_unsupported():
    with pytest.raises(PreprocessError):
        prepare(b"", "x.png")
    with pytest.raises(PreprocessError):
        prepare(b"not-an-image", "x.txt")            # extension
    with pytest.raises(PreprocessError):
        prepare(b"GIF89a-nope", "x.png")             # content sniff, not just ext


def test_prepare_rejects_tiny_image():
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), "white").save(buf, format="PNG")
    with pytest.raises(PreprocessError):
        prepare(buf.getvalue(), "tiny.png")


def test_prepare_local_pixel_crs_without_scale(floorplan_bytes):
    p = prepare(floorplan_bytes, "fp.png")
    assert p.crs == "LOCAL_FLOORPLAN_PIXEL"
    assert p.scale_m_per_px is None
    assert p.coordinate_reference["scaleMPerPx"] is None
    assert "latitude" not in p.coordinate_reference["note"].lower() or "no latitude" in p.coordinate_reference["note"].lower()


def test_prepare_local_metre_crs_with_scale(floorplan_bytes):
    p = prepare(floorplan_bytes, "fp.png", scale_m_per_px=0.02)
    assert p.crs == "LOCAL_FLOORPLAN_METRE"
    assert p.scale_m_per_px == 0.02


def test_tiling_yields_at_least_one_window(floorplan_bytes):
    p = prepare(floorplan_bytes, "fp.png")
    windows = list(tiles(p))
    assert len(windows) >= 1
    assert all(w[2].size for w in windows)


# ----------------------------------------------------------------- class map
def test_classmap_is_explicit_and_falls_back_to_other():
    assert normalise("Kitchen", "cubicasa5k-rooms") == "KITCHEN"
    assert normalise("Bed Room", "cubicasa5k-rooms") == "BEDROOM"
    assert normalise("Door", "cubicasa5k-icons") == "DOOR"
    assert normalise("Window", "cubicasa5k-icons") == "WINDOW"
    assert normalise("something-unmapped", "cubicasa5k-rooms") == "OTHER"
    assert normalise("wall", "classical") == "WALL"


# -------------------------------------------------------------- full pipeline
def test_pipeline_end_to_end_on_synthetic_plan(floorplan_bytes):
    r = run(floorplan_bytes, "floorplan_demo.png", {})
    assert r["status"] == "COMPLETED"
    assert r["source"] == "AI_DEMO"
    assert r["dataClassification"] == "DEMO_RESEARCH_DATA"
    assert r["dataset"] == "CubiCasa5K"
    assert "not official" in r["disclaimer"].lower()
    assert r["model"] == "classical-cv"

    # walls + rooms detected
    assert r["walls"]["count"] >= 1
    assert len(r["rooms"]) >= 4
    for rm in r["rooms"]:
        assert rm["class"] in APP_CLASSES
        assert rm["confidenceLevel"] in ("HIGH", "MEDIUM", "LOW")
        assert rm["geometryStatus"] in ("VALID", "WARNING", "ERROR")
        assert rm["source"] == "AI_DEMO"

    # multiple apartments inferred + a common area for the corridor
    assert len(r["units"]) >= 2, [u["roomTypes"] for u in r["units"]]
    assert any(c["class"] in ("CORRIDOR", "STAIR") for c in r["commonAreas"])
    # units do not simply equal rooms
    assert len(r["units"]) < len(r["rooms"])

    for u in r["units"]:
        assert u["unitId"].startswith("AI-UNIT-")
        assert "ULPIN" not in u["unitId"]
        assert u["source"] == "AI_DEMO"
        assert len(u["rooms"]) >= 1
        assert u["volume"]["prototype"] is True


def test_pipeline_without_scale_reports_pixel_area_and_no_z(floorplan_bytes):
    r = run(floorplan_bytes, "fp.png", {})
    assert r["scaleMPerPx"] is None
    assert r["crs"] == "LOCAL_FLOORPLAN_PIXEL"
    for rm in r["rooms"]:
        assert rm["areaUnit"] == "PIXEL_SQUARED"
        assert rm["areaStatus"] == "SCALE_UNAVAILABLE"
    for u in r["units"]:
        assert u["volume"]["zmin"] is None and u["volume"]["zmax"] is None
        assert u["volume"]["heightStatus"] == "UNAVAILABLE"
    # missing-scale + missing-elevation are surfaced by validation
    rules = {i["rule"] for i in r["validation"]["issues"]}
    assert "SCALE_PRESENT" in rules
    assert "ELEVATION_PRESENT" in rules


def test_pipeline_with_scale_and_floor_reference_produces_metric_volume(floorplan_bytes):
    r = run(floorplan_bytes, "fp.png",
            {"scale_m_per_px": 0.02, "floor_elevation_m": 6.0, "floor_height_m": 3.0})
    assert r["crs"] == "LOCAL_FLOORPLAN_METRE"
    for rm in r["rooms"]:
        assert rm["areaUnit"] == "M2"
    for u in r["units"]:
        v = u["volume"]
        assert v["linearUnit"] == "M"
        assert v["zmin"] == 6.0 and v["zmax"] == 9.0
        assert v["heightStatus"] == "ESTIMATED"      # DEMO, never survey-grade
        assert v["xmin"] < v["xmax"] and v["ymin"] < v["ymax"]


def test_low_confidence_or_invalid_geometry_forces_review(floorplan_bytes):
    r = run(floorplan_bytes, "fp.png", {})
    for f in r["rooms"] + r["units"]:
        if f["confidenceLevel"] == "LOW" or f["geometryStatus"] != "VALID":
            assert f["reviewRequired"] is True


def test_invalid_input_returns_failed_not_exception():
    r = run(b"", "x.png", {})
    assert r["status"] == "FAILED"
    assert r["errorKind"] == "INVALID_INPUT"
    assert r["source"] == "AI_DEMO"

    r2 = run(b"nope", "x.bmp", {})
    assert r2["status"] == "FAILED"


def test_blank_image_completes_without_fabricating_units():
    buf = io.BytesIO()
    Image.fromarray(np.full((200, 200, 3), 250, dtype="uint8")).save(buf, format="PNG")
    r = run(buf.getvalue(), "blank.png", {})
    assert r["status"] in ("COMPLETED", "NO_STRUCTURE")
    assert r["summary"]["units"] == len(r["units"])
    # a blank sheet must not invent apartments
    assert len(r["units"]) == 0


def test_topology_graph_is_consistent(floorplan_bytes):
    r = run(floorplan_bytes, "fp.png", {})
    node_ids = {n["id"] for n in r["topology"]["nodes"]}
    for e in r["topology"]["edges"]:
        assert e["from"] in node_ids and e["to"] in node_ids
    for d in r["doors"]:
        assert len(d["connectedRooms"]) == 2


def test_validation_catalogue_runs_and_grades(floorplan_bytes):
    r = run(floorplan_bytes, "fp.png", {})
    v = r["validation"]
    assert v["status"] in ("VALID", "WARNING", "ERROR")
    assert set(v["counts"]) >= {"valid", "warning", "error"}
    for issue in v["issues"]:
        assert {"rule", "message", "featureId", "severity"} <= set(issue)


def test_no_official_identifiers_anywhere(floorplan_bytes):
    import json
    r = run(floorplan_bytes, "fp.png", {"scale_m_per_px": 0.02})
    blob = json.dumps(r)
    assert "isOfficial\": true" not in blob
    assert "OFFICIAL" not in blob.replace("NOT official", "").upper() or "DEMO" in blob.upper()
    for u in r["units"]:
        assert not u["unitId"].startswith("TN-")
