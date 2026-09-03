import io

import numpy as np
from PIL import Image

from app.buildings import run


def test_geotiff_end_to_end_is_georeferenced(geotiff_bytes):
    r = run(geotiff_bytes, "sholinganallur_demo.tif", {})
    assert r["status"] in ("COMPLETED", "NO_BUILDINGS")
    assert r["source"] == "AI_DEMO"
    assert "MODEL OUTPUT" in r["disclaimer"] or "AI_DEMO" in r["disclaimer"]
    assert r["georeferenced"] is True
    assert r["geoStatus"] == "GEOREFERENCED"
    assert r["model"] == "classical-cv"
    assert r["summary"]["total"] >= 1
    for b in r["buildings"]:
        assert b["polygon"] and b["polygon"]["type"] == "Polygon"
        lon, lat = b["polygon"]["coordinates"][0][0]
        assert 80.0 < lon < 80.5 and 12.7 < lat < 13.2   # Chennai bbox
        assert b["height"] is None
        assert b["heightStatus"] == "UNAVAILABLE"
        assert b["confidenceLevel"] in ("HIGH", "MEDIUM", "LOW")
        assert b["geometryStatus"] in ("VALID", "WARNING", "ERROR")


def test_plain_png_is_non_georeferenced_no_coords(png_bytes):
    r = run(png_bytes, "plain_demo.png", {})
    assert r["georeferenced"] is False
    assert r["geoStatus"] == "NON_GEOREFERENCED_AI_DEMO"
    assert r["crs"] is None
    for b in r["buildings"]:
        assert b["polygon"] is None              # NEVER invents coordinates
        assert len(b["pixelPolygon"]) >= 4       # pixel-space geometry only


def test_invalid_input_returns_failed_not_exception():
    r = run(b"", "x.png", {})
    assert r["status"] == "FAILED"
    assert r["errorKind"] == "INVALID_INPUT"

    r2 = run(b"nope", "x.txt", {})
    assert r2["status"] == "FAILED"


def test_blank_image_completes_with_no_buildings():
    buf = io.BytesIO()
    Image.fromarray(np.full((64, 64, 3), 30, dtype="uint8")).save(buf, format="PNG")
    r = run(buf.getvalue(), "blank.png", {})
    assert r["status"] in ("NO_BUILDINGS", "COMPLETED")
    assert r["summary"]["total"] == len(r["buildings"])
