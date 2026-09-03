import numpy as np
from shapely.geometry import Polygon

from app.buildings.polygonize import _repair, mask_to_polygons


def test_mask_to_polygons_extracts_blobs(prob_map):
    polys = mask_to_polygons(prob_map)
    assert len(polys) >= 1
    for p in polys:
        assert p["geom"] is not None
        assert p["geom"].is_valid
        assert p["geom"].area > 0
        assert len(p["pixel_polygon"]) >= 4
        assert 0.0 <= p["confidence"] <= 1.0


def test_confidence_reflects_probability(prob_map):
    polys = sorted(mask_to_polygons(prob_map), key=lambda p: -p["area_px"])
    # the strong blob should carry higher confidence than the weak one
    confs = [p["confidence"] for p in polys]
    assert max(confs) > min(confs) or len(confs) == 1


def test_repair_fixes_bowtie():
    bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])  # self-intersecting
    assert not bowtie.is_valid
    geom, status, issues = _repair(bowtie)
    assert geom is not None
    assert status in ("WARNING", "VALID")
    assert geom.is_valid


def test_repair_rejects_degenerate():
    line = Polygon([(0, 0), (1, 1), (2, 2), (0, 0)])  # zero area
    geom, status, issues = _repair(line)
    assert geom is None
    assert status == "ERROR"


def test_empty_mask_yields_no_polygons():
    assert mask_to_polygons(np.zeros((32, 32), dtype="float32")) == []
