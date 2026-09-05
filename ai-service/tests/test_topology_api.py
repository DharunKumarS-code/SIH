from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

LON, LAT = 80.22705, 12.90045


def square(lon, lat, half_deg=0.0005):
    return [
        [lon - half_deg, lat - half_deg], [lon + half_deg, lat - half_deg],
        [lon + half_deg, lat + half_deg], [lon - half_deg, lat + half_deg],
        [lon - half_deg, lat - half_deg],
    ]


def test_topology_config_exposes_projection_and_disclaimer():
    r = client.get("/topology/config")
    assert r.status_code == 200
    body = r.json()
    assert body["projectedCRS"] == "EPSG:32644"
    assert "RULE_ENGINE" in body["disclaimer"] or "DETERMINISTIC_VALIDATION" in body["disclaimer"]


def test_topology_analyze_polygons_batch():
    r = client.post("/topology/analyze-polygons", json={
        "polygons": [
            {"id": "A", "ring": square(LON, LAT)},
            {"id": "B", "ring": [[LON, LAT], [LON + 0.001, LAT]]},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    results = {x["id"]: x for x in body["results"]}
    assert results["A"]["isValid"] is True
    assert results["B"]["isValid"] is False
    assert body["servedBy"].startswith("ai-service")


def test_topology_polygon_pairs_batch():
    r = client.post("/topology/polygon-pairs", json={
        "pairs": [
            {"idA": "A", "idB": "B", "ringA": square(LON, LAT), "ringB": square(LON, LAT)},
            {"idA": "A", "idB": "C", "ringA": square(LON, LAT), "ringB": square(LON + 0.02, LAT)},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    pairs = {(x["idA"], x["idB"]): x for x in body["results"]}
    assert pairs[("A", "B")]["iou"] > 0.99
    assert pairs[("A", "C")]["intersects"] is False
