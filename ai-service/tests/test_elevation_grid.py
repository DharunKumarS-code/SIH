from app.elevation import grid, las_io
from app.elevation.ground_classification import GROUND_METHOD_CLASSIFICATION, GROUND_METHOD_FALLBACK


def test_build_dem_dsm_from_classified_las_uses_classification_method(elev_fixture):
    data = elev_fixture("points_classified.las")
    info, _ = las_io.validate(data)
    out = grid.build_dem_dsm_from_las(data, info)
    assert out["groundClassificationMethod"] == GROUND_METHOD_CLASSIFICATION
    assert out["dem"].crs == "EPSG:32644"
    assert 7.5 < out["dem"].min_elev < 8.5
    assert 27.0 < out["dsm"].max_elev < 29.0
    assert out["groundPointCount"] > 0
    assert out["totalPointCount"] == info.pointCount


def test_build_dem_dsm_from_unclassified_las_uses_fallback(elev_fixture):
    data = elev_fixture("points_unclassified.las")
    info, _ = las_io.validate(data)
    out = grid.build_dem_dsm_from_las(data, info)
    assert out["groundClassificationMethod"] == GROUND_METHOD_FALLBACK
    # flat ground-only fixture -> DEM and DSM should agree closely
    assert abs(out["dem"].min_elev - out["dsm"].min_elev) < 1.0


def test_grid_leaves_nodata_gaps_not_invented_values(elev_fixture):
    data = elev_fixture("points_classified.las")
    info, _ = las_io.validate(data)
    out = grid.build_dem_dsm_from_las(data, info)
    import numpy as np

    assert np.isnan(out["dem"].array).any()  # under the roof block: no ground return
