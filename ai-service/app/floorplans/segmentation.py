"""Floor-plan segmentation backends (Phase 4).

``ClassicalFloorPlanSegmenter`` — the always-available default. Deterministic, no
heavy deps: wall ink is darker than paper, so a normalised local-contrast
response + morphology yields a per-pixel WALL probability map. This is a
documented heuristic, not a trained model.

``SemSegSegmenter`` — optional. A semantic-segmentation head
(segmentation-models-pytorch). Only used when ``FLOORPLAN_MODEL=semseg`` AND
torch + weights are importable/present; otherwise ``available()`` is False and
the pipeline falls back to classical. It never fabricates predictions — if it
cannot load, the pipeline reports ``MODEL_NOT_AVAILABLE`` or falls back.

Neither backend invents room labels; room typing happens downstream in
``rooms.py`` and is confidence-capped for the classical path.
"""
from __future__ import annotations

import numpy as np
from skimage.filters import threshold_local
from skimage.morphology import (
    binary_closing,
    binary_opening,
    disk,
    remove_small_objects,
)

from .config import settings


class ClassicalFloorPlanSegmenter:
    key = "classical-cv"
    version = "1.0"
    name = "Classical CV (local-contrast wall response + morphology)"
    vocab = "classical"

    def available(self) -> bool:
        return True

    def probability(self, gray: np.ndarray) -> np.ndarray:
        """Per-pixel WALL probability [0,1] for a grayscale tile ([0,1], paper~1)."""
        if gray.size == 0:
            return gray
        ink = 1.0 - gray  # wall ink -> bright
        block = max(15, (min(gray.shape) // 10) | 1)  # odd
        try:
            local = threshold_local(ink, block_size=block, offset=-0.02)
        except Exception:
            local = float(ink.mean())
        resp = ink - local
        ptp = np.ptp(resp)
        resp = np.clip((resp - resp.min()) / (ptp + 1e-6), 0.0, 1.0)

        # hard mask on absolute darkness OR strong local contrast, then clean up
        mask = (ink > (1.0 - settings.wall_dark_threshold)) | (resp > 0.6)
        mask = binary_opening(mask, disk(1))
        if settings.wall_close_px > 0:
            mask = binary_closing(mask, disk(settings.wall_close_px))
        mask = remove_small_objects(mask, min_size=max(8, settings.wall_min_length_px))

        # blend crisp mask with the soft response so per-segment means are
        # meaningful confidences rather than a flat 1.0
        prob = np.where(mask, 0.55 + 0.45 * resp, 0.12 * resp).astype(np.float32)
        return np.clip(prob, 0.0, 1.0)


class SemSegSegmenter:  # pragma: no cover - optional, needs torch + weights
    key = "semseg"
    version = "0.1"
    name = "Semantic segmentation (segmentation-models-pytorch)"
    vocab = "cubicasa5k-rooms"

    def __init__(self) -> None:
        self._torch = None
        self._model = None
        try:
            import segmentation_models_pytorch as smp  # type: ignore
            import torch  # type: ignore

            self._torch = torch
            self._smp = smp
        except Exception:
            self._torch = None

    def available(self) -> bool:
        return self._torch is not None and bool(settings.semseg_weights)

    def _load(self):
        if self._model is not None:
            return self._model
        smp = self._smp
        torch = self._torch
        arch = getattr(smp, settings.semseg_arch, smp.Unet)
        model = arch(encoder_name=settings.semseg_encoder, encoder_weights=None, in_channels=1, classes=1)
        state = torch.load(settings.semseg_weights, map_location="cpu")
        model.load_state_dict(state.get("state_dict", state))
        model.eval()
        self._model = model
        return model

    def probability(self, gray: np.ndarray) -> np.ndarray:
        torch = self._torch
        model = self._load()
        x = torch.from_numpy(gray[None, None].astype("float32"))
        with torch.no_grad():
            y = torch.sigmoid(model(x))[0, 0].cpu().numpy()
        return np.clip(y, 0.0, 1.0)


def get_segmenter():
    """Return (segmenter, note). Honours FLOORPLAN_MODEL, falls back to classical."""
    if settings.model == "semseg":
        s = SemSegSegmenter()
        if s.available():
            return s, None
        return ClassicalFloorPlanSegmenter(), (
            "FLOORPLAN_MODEL=semseg requested but torch/weights unavailable — "
            "using classical CV fallback"
        )
    return ClassicalFloorPlanSegmenter(), None
