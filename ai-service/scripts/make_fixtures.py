"""One-off: generate the test fixtures.

  ai-service/tests/fixtures/sholinganallur_demo.tif   georeferenced (EPSG:32644)
  ai-service/tests/fixtures/plain_demo.png            non-georeferenced

The GeoTIFF places a few bright "roofs" over the Sholinganallur demo parcel
centre (matches backend/src/data/localities.js BASE) so the end-to-end
parcel-association path can be exercised. It is SYNTHETIC / AI_DEMO imagery.

Run:  python ai-service/scripts/make_fixtures.py
"""
from __future__ import annotations

import pathlib

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin

FIX = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures"
FIX.mkdir(parents=True, exist_ok=True)

# Sholinganallur demo centre (WGS84) — keep in sync with localities.js
BASE_LON, BASE_LAT = 80.22705, 12.90045
SIZE = 256
RES_M = 0.5  # metres / pixel  -> 128 m square


def _canvas() -> np.ndarray:
    rng = np.random.default_rng(20260903)
    img = (rng.normal(60, 12, (SIZE, SIZE)).clip(0, 255)).astype(np.uint8)  # dark ground + noise
    roofs = [
        (40, 40, 95, 90),    # inside parcel
        (120, 60, 175, 130),  # inside parcel
        (70, 150, 130, 205),  # inside parcel
        (200, 200, 250, 250),  # near / over the parcel edge -> review / multi
    ]
    for x0, y0, x1, y1 in roofs:
        img[y0:y1, x0:x1] = np.uint8(215)
        img[y0:y1, x0 : x0 + 2] = 235
        img[y0 : y0 + 2, x0:x1] = 235
    return img


def make_geotiff() -> pathlib.Path:
    img = _canvas()
    tf = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)
    cx, cy = tf.transform(BASE_LON, BASE_LAT)
    west = cx - (SIZE / 2) * RES_M
    north = cy + (SIZE / 2) * RES_M
    transform = from_origin(west, north, RES_M, RES_M)
    path = FIX / "sholinganallur_demo.tif"
    with rasterio.open(
        path, "w", driver="GTiff", height=SIZE, width=SIZE, count=1,
        dtype="uint8", crs="EPSG:32644", transform=transform,
    ) as ds:
        ds.write(img, 1)
    return path


def make_png() -> pathlib.Path:
    path = FIX / "plain_demo.png"
    Image.fromarray(_canvas()).save(path)
    return path


if __name__ == "__main__":
    print("wrote", make_geotiff())
    print("wrote", make_png())
