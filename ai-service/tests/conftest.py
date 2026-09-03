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


@pytest.fixture
def prob_map() -> np.ndarray:
    """A small deterministic probability map: two solid blobs + noise."""
    m = np.full((64, 64), 0.1, dtype="float32")
    m[8:24, 8:28] = 0.92      # strong building
    m[40:52, 38:58] = 0.60    # weak building
    return m
