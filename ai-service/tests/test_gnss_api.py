from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

LON, LAT = 80.22705, 12.90045


def test_gnss_config_exposes_pipeline_and_disclaimer():
    r = client.get("/gnss/config")
    assert r.status_code == 200
    body = r.json()
    assert "pipeline" in body
    assert "GNSS/CORS" in body["disclaimer"]


def test_gnss_transform_wgs84_to_utm():
    r = client.post("/gnss/transform", json={
        "points": [{"x": LON, "y": LAT}],
        "sourceCRS": "EPSG:4326",
        "targetCRS": "EPSG:32644",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "REPROJECTED"
    assert body["transformApplied"] is True
    assert body["points"][0]["transformStatus"] == "OK"
    assert body["servedBy"].startswith("ai-service")


def test_gnss_transform_missing_source_crs_is_unknown_not_guessed():
    r = client.post("/gnss/transform", json={"points": [{"x": 1, "y": 2}]})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "UNKNOWN"
    assert body["transformApplied"] is False


def test_gnss_transform_invalid_crs_never_fabricates_a_coordinate():
    r = client.post("/gnss/transform", json={
        "points": [{"x": 1, "y": 2}],
        "sourceCRS": "not-a-real-crs",
        "targetCRS": "EPSG:4326",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "UNKNOWN"
    assert body["points"][0]["transformStatus"] == "FAILED"
    assert body["points"][0]["x"] is None
