import numpy as np

from app.elevation import raster_io
from app.elevation.crs import compare_horizontal_crs, compare_vertical_datum


def test_open_raster_reads_flat_dem(elev_fixture):
    info = raster_io.open_raster(elev_fixture("dem_flat.tif"), "DEM")
    assert info.crs and "32644" in info.crs
    assert info.min_elev == info.max_elev == 8.0
    assert info.crs_units_are_metres is True


def test_open_raster_reports_nodata_and_notes(elev_fixture):
    info = raster_io.open_raster(elev_fixture("dem_nodata.tif"), "DEM")
    assert info.nodata == -9999.0
    assert np.isnan(info.array).any()


def test_open_raster_no_crs_is_unknown(elev_fixture):
    info = raster_io.open_raster(elev_fixture("dem_no_crs.tif"), "DEM")
    assert info.crs is None
    assert any("UNKNOWN" in n for n in info.notes)


def test_open_raster_rejects_malformed_bytes():
    try:
        raster_io.open_raster(b"not a real geotiff", "DEM")
        assert False, "expected RasterError"
    except raster_io.RasterError:
        pass


def test_sample_footprint_union_covers_footprint_and_buffer(elev_fixture, elev_footprint_ring):
    dsm = raster_io.open_raster(elev_fixture("dsm_building.tif"), "DSM")
    r = raster_io.sample_footprint(dsm, elev_footprint_ring, buffer_m=1.0, mode="union")
    assert r["samples"].size > 0
    assert np.all(r["samples"] == 28.0)  # entirely inside the raised roof block


def test_sample_footprint_annulus_excludes_interior(elev_fixture, elev_footprint_ring):
    dem = raster_io.open_raster(elev_fixture("dem_flat.tif"), "DEM")
    interior = raster_io.sample_footprint(dem, elev_footprint_ring, buffer_m=1.0, mode="interior")
    annulus = raster_io.sample_footprint(dem, elev_footprint_ring, buffer_m=1.0, mode="annulus")
    assert interior["samples"].size > 0
    assert annulus["samples"].size > 0
    # both flat at 8.0 m here, but the pixel sets must be disjoint
    assert interior["candidateCells"] + annulus["candidateCells"] > interior["candidateCells"]


def test_compare_horizontal_crs_matched_vs_mismatch():
    status, _ = compare_horizontal_crs("EPSG:32644", "EPSG:32644")
    assert status == "MATCHED"
    status2, _ = compare_horizontal_crs("EPSG:32644", "EPSG:4326")
    assert status2 == "MISMATCH"
    status3, _ = compare_horizontal_crs(None, "EPSG:4326")
    assert status3 == "UNKNOWN"


def test_compare_vertical_datum_never_assumes():
    status, note = compare_vertical_datum(None, None)
    assert status == "UNKNOWN"
    status2, _ = compare_vertical_datum("EGM96", "EGM96")
    assert status2 == "MATCHED"
    status3, _ = compare_vertical_datum("EGM96", "WGS84 Ellipsoid")
    assert status3 == "MISMATCH"
