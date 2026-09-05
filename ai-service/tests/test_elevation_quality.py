import numpy as np

from app.elevation import quality
from app.elevation.config import settings


def test_valid_height_with_ample_samples():
    ground = np.full(20, 8.0)
    roof = np.full(20, 28.0)
    status, issues = quality.evaluate(
        ground_samples=ground, roof_samples_raw=roof, roof_samples_clipped=roof,
        ground_elev=8.0, roof_elev=28.0, height=20.0, crs_status="MATCHED",
    )
    assert status == "VALID"
    assert issues == []


def test_insufficient_samples_is_a_warning():
    ground = np.array([8.0])  # below min_valid_samples
    roof = np.array([28.0])
    status, issues = quality.evaluate(
        ground_samples=ground, roof_samples_raw=roof, roof_samples_clipped=roof,
        ground_elev=8.0, roof_elev=28.0, height=20.0, crs_status="MATCHED",
    )
    assert status == "WARNING"
    rules = [i["rule"] for i in issues]
    assert "INSUFFICIENT_DEM_SAMPLES" in rules
    assert "INSUFFICIENT_DSM_SAMPLES" in rules


def test_high_outlier_rate_warns_possible_vegetation_contamination():
    raw = np.array([28.0] * 6 + [150.0] * 6)  # 50% outliers
    clipped = np.array([28.0] * 6)
    status, issues = quality.evaluate(
        ground_samples=np.full(10, 8.0), roof_samples_raw=raw, roof_samples_clipped=clipped,
        ground_elev=8.0, roof_elev=28.0, height=20.0, crs_status="MATCHED",
    )
    assert status == "WARNING"
    assert any(i["rule"] == "OUTLIER_RATE" for i in issues)


def test_extreme_height_is_an_error_beyond_max_plausible():
    status, issues = quality.evaluate(
        ground_samples=np.full(10, 8.0), roof_samples_raw=np.full(10, 400.0), roof_samples_clipped=np.full(10, 400.0),
        ground_elev=8.0, roof_elev=400.0, height=392.0, crs_status="MATCHED",
    )
    assert status == "ERROR"
    assert any(i["rule"] == "EXTREME_HEIGHT" and i["status"] == "ERROR" for i in issues)


def test_crs_mismatch_is_an_error():
    status, issues = quality.evaluate(
        ground_samples=np.full(10, 8.0), roof_samples_raw=np.full(10, 28.0), roof_samples_clipped=np.full(10, 28.0),
        ground_elev=8.0, roof_elev=28.0, height=20.0, crs_status="MISMATCH",
    )
    assert status == "ERROR"
    assert any(i["rule"] == "CRS_STATUS" and i["status"] == "ERROR" for i in issues)


def test_confidence_is_high_for_ample_consistent_samples():
    roof = np.full(30, 28.0)
    level, score = quality.confidence(
        n_ground=30, n_roof=30, coverage_ratio=1.0, roof_samples=roof, height=20.0, crs_status="MATCHED",
    )
    assert level == "HIGH"
    assert 0.0 <= score <= 1.0


def test_confidence_is_low_for_sparse_inconsistent_samples():
    roof = np.array([10.0, 60.0])  # huge spread relative to height
    level, score = quality.confidence(
        n_ground=1, n_roof=2, coverage_ratio=0.05, roof_samples=roof, height=20.0, crs_status="UNKNOWN",
    )
    assert level == "LOW"
    assert score < settings.confidence_medium
