from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_lists_service():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "landstack-ai"


def test_buildings_config_exposes_thresholds():
    r = client.get("/buildings/config")
    assert r.status_code == 200
    body = r.json()
    assert "buildingConfidenceThreshold" in body["thresholds"]
    assert "AI_DEMO" in body["disclaimer"] or "MODEL OUTPUT" in body["disclaimer"]
    assert set(["png", "tif"]).issubset(set(body["supportedInput"]))


def test_infer_endpoint_georeferenced(geotiff_bytes):
    r = client.post(
        "/buildings/infer",
        files={"image": ("sholinganallur_demo.tif", geotiff_bytes, "image/tiff")},
        data={"locality": "sholinganallur"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "AI_DEMO"
    assert body["servedBy"].startswith("ai-service")
    assert body["locality"] == "sholinganallur"
    assert body["status"] in ("COMPLETED", "NO_BUILDINGS")


def test_infer_endpoint_rejects_non_image():
    r = client.post(
        "/buildings/infer",
        files={"image": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "FAILED"
