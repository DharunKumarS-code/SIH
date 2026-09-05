from app.elevation import pipeline


def test_run_validate_dem_reports_provenance_and_metadata(elev_fixture):
    r = pipeline.run_validate(elev_fixture("dem_flat.tif"), "dem_flat.tif", "DEM", {"source_label": "TEST_FIXTURE"})
    assert r["status"] == "VALIDATED"
    assert r["metadata"]["crs"] == "EPSG:32644"
    assert r["provenance"]["source"] == "TEST_FIXTURE"
    assert r["provenance"]["isOfficial"] is False


def test_run_validate_pointcloud(elev_fixture):
    r = pipeline.run_validate(elev_fixture("points_classified.las"), "points_classified.las", "POINTCLOUD", {})
    assert r["status"] == "VALIDATED"
    assert r["metadata"]["pointCount"] == 3600
    assert r["metadata"]["classificationAvailable"] is True


def test_run_validate_unknown_dataset_type_is_invalid_input(elev_fixture):
    r = pipeline.run_validate(b"whatever", "x.bin", "BOGUS", {})
    assert r["status"] == "FAILED"
    assert r["errorKind"] == "INVALID_INPUT"


def test_run_validate_malformed_pointcloud_is_invalid_input(elev_fixture):
    r = pipeline.run_validate(elev_fixture("points_malformed.las"), "points_malformed.las", "POINTCLOUD", {})
    assert r["status"] == "FAILED"
    assert r["errorKind"] == "INVALID_INPUT"


def test_run_process_from_dem_dsm_pair_matches_known_height(elev_fixture, elev_footprints):
    r = pipeline.run_process(
        dem_bytes=elev_fixture("dem_flat.tif"), dsm_bytes=elev_fixture("dsm_building.tif"),
        footprints=elev_footprints, source_label="TEST_FIXTURE",
    )
    assert r["status"] == "COMPLETED"
    assert r["provenance"]["source"] == "TEST_FIXTURE"
    b = r["buildings"][0]
    assert b["buildingHeightM"] == 20.0
    assert b["dataSource"] == "DEM_DSM_DERIVED"
    assert b["qualityStatus"] == "VALID"
    assert r["summary"]["valid"] == 1


def test_run_process_from_pointcloud_derives_dem_dsm(elev_fixture, elev_footprints):
    r = pipeline.run_process(pointcloud_bytes=elev_fixture("points_classified.las"), footprints=elev_footprints)
    assert r["status"] == "COMPLETED"
    assert r["groundClassificationMethod"] == "LAS_CLASSIFICATION_CODE_2"
    b = r["buildings"][0]
    assert b["dataSource"] == "LIDAR_DERIVED"
    assert 18.5 < b["buildingHeightM"] < 21.5


def test_run_process_reports_crs_mismatch(elev_fixture, elev_footprints):
    r = pipeline.run_process(
        dem_bytes=elev_fixture("dem_flat.tif"), dsm_bytes=elev_fixture("dsm_mismatched_crs.tif"),
        footprints=elev_footprints,
    )
    assert r["crsComparison"]["horizontalCRS"]["status"] == "MISMATCH"


def test_run_process_never_marks_output_official(elev_fixture, elev_footprints):
    r = pipeline.run_process(
        dem_bytes=elev_fixture("dem_flat.tif"), dsm_bytes=elev_fixture("dsm_building.tif"),
        footprints=elev_footprints, source_label="RESEARCH_DATA",
    )
    assert r["provenance"]["isOfficial"] is False
    assert r["provenance"]["source"] == "RESEARCH_DATA"


def test_run_process_malformed_upload_fails_gracefully():
    r = pipeline.run_process(pointcloud_bytes=b"not a las file at all", footprints=[])
    assert r["status"] == "FAILED"
    assert r["errorKind"] == "INVALID_INPUT"
    assert "Traceback" not in r["error"]
