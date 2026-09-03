"""Building segmentation backends.

`ClassicalSegmenter` — the always-available default. Deterministic, no heavy
deps: local-contrast response + morphology -> a building probability map.

`UNetSegmenter` — optional. Uses segmentation-models-pytorch (ResNet-34 U-Net).
Only used when AI_MODEL=unet AND torch + weights are importable/present;
otherwise `available()` is False and the pipeline falls back to classical.

Neither backend fabricates confidence — the classical map is a normalised
morphological response, clearly labelled as a heuristic in docs/15.
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


class ClassicalSegmenter:
    key = "classical-cv"
    version = "1.0"
    name = "Classical CV (adaptive threshold + morphology)"

    def available(self) -> bool:  # noqa: D401
        return True

    def probability(self, gray: np.ndarray) -> np.ndarray:
        """Return a [0,1] building-probability map for a grayscale tile."""
        if gray.size == 0:
            return gray
        block = max(15, (min(gray.shape) // 8) | 1)  # odd
        try:
            local = threshold_local(gray, block_size=block, offset=-0.02)
        except Exception:
            local = float(gray.mean())
        resp = gray - local                # bright, blocky roofs stand out
        resp = np.clip((resp - resp.min()) / (np.ptp(resp) + 1e-6), 0, 1)

        mask = resp > 0.55
        mask = binary_opening(mask, disk(2))
        mask = binary_closing(mask, disk(3))
        mask = remove_small_objects(mask, min_size=32)

        # blend the crisp mask with the soft response so per-object means are
        # meaningful confidences rather than a flat 1.0
        prob = np.where(mask, 0.5 + 0.5 * resp, 0.15 * resp).astype(np.float32)
        return np.clip(prob, 0.0, 1.0)


class UNetSegmenter:
    key = "unet-resnet34"
    version = "0.1"
    name = "U-Net (ResNet-34 encoder, segmentation-models-pytorch)"

    def __init__(self) -> None:
        self._model = None
        self._torch = None
        try:  # pragma: no cover - optional
            import torch  # type: ignore
            import segmentation_models_pytorch as smp  # type: ignore

            self._torch = torch
            self._smp = smp
        except Exception:
            self._torch = None

    def available(self) -> bool:  # pragma: no cover - optional
        return self._torch is not None and bool(settings.unet_weights)

    def _load(self):  # pragma: no cover - optional
        if self._model is not None:
            return self._model
        smp = self._smp
        torch = self._torch
        model = smp.Unet(encoder_name="resnet34", encoder_weights=None, in_channels=1, classes=1)
        state = torch.load(settings.unet_weights, map_location="cpu")
        model.load_state_dict(state.get("state_dict", state))
        model.eval()
        self._model = model
        return model

    def probability(self, gray: np.ndarray) -> np.ndarray:  # pragma: no cover - optional
        torch = self._torch
        model = self._load()
        x = torch.from_numpy(gray[None, None].astype("float32"))
        with torch.no_grad():
            y = torch.sigmoid(model(x))[0, 0].cpu().numpy()
        return np.clip(y, 0.0, 1.0)


def get_segmenter():
    """Return (segmenter, note). Honours AI_MODEL, falls back to classical."""
    if settings.model == "unet":
        u = UNetSegmenter()
        if u.available():
            return u, None
        return ClassicalSegmenter(), (
            "AI_MODEL=unet requested but torch/weights unavailable — using classical CV fallback"
        )
    return ClassicalSegmenter(), None
