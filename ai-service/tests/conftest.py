import pathlib
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "tests" / "fixtures"


@pytest.fixture(scope="session")
def geotiff_bytes() -> bytes:
    p = FIXTURES / "sholinganallur_demo.tif"
    if not p.exists():
        pytest.skip("run: python ai-service/scripts/make_fixtures.py")
    return p.read_bytes()


@pytest.fixture(scope="session")
def png_bytes() -> bytes:
    p = FIXTURES / "plain_demo.png"
    if not p.exists():
        pytest.skip("run: python ai-service/scripts/make_fixtures.py")
    return p.read_bytes()


@pytest.fixture(scope="session")
def floorplan_bytes() -> bytes:
    p = FIXTURES / "floorplan_demo.png"
    if not p.exists():
        pytest.skip("run: python ai-service/scripts/make_fixtures.py")
    return p.read_bytes()


@pytest.fixture
def prob_map() -> np.ndarray:
    """A small deterministic probability map: two solid blobs + noise."""
    m = np.full((64, 64), 0.1, dtype="float32")
    m[8:24, 8:28] = 0.92      # strong building
    m[40:52, 38:58] = 0.60    # weak building
    return m


# --------------------------------------------------------------------------
# Phase 5 — elevation / LiDAR / DEM / DSM fixtures.
# See ai-service/scripts/make_elevation_fixtures.py for how these are built.
# --------------------------------------------------------------------------
ELEV_FIX = FIXTURES / "elevation"
ELEV_BASE_LON, ELEV_BASE_LAT = 80.22705, 12.90045  # Sholinganallur demo centre


def _elev_bytes(name: str) -> bytes:
    p = ELEV_FIX / name
    if not p.exists():
        pytest.skip("run: python ai-service/scripts/make_elevation_fixtures.py")
    return p.read_bytes()


@pytest.fixture
def elev_fixture():
    """Callable: elev_fixture('dem_flat.tif') -> bytes."""
    return _elev_bytes


@pytest.fixture
def elev_footprint_ring():
    """The WGS84 ring of the synthetic ~16x16 m test building footprint used
    by every elevation fixture (half-width 8 m, centred on the Sholinganallur
    demo locality centre)."""
    from pyproj import Transformer

    tf = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)
    tfi = Transformer.from_crs("EPSG:32644", "EPSG:4326", always_xy=True)
    cx, cy = tf.transform(ELEV_BASE_LON, ELEV_BASE_LAT)
    half = 8
    corners = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half), (cx - half, cy - half)]
    return [list(tfi.transform(x, y)) for x, y in corners]


@pytest.fixture
def elev_footprints(elev_footprint_ring):
    return [{"buildingId": "B01", "polygon": {"type": "Polygon", "coordinates": [elev_footprint_ring]}}]
