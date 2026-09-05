"""Phase 6 — GNSS/CORS CRS transformation unit tests.

Deterministic fixtures only: known EPSG:32644 (UTM 44N) coordinates near the
Sholinganallur demo locality centre, transformed to WGS84 and checked against
independently-computed expected lon/lat. All SYNTHETIC / TEST_FIXTURE data.
"""
from app.gnss.crs import is_geographic, normalise_crs, transform_points

# Same reference point used by the elevation fixtures (Sholinganallur demo centre).
LON, LAT = 80.22705, 12.90045


def test_normalise_crs_parses_epsg_codes():
    assert normalise_crs("EPSG:4326") is not None
    assert normalise_crs("EPSG:32644") is not None
    assert normalise_crs("not-a-real-crs-xyz") is None
    assert normalise_crs(None) is None


def test_is_geographic():
    assert is_geographic("EPSG:4326") is True
    assert is_geographic("EPSG:32644") is False
    assert is_geographic("garbage") is None


def test_transform_matched_when_source_equals_target():
    status, pts, note = transform_points([(80.0, 13.0)], "EPSG:4326", "EPSG:4326")
    assert status == "MATCHED"
    assert pts == [(80.0, 13.0)]
    assert "no transform needed" in note.lower()


def test_transform_wgs84_to_utm_and_back_round_trips():
    status, utm_pts, _ = transform_points([(LON, LAT)], "EPSG:4326", "EPSG:32644")
    assert status == "REPROJECTED"
    assert utm_pts[0] is not None
    easting, northing = utm_pts[0]
    # Sholinganallur sits in UTM zone 44N — sanity-check the magnitude, not an
    # exact literal (avoids hard-coding a second implementation's output).
    assert 200_000 < easting < 800_000
    assert 1_300_000 < northing < 1_600_000

    status2, back_pts, _ = transform_points([(easting, northing)], "EPSG:32644", "EPSG:4326")
    assert status2 == "REPROJECTED"
    back_lon, back_lat = back_pts[0]
    assert abs(back_lon - LON) < 1e-6
    assert abs(back_lat - LAT) < 1e-6


def test_transform_unknown_crs_is_not_guessed():
    status, pts, note = transform_points([(1, 2)], "totally-invalid-crs", "EPSG:4326")
    assert status == "UNKNOWN"
    assert pts == [None]
    assert "not attempted" in note.lower()


def test_transform_missing_source_crs():
    status, pts, note = transform_points([(1, 2)], None, "EPSG:4326")
    assert status == "UNKNOWN"
    assert pts == [None]
