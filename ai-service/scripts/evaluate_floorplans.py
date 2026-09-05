"""Evaluate the floor-plan segmenter against ground-truth masks (Phase 4).

    python ai-service/scripts/evaluate_floorplans.py --images DIR --masks DIR

``--masks`` holds single-channel PNGs whose pixel value is the class index into
``app.floorplans.config.APP_CLASSES`` (0 = WALL ... ). Reports per-class and
macro IoU / Precision / Recall / F1 / Dice, plus a room-count delta.

The application does NOT run this at startup. DATASET METRICS ARE NOT A CHENNAI
DEPLOYMENT VALIDATION — see docs/16 §16 (domain shift). CubiCasa5K is
research/demo data.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.floorplans.config import APP_CLASSES  # noqa: E402
from app.floorplans.pipeline import _stitch  # noqa: E402
from app.floorplans.preprocessing import prepare  # noqa: E402
from app.floorplans.rooms import detect_rooms  # noqa: E402
from app.floorplans.walls import wall_mask  # noqa: E402


def _binary_scores(pred: np.ndarray, gt: np.ndarray) -> dict:
    pred = pred.astype(bool)
    gt = gt.astype(bool)
    tp = int(np.logical_and(pred, gt).sum())
    fp = int(np.logical_and(pred, ~gt).sum())
    fn = int(np.logical_and(~pred, gt).sum())
    union = tp + fp + fn
    iou = tp / union if union else 1.0
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    dice = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 1.0
    return {"iou": iou, "precision": precision, "recall": recall, "f1": f1, "dice": dice}


def evaluate(images_dir: str, masks_dir: str) -> dict:
    images = sorted(pathlib.Path(images_dir).glob("*"))
    masks = {p.stem: p for p in pathlib.Path(masks_dir).glob("*")}
    wall_idx = APP_CLASSES.index("WALL")

    agg: dict[str, list[float]] = {k: [] for k in ("iou", "precision", "recall", "f1", "dice")}
    room_delta: list[int] = []
    n = 0
    for img_path in images:
        if img_path.stem not in masks:
            continue
        prepared = prepare(img_path.read_bytes(), img_path.name)
        prob, _seg, _note = _stitch(prepared)
        pred_wall = wall_mask(prob)

        gt = np.asarray(Image.open(masks[img_path.stem]).convert("L").resize(
            (prepared.width, prepared.height), Image.NEAREST))
        gt_wall = gt == wall_idx

        for k, v in _binary_scores(pred_wall, gt_wall).items():
            agg[k].append(v)

        pred_rooms = detect_rooms(pred_wall, prob, prepared.scale_m_per_px)
        # crude GT room count: connected components of non-wall interior
        from skimage.measure import label
        from skimage.segmentation import clear_border
        gt_rooms = label(clear_border(gt != wall_idx)).max()
        room_delta.append(abs(len(pred_rooms) - int(gt_rooms)))
        n += 1

    if not n:
        raise SystemExit("no matching image/mask pairs found (match by file stem)")

    result = {k: round(float(np.mean(v)), 4) for k, v in agg.items()}
    result["samples"] = n
    result["mean_room_count_abs_error"] = round(float(np.mean(room_delta)), 2)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--masks", required=True)
    args = ap.parse_args()
    res = evaluate(args.images, args.masks)
    print("WALL segmentation (classical-cv default):")
    for k, v in res.items():
        print(f"  {k:28s} {v}")
    print("\nNOTE: dataset metrics != Chennai deployment validation (docs/16 §16).")
