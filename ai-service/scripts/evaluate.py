"""Segmentation evaluation — DATASET EVALUATION ONLY.

Reports IoU / Precision / Recall / F1 / Dice for the active segmenter against a
folder of (image, mask) pairs (e.g. a SpaceNet test split rasterised to binary
masks).

    python ai-service/scripts/evaluate.py --images DIR --masks DIR [--limit N]

IMPORTANT: good numbers here do NOT imply the model is accurate for Chennai.
Chennai deployment must be validated separately against Chennai-labelled data
(see docs/15 — "DATASET EVALUATION vs CHENNAI DEPLOYMENT VALIDATION").
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.buildings.config import settings          # noqa: E402
from app.buildings.preprocessing import _normalise  # noqa: E402
from app.buildings.segmentation import get_segmenter  # noqa: E402


def _metrics(pred: np.ndarray, gt: np.ndarray) -> dict:
    p = pred.astype(bool)
    g = gt.astype(bool)
    tp = np.logical_and(p, g).sum()
    fp = np.logical_and(p, ~g).sum()
    fn = np.logical_and(~p, g).sum()
    iou = tp / (tp + fp + fn) if (tp + fp + fn) else 1.0
    prec = tp / (tp + fp) if (tp + fp) else 1.0
    rec = tp / (tp + fn) if (tp + fn) else 1.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    dice = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 1.0
    return {"iou": iou, "precision": prec, "recall": rec, "f1": f1, "dice": dice}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--masks", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    seg, note = get_segmenter()
    if note:
        print("[eval] note:", note)
    print(f"[eval] segmenter = {seg.key} v{seg.version}; threshold = {settings.building_confidence_threshold}")
    print("[eval] DATASET EVALUATION ONLY — not a Chennai deployment validation.\n")

    img_dir = pathlib.Path(args.images)
    msk_dir = pathlib.Path(args.masks)
    pairs = sorted(img_dir.glob("*"))
    if args.limit:
        pairs = pairs[: args.limit]

    agg: list[dict] = []
    for ip in pairs:
        mp = msk_dir / ip.name
        if not mp.exists():
            mp = next(iter(msk_dir.glob(ip.stem + ".*")), None)
        if mp is None:
            continue
        gray = _normalise(np.asarray(Image.open(ip).convert("RGB")))
        gt = (np.asarray(Image.open(mp).convert("L")) > 127).astype(np.uint8)
        prob = seg.probability(gray)
        pred = (prob >= settings.building_confidence_threshold).astype(np.uint8)
        if pred.shape != gt.shape:
            gt = np.asarray(Image.fromarray(gt * 255).resize(pred.shape[::-1])) > 127
        agg.append(_metrics(pred, gt))

    if not agg:
        print("[eval] no (image, mask) pairs found."); return
    keys = agg[0].keys()
    mean = {k: float(np.mean([m[k] for m in agg])) for k in keys}
    print(f"[eval] N = {len(agg)}")
    for k, v in mean.items():
        print(f"  {k:10s} {v:.4f}")


if __name__ == "__main__":
    main()
