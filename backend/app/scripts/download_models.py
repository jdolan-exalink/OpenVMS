"""
OpenCCTV model initializer — run once before backend starts.

Downloads YOLO weights from public HuggingFace repos and pre-warms
auto-download ML libraries (CLIP, InsightFace, PaddleOCR, MediaPipe).

Usage:
  python -m app.scripts.download_models

Environment:
  MODELS_DIR            Path for YOLO weights (default: /models)
  SKIP_MODEL_DOWNLOAD   Set to 1 to skip entirely
  FORCE_MODEL_DOWNLOAD  Set to 1 to re-download even if flag file exists
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
import urllib.request
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="[model-init] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
CACHE_DIR = MODELS_DIR / ".cache"
FLAG_FILE = MODELS_DIR / ".initialized"

# ── Model definitions ─────────────────────────────────────────────────────────

# HuggingFace models (public, no auth required).
# Format: (destination_filename, hf_repo_id, hf_filename)
HF_YOLO_MODELS: list[tuple[str, str, str]] = []

# Plugins that use a generic YOLOv8n person/object detector as base.
# epp: uses HSV color analysis for helmet/vest detection — only needs person bboxes.
# abandoned_object: filters vehicles/persons via excluded_labels, tracks remaining objects.
# smoke_fire: yolov8n.pt is a placeholder — replace with a fire/smoke-trained model
#             (e.g. from Roboflow Universe) for production use.
YOLOV8N_ALIASES = [
    "epp_yolo.pt",
    "abandoned_object_yolo.pt",
    "smoke_fire_yolo.pt",  # placeholder — no public fire/smoke YOLO without auth
]

# Direct URL for YOLOv8n base weights (stable Ultralytics release)
YOLOV8N_URL = (
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt"
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n //= 1024
    return f"{n:.1f} TB"


def _download_url(url: str, dest: Path, label: str) -> bool:
    log.info("Downloading %s …", label)
    try:
        tmp = dest.with_suffix(".tmp")
        urllib.request.urlretrieve(url, str(tmp))
        tmp.rename(dest)
        log.info("  ✓ %s saved (%s)", label, _human_size(dest.stat().st_size))
        return True
    except Exception as exc:
        log.warning("  ✗ %s failed: %s", label, exc)
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False


def _hf_url(repo_id: str, filename: str) -> str:
    return f"https://huggingface.co/{repo_id}/resolve/main/{filename}"


# ── Download steps ────────────────────────────────────────────────────────────

def download_yolov8n() -> bool:
    dest = MODELS_DIR / "yolov8n.pt"
    if dest.exists():
        log.info("  ✓ yolov8n.pt already present")
        return True
    return _download_url(YOLOV8N_URL, dest, "yolov8n.pt")


def download_hf_models() -> None:
    for dest_name, repo_id, filename in HF_YOLO_MODELS:
        dest = MODELS_DIR / dest_name
        if dest.exists():
            log.info("  ✓ %s already present", dest_name)
            continue
        url = _hf_url(repo_id, filename)
        _download_url(url, dest, f"{dest_name} ({repo_id})")


def create_yolov8n_aliases() -> None:
    src = MODELS_DIR / "yolov8n.pt"
    if not src.exists():
        log.warning("yolov8n.pt not found — skipping alias creation")
        return
    for alias in YOLOV8N_ALIASES:
        dest = MODELS_DIR / alias
        if dest.exists():
            log.info("  ✓ %s already present", alias)
            continue
        try:
            shutil.copy2(src, dest)
            log.info("  ✓ %s created (copy of yolov8n.pt)", alias)
        except Exception as exc:
            log.warning("  ✗ %s: %s", alias, exc)


def setup_paddleocr_cache() -> None:
    """Redirect ~/.paddleocr → /models/.cache/paddleocr so it persists across restarts."""
    import os
    paddle_cache = CACHE_DIR / "paddleocr"
    paddle_cache.mkdir(parents=True, exist_ok=True)
    paddle_home = Path.home() / ".paddleocr"
    if paddle_home.is_symlink() and paddle_home.resolve() == paddle_cache.resolve():
        return
    if paddle_home.exists() and not paddle_home.is_symlink():
        # Move existing downloads into the persistent cache
        try:
            for item in paddle_home.iterdir():
                dest = paddle_cache / item.name
                if not dest.exists():
                    shutil.move(str(item), str(dest))
            shutil.rmtree(str(paddle_home), ignore_errors=True)
        except Exception as exc:
            log.warning("  Could not move paddleocr cache: %s", exc)
    if not paddle_home.exists():
        try:
            paddle_home.symlink_to(paddle_cache)
            log.info("  ✓ ~/.paddleocr → %s", paddle_cache)
        except Exception as exc:
            log.warning("  ✗ paddleocr symlink: %s", exc)


def prewarm_clip() -> None:
    clip_cache = CACHE_DIR / "clip"
    clip_cache.mkdir(parents=True, exist_ok=True)

    # Check if already downloaded
    existing = list(clip_cache.glob("ViT-B-32*.pt"))
    if existing:
        log.info("  ✓ CLIP ViT-B/32 already cached")
        return
    try:
        import clip  # openai-clip
        log.info("Downloading CLIP ViT-B/32 …")
        clip.load("ViT-B/32", device="cpu", download_root=str(clip_cache))
        log.info("  ✓ CLIP ViT-B/32 ready")
    except Exception as exc:
        log.warning("  ✗ CLIP download failed: %s", exc)


def prewarm_insightface() -> None:
    insightface_root = CACHE_DIR / "insightface"
    buffalo_dir = insightface_root / "models" / "buffalo_l"
    if buffalo_dir.exists() and any(buffalo_dir.iterdir()):
        log.info("  ✓ InsightFace buffalo_l already present")
        return
    try:
        from insightface.app import FaceAnalysis
        log.info("Downloading InsightFace buffalo_l …")
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(insightface_root),
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1)
        log.info("  ✓ InsightFace buffalo_l ready")
    except Exception as exc:
        log.warning("  ✗ InsightFace download failed: %s", exc)


def prewarm_paddleocr() -> None:
    paddle_dir = CACHE_DIR / "paddleocr"
    paddle_dir.mkdir(parents=True, exist_ok=True)
    # PaddleOCR caches to ~/.paddleocr — we redirect via symlink in entrypoint.sh
    # Here we just trigger the download so it lands in the persisted volume
    existing_en = list(paddle_dir.glob("**/en_PP*"))
    if existing_en:
        log.info("  ✓ PaddleOCR (en) already cached")
        return
    try:
        from paddleocr import PaddleOCR
        log.info("Downloading PaddleOCR models (en) …")
        PaddleOCR(lang="en")
        log.info("  ✓ PaddleOCR (en) ready")
    except Exception as exc:
        log.warning("  ✗ PaddleOCR download failed: %s", exc)


def prewarm_mediapipe() -> None:
    try:
        import mediapipe as mp
        log.info("Pre-warming MediaPipe Pose …")
        mp_pose = mp.solutions.pose
        with mp_pose.Pose(static_image_mode=True, model_complexity=1):
            pass
        log.info("  ✓ MediaPipe Pose ready")
    except Exception as exc:
        log.warning("  ✗ MediaPipe pre-warm failed: %s", exc)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    skip = os.environ.get("SKIP_MODEL_DOWNLOAD", "").lower() in ("1", "true", "yes")
    force = os.environ.get("FORCE_MODEL_DOWNLOAD", "").lower() in ("1", "true", "yes")

    if skip:
        log.info("SKIP_MODEL_DOWNLOAD set — exiting")
        return

    if FLAG_FILE.exists() and not force:
        log.info("Models already initialized (%s exists) — skipping", FLAG_FILE)
        log.info("Set FORCE_MODEL_DOWNLOAD=1 to re-run downloads.")
        return

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    log.info("=== OpenCCTV Model Initializer ===")
    log.info("Models dir : %s", MODELS_DIR)
    log.info("Cache dir  : %s", CACHE_DIR)

    # ── YOLO weights ──────────────────────────────────────────────────────────
    log.info("── YOLO weights ──")
    download_yolov8n()
    download_hf_models()
    create_yolov8n_aliases()

    # ── Auto-download libraries ───────────────────────────────────────────────
    log.info("── ML libraries ──")
    setup_paddleocr_cache()
    prewarm_clip()
    prewarm_insightface()
    prewarm_paddleocr()
    prewarm_mediapipe()

    # Mark as done
    FLAG_FILE.write_text("initialized\n")
    log.info("=== Done — wrote %s ===", FLAG_FILE)


if __name__ == "__main__":
    main()
