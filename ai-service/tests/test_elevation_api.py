import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_elevation_config_exposes_thresholds():
    r = client.get("/elevation/config")
    assert r.status_code == 200
    body = r.json()
    assert "footprintBufferM" in body["thresholds"]
    assert "ELEVATION_DEMO" in body["disclaimer"]


def test_elevation_validate_dem(elev_fixture):
    r = client.post(
        "/elevation/validate",
        files={"file": ("dem_flat.tif", elev_fixture("dem_flat.tif"), "image/tiff")},
        data={"dataset_type": "DEM", "source_label": "TEST_FIXTURE"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "VALIDATED"
    assert body["metadata"]["crs"] == "EPSG:32644"


def test_elevation_validate_pointcloud(elev_fixture):
    r = client.post(
        "/elevation/validate",
        files={"file": ("points_classified.las", elev_fixture("points_classified.las"), "application/octet-stream")},
        data={"dataset_type": "POINTCLOUD"},
    )
    assert r.status_code == 200
    assert r.json()["metadata"]["pointCount"] == 3600


def test_elevation_validate_rejects_malformed_input(elev_fixture):
    r = client.post(
        "/elevation/validate",
        files={"file": ("bad.las", elev_fixture("points_malformed.las"), "application/octet-stream")},
        data={"dataset_type": "POINTCLOUD"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "FAILED"
    assert body["errorKind"] == "INVALID_INPUT"


def test_elevation_process_dem_dsm_pair(elev_fixture, elev_footprints):
    r = client.post(
        "/elevation/process",
        files={
            "dem": ("dem_flat.tif", elev_fixture("dem_flat.tif"), "image/tiff"),
            "dsm": ("dsm_building.tif", elev_fixture("dsm_building.tif"), "image/tiff"),
        },
        data={"footprints": json.dumps(elev_footprints), "source_label": "TEST_FIXTURE"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "COMPLETED"
    assert body["servedBy"].startswith("ai-service")
    assert body["buildings"][0]["buildingHeightM"] == 20.0


def test_elevation_process_without_data_is_graceful(elev_footprints):
    r = client.post("/elevation/process", data={"footprints": json.dumps(elev_footprints)})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "COMPLETED"
    assert body["buildings"][0]["qualityStatus"] == "ERROR"


def test_elevation_process_bad_footprints_json_is_invalid_input():
    r = client.post("/elevation/process", data={"footprints": "{not json"})
    assert r.status_code == 200
    assert r.json()["errorKind"] == "INVALID_INPUT"
