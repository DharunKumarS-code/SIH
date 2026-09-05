"""One-off: generate deterministic Phase-5 elevation test fixtures.

  ai-service/tests/fixtures/elevation/dem_flat.tif             flat 8.0 m DEM (EPSG:32644)
  ai-service/tests/fixtures/elevation/dsm_building.tif          8.0 m ground + 28.0 m roof block
  ai-service/tests/fixtures/elevation/dsm_building_outliers.tif same + scattered vegetation-like spikes
  ai-service/tests/fixtures/elevation/dsm_negative.tif           flat 5.0 m (below DEM) -> large negative height
  ai-service/tests/fixtures/elevation/dsm_small_negative.tif     flat 7.7 m -> small negative height
  ai-service/tests/fixtures/elevation/dem_nodata.tif             flat 8.0 m with a NoData hole over the footprint
  ai-service/tests/fixtures/elevation/dem_no_crs.tif              flat 8.0 m, CRS deliberately stripped
  ai-service/tests/fixtures/elevation/dsm_mismatched_crs.tif      same surface, CRS = EPSG:4326 (mismatch vs DEM)
  ai-service/tests/fixtures/elevation/points_classified.las      ASPRS-classified ground(2) + building(6) points
  ai-service/tests/fixtures/elevation/points_unclassified.las    flat ground, no classification (fallback path)
  ai-service/tests/fixtures/elevation/points_sparse.las          10 points (insufficient density)
  ai-service/tests/fixtures/elevation/points_no_crs.las          valid LAS, no CRS VLR
  ai-service/tests/fixtures/elevation/points_malformed.las       corrupt / not a real LAS file

All SYNTHETIC / TEST_FIXTURE — not real Chennai elevation data. The horizontal
placement matches the Sholinganallur demo locality centre (backend/src/data/
localities.js BASE) purely so a future end-to-end test can associate results
with the existing demo building footprints; it is not itself survey data.

Run:  python ai-service/scripts/make_elevation_fixtures.py
"""
from __future__ import annotations

import pathlib

import laspy
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

FIX = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "elevation"
FIX.mkdir(parents=True, exist_ok=True)

BASE_LON, BASE_LAT = 80.22705, 12.90045  # Sholinganallur demo centre
SIZE = 60          # px / m (1 m resolution)
RES_M = 1.0
GROUND_M = 8.0      # matches backend GROUND_ELEV
ROOF_M = 28.0        # ground + 20 m -> a known, exact expected building height
BLOCK = (20, 40, 20, 40)  # row0,row1,col0,col1 — the raised "roof" region

_tf = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)
CX, CY = _tf.transform(BASE_LON, BASE_LAT)
WEST = CX - SIZE / 2
NORTH = CY + SIZE / 2
TRANSFORM = from_origin(WEST, NORTH, RES_M, RES_M)


def _write_tif(path, arr, crs="EPSG:32644", nodata=None, transform=TRANSFORM):
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
        dtype="float32", crs=crs, transform=transform, nodata=nodata,
    ) as ds:
        ds.write(arr.astype("float32"), 1)
    return path


def make_dem_flat():
    arr = np.full((SIZE, SIZE), GROUND_M, dtype="float32")
    return _write_tif(FIX / "dem_flat.tif", arr)


def make_dem_nodata():
    arr = np.full((SIZE, SIZE), GROUND_M, dtype="float32")
    r0, r1, c0, c1 = BLOCK
    arr[r0:r1, c0:c1] = -9999.0
    return _write_tif(FIX / "dem_nodata.tif", arr, nodata=-9999.0)


def make_dem_no_crs():
    arr = np.full((SIZE, SIZE), GROUND_M, dtype="float32")
    return _write_tif(FIX / "dem_no_crs.tif", arr, crs=None)


def make_dsm(name, roof_m, outliers=False):
    arr = np.full((SIZE, SIZE), GROUND_M, dtype="float32")
    r0, r1, c0, c1 = BLOCK
    arr[r0:r1, c0:c1] = roof_m
    if outliers:
        rng = np.random.default_rng(20260905)
        rows = rng.integers(r0, r1, 12)
        cols = rng.integers(c0, c1, 12)
        arr[rows, cols] = 140.0  # vegetation/vehicle-like spike, well outside the plausible band
    return _write_tif(FIX / name, arr)


def make_dsm_mismatched_crs():
    # Re-express the same surface on a small EPSG:4326 grid — deliberately a
    # different CRS from the EPSG:32644 DEM, to exercise CRS_MISMATCH.
    d = 60 / 111_320.0  # ~60 m in degrees
    west, north = BASE_LON - d / 2, BASE_LAT + d / 2
    transform = from_origin(west, north, d / SIZE, d / SIZE)
    arr = np.full((SIZE, SIZE), GROUND_M, dtype="float32")
    r0, r1, c0, c1 = BLOCK
    arr[r0:r1, c0:c1] = ROOF_M
    return _write_tif(FIX / "dsm_mismatched_crs.tif", arr, crs="EPSG:4326", transform=transform)


def _new_las(point_count):
    header = laspy.LasHeader(point_format=6, version="1.4")
    header.offsets = [WEST, NORTH - SIZE, 0.0]
    header.scales = [0.001, 0.001, 0.001]
    try:
        import pyproj

        header.add_crs(pyproj.CRS.from_epsg(32644))
    except Exception:
        pass
    return laspy.LasData(header)


def make_points_classified():
    xs, ys, zs, cls = [], [], [], []
    rng = np.random.default_rng(20260906)
    for row in range(0, SIZE, 1):
        for col in range(0, SIZE, 1):
            x = WEST + col + 0.5
            y = NORTH - row - 0.5
            r0, r1, c0, c1 = BLOCK
            if r0 <= row < r1 and c0 <= col < c1:
                zs.append(ROOF_M + rng.normal(0, 0.02))
                cls.append(6)  # building
            else:
                zs.append(GROUND_M + rng.normal(0, 0.02))
                cls.append(2)  # ground
            xs.append(x)
            ys.append(y)
    las = _new_las(len(xs))
    las.x = np.array(xs)
    las.y = np.array(ys)
    las.z = np.array(zs)
    las.classification = np.array(cls, dtype="uint8")
    path = FIX / "points_classified.las"
    las.write(path)
    return path


def make_points_unclassified():
    xs, ys, zs = [], [], []
    rng = np.random.default_rng(20260907)
    for row in range(0, SIZE, 2):
        for col in range(0, SIZE, 2):
            xs.append(WEST + col + 0.5)
            ys.append(NORTH - row - 0.5)
            zs.append(GROUND_M + rng.normal(0, 0.03))
    las = _new_las(len(xs))
    las.x = np.array(xs)
    las.y = np.array(ys)
    las.z = np.array(zs)
    path = FIX / "points_unclassified.las"
    las.write(path)
    return path


def make_points_sparse():
    las = _new_las(10)
    las.x = np.array([WEST + i for i in range(10)])
    las.y = np.array([NORTH - i for i in range(10)])
    las.z = np.array([GROUND_M] * 10)
    path = FIX / "points_sparse.las"
    las.write(path)
    return path


def make_points_no_crs():
    header = laspy.LasHeader(point_format=6, version="1.4")
    header.offsets = [WEST, NORTH - SIZE, 0.0]
    header.scales = [0.001, 0.001, 0.001]
    las = laspy.LasData(header)
    n = 200
    las.x = np.array([WEST + (i % 20) for i in range(n)])
    las.y = np.array([NORTH - (i // 20) for i in range(n)])
    las.z = np.array([GROUND_M] * n)
    path = FIX / "points_no_crs.las"
    las.write(path)
    return path


def make_points_malformed():
    path = FIX / "points_malformed.las"
    path.write_bytes(b"LASF" + b"\x00\x01garbage-not-a-real-las-body" * 5)
    return path


if __name__ == "__main__":
    for fn in (
        make_dem_flat,
        make_dem_nodata,
        make_dem_no_crs,
        lambda: make_dsm("dsm_building.tif", ROOF_M),
        lambda: make_dsm("dsm_building_outliers.tif", ROOF_M, outliers=True),
        lambda: make_dsm("dsm_negative.tif", 5.0),
        lambda: make_dsm("dsm_small_negative.tif", 7.7),
        make_dsm_mismatched_crs,
        make_points_classified,
        make_points_unclassified,
        make_points_sparse,
        make_points_no_crs,
        make_points_malformed,
    ):
        print("wrote", fn())
