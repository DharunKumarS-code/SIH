"""Phase 7 — deterministic 2D polygon geometry unit tests.

All coordinates are synthetic/TEST_FIXTURE, near the same Sholinganallur demo
reference point used by the GNSS/elevation fixtures — never real Chennai
survey data.
"""
from app.topology.geometry import analyze_polygon, pair_metrics, to_planar_ring

LON, LAT = 80.22705, 12.90045


def square_ring(lon, lat, half_deg=0.0005):
    return [
        [lon - half_deg, lat - half_deg],
        [lon + half_deg, lat - half_deg],
        [lon + half_deg, lat + half_deg],
        [lon - half_deg, lat + half_deg],
        [lon - half_deg, lat - half_deg],
    ]


def bowtie_ring(lon, lat, half_deg=0.0005):
    # A self-crossing "bowtie" quadrilateral — the classic self-intersection fixture.
    return [
        [lon - half_deg, lat - half_deg],
        [lon + half_deg, lat + half_deg],
        [lon + half_deg, lat - half_deg],
        [lon - half_deg, lat + half_deg],
        [lon - half_deg, lat - half_deg],
    ]


def test_to_planar_ring_projects_and_rejects_short_rings():
    ring = square_ring(LON, LAT)
    planar = to_planar_ring(ring)
    assert planar is not None
    assert len(planar) == len(ring)
    assert to_planar_ring([[LON, LAT]]) is None
    assert to_planar_ring(None) is None


def test_analyze_polygon_valid_square():
    result = analyze_polygon(square_ring(LON, LAT))
    assert result["available"] is True
    assert result["isValid"] is True
    assert result["isSimple"] is True
    assert result["areaM2"] > 0


def test_analyze_polygon_self_intersecting_bowtie():
    result = analyze_polygon(bowtie_ring(LON, LAT))
    assert result["available"] is True
    assert result["isSimple"] is False
    assert result["isValid"] is False
    assert result["validityReason"]


def test_analyze_polygon_too_short_is_invalid_not_guessed():
    result = analyze_polygon([[LON, LAT], [LON + 0.001, LAT]])
    assert result["available"] is True
    assert result["isValid"] is False
    assert result["areaM2"] == 0.0
    # Never mistaken for the more specific SELF_INTERSECTION rule upstream —
    # isSimple is None (not applicable), never False, for a ring too short to
    # even form a polygon.
    assert result["isSimple"] is None


def test_pair_metrics_identical_squares_are_full_overlap():
    ring = square_ring(LON, LAT)
    m = pair_metrics(ring, ring)
    assert m["available"] is True
    assert m["intersects"] is True
    assert abs(m["iou"] - 1.0) < 1e-6


def test_pair_metrics_disjoint_squares_do_not_intersect():
    a = square_ring(LON, LAT)
    b = square_ring(LON + 0.01, LAT + 0.01)
    m = pair_metrics(a, b)
    assert m["available"] is True
    assert m["intersects"] is False
    assert m["overlapAreaM2"] == 0.0
    assert m["iou"] == 0.0


def test_pair_metrics_partial_overlap_between_zero_and_one():
    a = square_ring(LON, LAT, half_deg=0.0006)
    b = square_ring(LON + 0.0006, LAT, half_deg=0.0006)
    m = pair_metrics(a, b)
    assert m["available"] is True
    assert m["intersects"] is True
    assert 0.0 < m["iou"] < 1.0
    assert m["overlapAreaM2"] > 0.0
