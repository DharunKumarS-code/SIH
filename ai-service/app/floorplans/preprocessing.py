"""Floor-plan image ingest + preprocessing (Phase 4).

- sniff format (PNG / JPEG / non-georef TIFF via Pillow)
- reject unsupported / corrupt / empty / too-small
- normalise to a float32 grayscale array in [0, 1] (paper ~1.0, ink ~0.0)
- expose an optional pixel->metre scale (never guessed — only used if supplied)
- tile large images instead of destroying thin walls with a blind resize

A plain floor-plan raster has NO geographic coordinates. This module keeps
everything in a LOCAL floor-plan coordinate system; geographic placement only
happens later, in the Node layer, when a real building/floor reference is given.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import (
    CRS_LOCAL_METRE,
    CRS_LOCAL_PIXEL,
    settings,
)

Image.MAX_IMAGE_PIXELS = 200_000_000  # decompression-bomb guard

SUPPORTED_EXT = {"png", "jpg", "jpeg", "tif", "tiff"}
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"
_TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


class PreprocessError(ValueError):
    """Unsupported / corrupt / oversized / degenerate input."""


@dataclass
class PreparedPlan:
    gray: np.ndarray                # float32 [H, W] in [0, 1]
    width: int
    height: int
    kind: str                      # "png" | "jpeg" | "tiff"
    scale_m_per_px: float | None = None
    crs: str = CRS_LOCAL_PIXEL
    coordinate_reference: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _ext_ok(filename: str) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext not in SUPPORTED_EXT:
        raise PreprocessError(
            f"Unsupported file extension '.{ext}'. Allowed: {sorted(SUPPORTED_EXT)}"
        )
    return ext


def _content_ok(data: bytes) -> None:
    """Never trust the extension alone — sniff the magic bytes too."""
    if data[:8] == _PNG_MAGIC:
        return
    if data[:3] == _JPEG_MAGIC:
        return
    if len(data) >= 4 and data[:4] in _TIFF_MAGIC:
        return
    raise PreprocessError("File content is not a PNG, JPEG or TIFF image.")


def _normalise(arr: np.ndarray) -> np.ndarray:
    a = arr.astype(np.float32)
    if a.ndim == 3:
        a = a.mean(axis=2)
    lo, hi = np.percentile(a, [1, 99])
    if hi <= lo:
        hi = lo + 1.0
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def _cap(arr: np.ndarray, scale_m_per_px: float | None, notes: list[str]):
    """Ceil-step downsample so no side exceeds ``max_image_px`` (keeps thin walls
    better than an arbitrary resize) and scale the metre/px factor to match."""
    h, w = arr.shape[:2]
    m = settings.max_image_px
    if max(h, w) <= m:
        return arr, scale_m_per_px
    step_y = max(1, -(-h // m))
    step_x = max(1, -(-w // m))
    step = max(step_x, step_y)   # uniform step keeps the aspect + scale simple
    notes.append(
        f"downsampled from {w}x{h} (step {step}) to stay under {m}px/side; "
        "TILE inference preserves feature detail"
    )
    out = arr[::step, ::step]
    new_scale = scale_m_per_px * step if scale_m_per_px else scale_m_per_px
    return out, new_scale


def prepare(image_bytes: bytes, filename: str, scale_m_per_px: float | None = None) -> PreparedPlan:
    if not image_bytes:
        raise PreprocessError("Empty upload.")
    ext = _ext_ok(filename)
    _content_ok(image_bytes)
    notes: list[str] = []

    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im.load()
            im = ImageOps.exif_transpose(im)
            arr = np.asarray(im.convert("RGB"))
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise PreprocessError(f"Not a decodable image: {e}") from e

    h, w = arr.shape[:2]
    if min(h, w) < settings.min_image_px:
        raise PreprocessError(
            f"Image too small ({w}x{h}); minimum {settings.min_image_px}px per side."
        )

    scale = float(scale_m_per_px) if scale_m_per_px and scale_m_per_px > 0 else None
    arr, scale = _cap(arr, scale, notes)
    gray = _normalise(arr)

    crs = CRS_LOCAL_METRE if scale else CRS_LOCAL_PIXEL
    coord_ref = {
        "kind": crs,
        "origin": "image-top-left",
        "xAxis": "pixels-right" if not scale else "metres-right",
        "yAxis": "pixels-down" if not scale else "metres-down",
        "scaleMPerPx": scale,
        "note": (
            "Local floor-plan coordinates. No latitude/longitude is implied. "
            "Geographic placement requires a valid building/floor reference."
        ),
    }
    return PreparedPlan(
        gray=gray,
        width=int(gray.shape[1]),
        height=int(gray.shape[0]),
        kind="jpeg" if ext in {"jpg", "jpeg"} else ("tiff" if ext in {"tif", "tiff"} else "png"),
        scale_m_per_px=scale,
        crs=crs,
        coordinate_reference=coord_ref,
        notes=notes,
    )


def tiles(prepared: PreparedPlan):
    """Yield (y0, x0, sub) windows. One window when the plan already fits."""
    h, w = prepared.gray.shape
    t = settings.tile_px
    ov = settings.tile_overlap_px
    if max(h, w) <= t:
        yield 0, 0, prepared.gray
        return
    step = max(1, t - ov)
    for y0 in range(0, h, step):
        for x0 in range(0, w, step):
            sub = prepared.gray[y0 : y0 + t, x0 : x0 + t]
            if sub.size:
                yield y0, x0, sub
