import io

import numpy as np
import pytest
from PIL import Image

from app.buildings.preprocessing import PreprocessError, prepare, tiles


def _png(w=32, h=32) -> bytes:
    buf = io.BytesIO()
    Image.fromarray((np.random.rand(h, w, 3) * 255).astype("uint8")).save(buf, format="PNG")
    return buf.getvalue()


def test_valid_png_accepted():
    p = prepare(_png(48, 40), "sample.png")
    assert p.kind == "png"
    assert p.width == 48 and p.height == 40
    assert p.gray.dtype == np.float32 and 0.0 <= float(p.gray.min()) and float(p.gray.max()) <= 1.0
    assert p.georeferenced is False


def test_valid_jpeg_accepted():
    buf = io.BytesIO()
    Image.fromarray((np.random.rand(20, 20, 3) * 255).astype("uint8")).save(buf, format="JPEG")
    p = prepare(buf.getvalue(), "x.JPG")
    assert p.kind == "jpeg"


def test_geotiff_is_georeferenced(geotiff_bytes):
    p = prepare(geotiff_bytes, "sholinganallur_demo.tif")
    assert p.kind == "geotiff"
    assert p.georeferenced is True
    assert p.crs and "EPSG" in p.crs
    assert p.transform and len(p.transform) == 6
    assert p.resolution_m and p.resolution_m > 0


def test_empty_upload_rejected():
    with pytest.raises(PreprocessError):
        prepare(b"", "a.png")


def test_bad_extension_rejected():
    with pytest.raises(PreprocessError):
        prepare(b"whatever", "notes.txt")


def test_corrupt_image_rejected():
    with pytest.raises(PreprocessError):
        prepare(b"not-an-image-at-all", "broken.png")


def test_large_image_is_capped(monkeypatch):
    from app.buildings import preprocessing as pp

    monkeypatch.setattr(pp.settings, "max_image_px", 64, raising=False)
    p = prepare(_png(400, 300), "big.png")
    assert max(p.width, p.height) <= 64
    assert any("downsampled" in n for n in p.notes)


def test_tiling_single_window_for_small_image():
    p = prepare(_png(32, 32), "s.png")
    windows = list(tiles(p))
    assert len(windows) == 1 and windows[0][0] == 0 and windows[0][1] == 0
