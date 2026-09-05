from app.elevation import raster_io
from app.elevation.height import compute_building_height


def _rasters(elev_fixture, dsm_name="dsm_building.tif", dem_name="dem_flat.tif"):
    dem = raster_io.open_raster(elev_fixture(dem_name), "DEM")
    dsm = raster_io.open_raster(elev_fixture(dsm_name), "DSM")
    return dem, dsm


def test_known_building_height_is_exact_on_a_flat_ground_plane(elev_fixture, elev_footprint_ring):
    dem, dsm = _rasters(elev_fixture)
    r = compute_building_height("B01", elev_footprint_ring, dem, dsm)
    assert r["buildingHeightM"] == 20.0
    assert r["groundElevationM"] == 8.0
    assert r["roofElevationM"] == 28.0
    assert r["qualityStatus"] == "VALID"
    assert r["confidenceLevel"] == "HIGH"
    assert r["heightMethod"] == "DSM_MINUS_DEM"


def test_outliers_in_dsm_are_clipped_and_do_not_bias_the_height(elev_fixture, elev_footprint_ring):
    dem, dsm = _rasters(elev_fixture, dsm_name="dsm_building_outliers.tif")
    r = compute_building_height("B01", elev_footprint_ring, dem, dsm)
    assert r["buildingHeightM"] == 20.0  # spikes filtered by percentile clipping
    assert r["roofElevationMaxM"] is not None and r["roofElevationMaxM"] > 100  # raw max still recorded


def test_large_negative_height_is_an_error(elev_fixture, elev_footprint_ring):
    dem, dsm = _rasters(elev_fixture, dsm_name="dsm_negative.tif")
    r = compute_building_height("B01", elev_footprint_ring, dem, dsm)
    assert r["buildingHeightM"] < -2.0
    assert r["qualityStatus"] == "ERROR"
    assert any(i["rule"] == "NEGATIVE_HEIGHT" and i["status"] == "ERROR" for i in r["qualityIssues"])


def test_small_negative_height_is_a_warning_not_an_error(elev_fixture, elev_footprint_ring):
    dem, dsm = _rasters(elev_fixture, dsm_name="dsm_small_negative.tif")
    r = compute_building_height("B01", elev_footprint_ring, dem, dsm)
    assert -2.0 < r["buildingHeightM"] < 0
    assert r["qualityStatus"] == "WARNING"
    assert any(i["rule"] == "NEGATIVE_HEIGHT" and i["status"] == "WARNING" for i in r["qualityIssues"])


def test_missing_dsm_is_unavailable_not_fabricated(elev_fixture, elev_footprint_ring):
    dem = raster_io.open_raster(elev_fixture("dem_flat.tif"), "DEM")
    r = compute_building_height("B01", elev_footprint_ring, dem, None)
    assert r["buildingHeightM"] is None
    assert r["roofElevationM"] is None
    assert r["qualityStatus"] == "ERROR"
    assert any(i["rule"] == "DSM_MISSING" for i in r["qualityIssues"])


def test_missing_dem_is_unavailable_not_fabricated(elev_fixture, elev_footprint_ring):
    dsm = raster_io.open_raster(elev_fixture("dsm_building.tif"), "DSM")
    r = compute_building_height("B01", elev_footprint_ring, None, dsm)
    assert r["buildingHeightM"] is None
    assert r["groundElevationM"] is None
    assert r["qualityStatus"] == "ERROR"
    assert any(i["rule"] == "DEM_MISSING" for i in r["qualityIssues"])


def test_ground_is_sampled_outside_footprint_not_under_the_roof(elev_fixture, elev_footprint_ring):
    """The DEM has NoData exactly under the (larger) roof block, but real
    ground is visible just outside it — the annulus sampling must find it."""
    dem = raster_io.open_raster(elev_fixture("dem_nodata.tif"), "DEM")
    dsm = raster_io.open_raster(elev_fixture("dsm_building.tif"), "DSM")
    r = compute_building_height("B01", elev_footprint_ring, dem, dsm)
    assert r["groundElevationM"] == 8.0
    assert r["buildingHeightM"] == 20.0
