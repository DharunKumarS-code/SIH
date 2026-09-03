import numpy as np

from app.buildings.segmentation import ClassicalSegmenter, UNetSegmenter, get_segmenter


def test_classical_always_available_and_returns_probability():
    seg = ClassicalSegmenter()
    assert seg.available() is True
    gray = np.zeros((48, 48), dtype="float32")
    gray[10:30, 10:30] = 1.0  # a bright block
    prob = seg.probability(gray)
    assert prob.shape == gray.shape
    assert prob.dtype == np.float32
    assert 0.0 <= float(prob.min()) <= float(prob.max()) <= 1.0
    assert float(prob[15:25, 15:25].mean()) > float(prob[0:5, 0:5].mean())


def test_get_segmenter_defaults_to_classical():
    seg, note = get_segmenter()
    assert seg.key == "classical-cv"
    assert note is None


def test_unet_reports_unavailable_without_torch_or_weights():
    # torch / weights not installed in CI -> must degrade, never raise
    u = UNetSegmenter()
    assert u.available() is False


def test_get_segmenter_unet_falls_back(monkeypatch):
    from app.buildings import segmentation as s

    monkeypatch.setattr(s.settings, "model", "unet", raising=False)
    seg, note = get_segmenter()
    assert seg.key == "classical-cv"
    assert note and "classical" in note.lower()
