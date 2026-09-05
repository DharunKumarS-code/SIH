from app.elevation import las_io


def test_classified_las_reports_ground_and_building_codes(elev_fixture):
    info, status = las_io.validate(elev_fixture("points_classified.las"))
    assert status == "VALID"
    assert info.pointCount == 3600
    assert info.crs and "32644" in info.crs
    assert info.crsStatus == "MATCHED"
    assert info.classificationAvailable is True
    assert 2 in info.classificationCodesPresent
    assert 6 in info.classificationCodesPresent


def test_unclassified_las_flags_fallback_needed(elev_fixture):
    info, status = las_io.validate(elev_fixture("points_unclassified.las"))
    assert status == "VALID"
    assert info.classificationAvailable is False
    assert any("fallback" in n.lower() for n in info.notes)


def test_no_crs_las_is_unknown_not_invented(elev_fixture):
    info, status = las_io.validate(elev_fixture("points_no_crs.las"))
    assert info.crs is None
    assert info.crsStatus == "UNKNOWN"
    assert any("UNKNOWN" in n for n in info.notes)


def test_sparse_point_cloud_warns_insufficient_density(elev_fixture):
    info, status = las_io.validate(elev_fixture("points_sparse.las"))
    assert status == "WARNING"
    assert any(i["rule"] == "INSUFFICIENT_POINT_DENSITY" for i in info.issues)


def test_malformed_las_raises_las_error(elev_fixture):
    try:
        las_io.validate(elev_fixture("points_malformed.las"))
        assert False, "expected LasError"
    except las_io.LasError:
        pass


def test_chunk_iterator_streams_all_points_and_respects_cap(elev_fixture):
    data = elev_fixture("points_classified.las")
    total = 0
    for x, y, z, cls in las_io.chunk_iterator(data):
        assert len(x) == len(y) == len(z)
        assert cls is not None
        total += len(x)
    assert total == 3600
