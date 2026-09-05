"""Phase 4 — FastAPI surface for floor-plan segmentation."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_floorplans_config_exposes_thresholds_and_classmap():
    r = client.get("/floorplans/config")
    assert r.status_code == 200
    body = r.json()
    assert "confHigh" in body["thresholds"]
    assert "roomSealPx" in body["thresholds"]
    assert "WALL" in body["appClasses"] and "BATHROOM" in body["appClasses"]
    assert "cubicasa5k-rooms" in body["classMap"]
    assert set(["png", "jpg", "tif"]).issubset(set(body["supportedInput"]))
    assert "AI_DEMO" in body["disclaimer"] or "MODEL OUTPUT" in body["disclaimer"]
    assert "never invented" in body["coordinatePrinciple"].lower()


def test_health_still_lists_service_after_phase4():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "landstack-ai"


def test_infer_endpoint_on_synthetic_plan(floorplan_bytes):
    r = client.post(
        "/floorplans/infer",
        files={"image": ("floorplan_demo.png", floorplan_bytes, "image/png")},
        data={"job_id": "FPJOB-TEST", "scale_m_per_px": "0.02",
              "floor_elevation_m": "6", "floor_height_m": "3",
              "building_id": "TN-CHN-123456789-B01", "floor_id": "TN-CHN-123456789-B01-F02"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["servedBy"].startswith("ai-service")
    assert body["jobId"] == "FPJOB-TEST"
    assert body["buildingId"] == "TN-CHN-123456789-B01"
    assert body["source"] == "AI_DEMO"
    assert body["status"] in ("COMPLETED", "NO_STRUCTURE")
    assert len(body["units"]) >= 1


def test_infer_endpoint_rejects_non_image_with_200_failed():
    r = client.post(
        "/floorplans/infer",
        files={"image": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "FAILED"
    assert r.json()["errorKind"] == "INVALID_INPUT"


def test_infer_endpoint_handles_missing_scale(floorplan_bytes):
    r = client.post(
        "/floorplans/infer",
        files={"image": ("fp.png", floorplan_bytes, "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["scaleMPerPx"] is None
    for u in body["units"]:
        assert u["volume"]["zmin"] is None
