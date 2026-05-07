"""Shared frame annotation utilities for plugin snapshots."""
from __future__ import annotations

import cv2
import numpy as np


def annotate_frame(
    image: np.ndarray,
    boxes: list[dict | list],
    color: tuple[int, int, int] = (0, 255, 0),
    label: str | None = None,
    thickness: int = 2,
    font_scale: float = 0.55,
) -> np.ndarray:
    """
    Draw bounding boxes on a copy of *image*.

    Each box can be a dict with keys x1/y1/x2/y2 (or xmin/ymin/xmax/ymax)
    or a list/tuple of four numbers [x1, y1, x2, y2].
    Returns the annotated copy; the original is never modified.
    """
    annotated = image.copy()
    for box in boxes:
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            x1, y1, x2, y2 = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        elif isinstance(box, dict):
            x1 = int(box.get("x1") or box.get("xmin") or 0)
            y1 = int(box.get("y1") or box.get("ymin") or 0)
            x2 = int(box.get("x2") or box.get("xmax") or 0)
            y2 = int(box.get("y2") or box.get("ymax") or 0)
        else:
            continue
        if x2 <= x1 or y2 <= y1:
            continue
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness)
        if label:
            txt_y = max(y1 - 6, 14)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
            cv2.rectangle(annotated, (x1, txt_y - th - 4), (x1 + tw + 4, txt_y + 2), color, -1)
            cv2.putText(
                annotated, label, (x1 + 2, txt_y),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), thickness, cv2.LINE_AA,
            )
    return annotated


def encode_jpeg(image: np.ndarray, quality: int = 75) -> bytes:
    """Encode an ndarray to JPEG bytes."""
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else b""
