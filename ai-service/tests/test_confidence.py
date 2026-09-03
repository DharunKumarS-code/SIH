from app.buildings.confidence import level_for, review_required
from app.buildings.config import settings


def test_levels_use_configured_cutoffs():
    assert level_for(settings.conf_high + 0.01) == "HIGH"
    assert level_for(settings.conf_high) == "HIGH"
    assert level_for((settings.conf_high + settings.conf_med) / 2) == "MEDIUM"
    assert level_for(settings.conf_med - 0.01) == "LOW"


def test_low_confidence_requires_review():
    assert review_required("LOW", "VALID") is True
    assert review_required("HIGH", "VALID") is False


def test_bad_geometry_requires_review_even_if_high():
    assert review_required("HIGH", "WARNING") is True
    assert review_required("HIGH", "ERROR") is True
