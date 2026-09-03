from shapely.geometry import Polygon

from app.buildings.validation import validate


def _cand(geom, i, status="VALID"):
    return {
        "geom": geom,
        "local_id": i,
        "geometry_status": status,
        "geometry_issues": [],
        "pixel_polygon": list(geom.exterior.coords) if geom else [],
        "confidence": 0.8,
        "area_px": geom.area if geom else 0.0,
        "bbox_px": [0, 0, 10, 10],
    }


def test_duplicate_detected():
    a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    b = Polygon([(0.1, 0.1), (10, 0), (10, 10), (0, 10)])  # ~identical
    out = validate([_cand(a, 1), _cand(b, 2)], 100, 100)
    assert out[1]["duplicate_of"] == 1
    assert out[1]["geometry_status"] == "WARNING"


def test_overlap_flagged_not_marked_duplicate():
    a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    b = Polygon([(5, 5), (15, 5), (15, 15), (5, 15)])  # ~14% IoU -> below flag? make bigger overlap
    b = Polygon([(3, 3), (13, 3), (13, 13), (3, 13)])
    out = validate([_cand(a, 1), _cand(b, 2)], 100, 100)
    assert out[1]["duplicate_of"] is None
    assert out[1]["overlaps"] and out[1]["geometry_status"] == "WARNING"


def test_none_geometry_is_error_not_dropped():
    out = validate([_cand(None, 1)], 100, 100)
    assert len(out) == 1
    assert out[0]["geometry_status"] == "ERROR"


def test_centroid_out_of_bounds_flagged():
    far = Polygon([(200, 200), (210, 200), (210, 210), (200, 210)])
    out = validate([_cand(far, 1)], 100, 100)
    assert any("bounds" in msg for msg in out[0]["geometry_issues"])
