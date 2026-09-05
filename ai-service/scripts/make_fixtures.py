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


def make_floorplan_png() -> pathlib.Path:
    """Synthetic floor plan for the Phase-4 AI segmentation tests.

    White paper, black wall ink: an outer rectangle, a central circulation
    corridor, and two apartments (left / right) each split into three rooms with
    door gaps. SYNTHETIC / AI_DEMO — not a real Chennai floor plan.
    """
    H, W = 384, 512
    img = np.full((H, W), 245, dtype=np.uint8)  # paper
    t = 4  # wall thickness

    def wall(y0, y1, x0, x1):
        img[y0:y1, x0:x1] = 20

    # outer shell
    wall(20, 20 + t, 20, W - 20)
    wall(H - 20 - t, H - 20, 20, W - 20)
    wall(20, H - 20, 20, 20 + t)
    wall(20, H - 20, W - 20 - t, W - 20)

    # central circulation corridor — two fully-closed vertical walls ~46 px apart
    cx = W // 2
    wall(20, H - 20, cx - 23 - t, cx - 23)
    wall(20, H - 20, cx + 23, cx + 23 + t)

    # left apartment: two horizontal partitions -> 3 rooms, each with a door gap
    for y in (135, 250):
        wall(y, y + t, 20, cx - 23 - t)
        img[y:y + t, 72:94] = 245  # interior door gap

    # right apartment: two horizontal partitions -> 3 rooms, each with a door gap
    for y in (150, 265):
        wall(y, y + t, cx + 23 + t, W - 20)
        img[y:y + t, W - 94:W - 72] = 245  # interior door gap

    # one entrance door from each apartment into the shared corridor
    img[96:118, cx - 23 - t:cx - 23] = 245
    img[300:322, cx + 23:cx + 23 + t] = 245

    path = FIX / "floorplan_demo.png"
    Image.fromarray(img).save(path)
    return path


if __name__ == "__main__":
    print("wrote", make_geotiff())
    print("wrote", make_png())
    print("wrote", make_floorplan_png())
