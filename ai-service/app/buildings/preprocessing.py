"""Image ingest + preprocessing.

- sniff format (PNG / JPEG via Pillow, GeoTIFF via rasterio when available)
- reject unsupported / corrupt / empty
- return a normalised float32 grayscale array in [0, 1] plus georef metadata
- for very large rasters, read a capped window (never loads an unbounded array)
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, UnidentifiedImageError

from .config import settings

Image.MAX_IMAGE_PIXELS = 200_000_000  # guard against decompression bombs

SUPPORTED_EXT = {"png", "jpg", "jpeg", "tif", "tiff"}
_TIFF_MAGIC = (b"II*\x00", b"MM\x00*")

try:  # optional georef stack
    import rasterio  # type: ignore
    from rasterio.io import MemoryFile  # type: ignore
    _HAS_RASTERIO = True
except Exception:  # pragma: no cover - env-dependent
    _HAS_RASTERIO = False


class PreprocessError(ValueError):
    """Raised for unsupported / corrupt / oversized input."""


@dataclass
class PreparedImage:
    gray: np.ndarray               # float32 [H, W] in [0, 1]
    width: int
    height: int
    kind: str                     # "png" | "jpeg" | "geotiff" | "tiff"
    georeferenced: bool = False
    crs: str | None = None        # e.g. "EPSG:32644"
    transform: list | None = None  # affine [a, b, c, d, e, f]
    bounds: list | None = None     # [minx, miny, maxx, maxy] in source CRS
    resolution_m: float | None = None
    notes: list[str] = field(default_factory=list)


def _ext_ok(filename: str) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext not in SUPPORTED_EXT:
        raise PreprocessError(
            f"Unsupported file extension '.{ext}'. Allowed: {sorted(SUPPORTED_EXT)}"
        )
    return ext


def _looks_like_tiff(data: bytes) -> bool:
    return len(data) >= 4 and data[:4] in _TIFF_MAGIC


def _normalise(arr: np.ndarray) -> np.ndarray:
    a = arr.astype(np.float32)
    if a.ndim == 3:
        a = a.mean(axis=2)
    lo, hi = np.percentile(a, [2, 98])
    if hi <= lo:
        hi = lo + 1.0
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def _cap(arr: np.ndarray, note: list[str]) -> np.ndarray:
    h, w = arr.shape[:2]
    m = settings.max_image_px
    if max(h, w) <= m:
        return arr
    step_y = max(1, -(-h // m))  # ceil division -> result stays <= m px/side
    step_x = max(1, -(-w // m))
    note.append(f"downsampled from {w}x{h} (step {step_x}x{step_y}) to stay under {m}px/side")
    return arr[::step_y, ::step_x]


def prepare(image_bytes: bytes, filename: str) -> PreparedImage:
    if not image_bytes:
        raise PreprocessError("Empty upload.")
    ext = _ext_ok(filename)
    notes: list[str] = []

    is_tiff = ext in {"tif", "tiff"} or _looks_like_tiff(image_bytes)

    # ---- GeoTIFF path (georeferenced when it carries a CRS + transform) ----
    if is_tiff and _HAS_RASTERIO:
        try:
            with MemoryFile(image_bytes) as mf, mf.open() as ds:  # type: ignore
                bands = min(ds.count, 3)
                data = ds.read(list(range(1, bands + 1)))  # [bands, H, W]
                arr = np.transpose(data, (1, 2, 0)) if bands > 1 else data[0]
                arr = _cap(arr, notes)
                gray = _normalise(arr)
                has_geo = ds.crs is not None and ds.transform is not None and not ds.transform.is_identity
                t = ds.transform
                res = float((abs(t.a) + abs(t.e)) / 2) if has_geo else None
                b = ds.bounds
                return PreparedImage(
                    gray=gray,
                    width=int(gray.shape[1]),
                    height=int(gray.shape[0]),
                    kind="geotiff" if has_geo else "tiff",
                    georeferenced=bool(has_geo),
                    crs=str(ds.crs) if has_geo else None,
                    transform=[t.a, t.b, t.c, t.d, t.e, t.f] if has_geo else None,
                    bounds=[b.left, b.bottom, b.right, b.top] if has_geo else None,
                    resolution_m=res,
                    notes=notes + ([] if has_geo else ["TIFF has no CRS/transform — treated as non-georeferenced"]),
                )
        except PreprocessError:
            raise
        except Exception as e:  # corrupt tiff -> fall through to Pillow, else error
            notes.append(f"rasterio could not open the TIFF ({e}); retrying as a plain image")

    # ---- plain raster path (PNG / JPEG / TIFF without georef) ----
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im.load()
            arr = np.asarray(im.convert("RGB"))
    except (UnidentifiedImageError, OSError) as e:
        raise PreprocessError(f"Not a decodable image: {e}") from e
    arr = _cap(arr, notes)
    gray = _normalise(arr)
    return PreparedImage(
        gray=gray,
        width=int(gray.shape[1]),
        height=int(gray.shape[0]),
        kind="jpeg" if ext in {"jpg", "jpeg"} else ("tiff" if is_tiff else "png"),
        georeferenced=False,
        notes=notes,
    )


def tiles(prepared: PreparedImage):
    """Yield (y0, x0, sub) windows. One window when the image already fits."""
    h, w = prepared.gray.shape
    t = settings.tile_px
    ov = settings.tile_overlap_px
    if max(h, w) <= t:
        yield 0, 0, prepared.gray
        return
    step = t - ov
    for y0 in range(0, h, step):
        for x0 in range(0, w, step):
            sub = prepared.gray[y0 : y0 + t, x0 : x0 + t]
            if sub.size:
                yield y0, x0, sub
