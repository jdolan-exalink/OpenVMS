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
# NOTE: The LPR model is handled separately by download_lpr_model() below
# because it needs a PT→ONNX export fallback.
HF_YOLO_MODELS: list[tuple[str, str, str]] = []

# Plugins that use a generic YOLOv8n person/object detector as base.
YOLOV8N_ALIASES = [
    "epp_yolo.pt",
    "abandoned_object_yolo.pt",
    "smoke_fire_yolo.pt",  # placeholder — replace with a fire/smoke-trained model
]

# Direct URL for YOLOv8n base weights (stable Ultralytics release)
YOLOV8N_URL = (
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt"
)

# LPR model — YOLOv8n fine-tuned on license plate detection (class: "license-plate")
# Produces /models/license_plate_detector.onnx for CPU inference via ONNXRuntime.
_LPR_HF_REPO = "keremberke/yolov8n-license-plate-detection"
_LPR_ONNX_DEST = "license_plate_detector.onnx"
_LPR_PT_DEST = "license_plate_detector.pt"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n //= 1024
    return f"{n:.1f} TB"


def _download_url(url: str, dest: Path, label: str) -> bool:
    log.info("Downloading %s …", label)
    tmp = dest.with_suffix(".tmp")
    try:
        urllib.request.urlretrieve(url, str(tmp))
        tmp.rename(dest)
        log.info("  ✓ %s saved (%s)", label, _human_size(dest.stat().st_size))
        return True
    except Exception as exc:
        log.warning("  ✗ %s failed: %s", label, exc)
        tmp.unlink(missing_ok=True)
        return False


def _hf_url(repo_id: str, filename: str) -> str:
    return f"https://huggingface.co/{repo_id}/resolve/main/{filename}"


def _export_pt_to_onnx(pt_path: Path, onnx_dest: Path) -> bool:
    """Export a YOLO .pt model to ONNX using ultralytics. Returns True on success."""
    log.info("Exporting %s → ONNX (this takes ~30s on first run) …", pt_path.name)
    try:
        from ultralytics import YOLO
        model = YOLO(str(pt_path))
        model.export(format="onnx", opset=17, simplify=True)
        # ultralytics places the export alongside the source file with .onnx suffix
        auto_path = pt_path.with_suffix(".onnx")
        if auto_path.exists():
            if auto_path != onnx_dest:
                shutil.move(str(auto_path), str(onnx_dest))
            log.info("  ✓ %s ready (%s)", onnx_dest.name, _human_size(onnx_dest.stat().st_size))
            return True
        log.warning("  ✗ export did not produce %s", auto_path)
        return False
    except Exception as exc:
        log.warning("  ✗ ONNX export failed: %s", exc)
        return False


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
        _download_url(_hf_url(repo_id, filename), dest, f"{dest_name} ({repo_id})")


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


def download_lpr_model() -> bool:
    """Ensure /models/license_plate_detector.onnx exists for the lpr_advanced plugin.

    Strategy (tries each step until one succeeds):
      1. Skip if .onnx already present.
      2. Download LP-specific ONNX directly from HuggingFace.
      3. Download LP-specific .pt from HuggingFace and export to ONNX.
      4. Export the already-present yolov8n.pt as a vehicle-mode fallback.
         In this mode the plugin OCRs the lower portion of detected vehicles
         instead of dedicated plate detections — fully functional without any
         external download.
    """
    onnx_dest = MODELS_DIR / _LPR_ONNX_DEST
    if onnx_dest.exists():
        log.info("  ✓ %s already present", _LPR_ONNX_DEST)
        return True

    log.info("── LPR model ──")

    # Attempt 1: direct ONNX from HuggingFace
    if _download_url(_hf_url(_LPR_HF_REPO, "best.onnx"), onnx_dest, f"{_LPR_ONNX_DEST} (direct ONNX)"):
        return True

    # Attempt 2: download .pt then export
    pt_dest = MODELS_DIR / _LPR_PT_DEST
    if not pt_dest.exists():
        _download_url(_hf_url(_LPR_HF_REPO, "best.pt"), pt_dest, f"{_LPR_PT_DEST} (LPR base)")
    if pt_dest.exists() and _export_pt_to_onnx(pt_dest, onnx_dest):
        return True

    # Attempt 3: export yolov8n.pt → license_plate_detector.onnx (vehicle-mode fallback)
    yolov8n = MODELS_DIR / "yolov8n.pt"
    if yolov8n.exists():
        log.info("HuggingFace unavailable — exporting yolov8n.pt as vehicle-mode LPR fallback …")
        if _export_pt_to_onnx(yolov8n, onnx_dest):
            log.info("  ✓ %s ready (vehicle+OCR mode — replace with a LP-specific model for better accuracy)", _LPR_ONNX_DEST)
            return True

    log.warning("  ✗ LPR model setup failed — lpr_advanced plugin will not detect plates")
    return False


def setup_paddleocr_cache() -> None:
    """Redirect ~/.paddleocr → /models/.cache/paddleocr so it persists across restarts."""
    paddle_cache = CACHE_DIR / "paddleocr"
    paddle_cache.mkdir(parents=True, exist_ok=True)
    paddle_home = Path.home() / ".paddleocr"
    if paddle_home.is_symlink() and paddle_home.resolve() == paddle_cache.resolve():
        return
    if paddle_home.exists() and not paddle_home.is_symlink():
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

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # ── Phase 1: YOLO/model file downloads — always run, idempotent ─────────────
    # Fast (file-existence checks). Runs every deploy so newly added models are
    # picked up even when the .initialized flag already exists.
    log.info("── YOLO weights ──")
    download_yolov8n()
    download_hf_models()
    create_yolov8n_aliases()
    download_lpr_model()

    # ── Phase 2: Heavyweight ML library initialization — run only once ───────────
    if FLAG_FILE.exists() and not force:
        log.info("ML libraries already initialized (%s exists) — done", FLAG_FILE)
        log.info("Set FORCE_MODEL_DOWNLOAD=1 to re-run library pre-warming.")
        return

    log.info("=== OpenCCTV Model Initializer (first run) ===")
    log.info("Models dir : %s", MODELS_DIR)
    log.info("Cache dir  : %s", CACHE_DIR)

    log.info("── ML libraries ──")
    setup_paddleocr_cache()
    prewarm_clip()
    prewarm_insightface()
    prewarm_paddleocr()
    prewarm_mediapipe()

    FLAG_FILE.write_text("initialized\n")
    log.info("=== Done — wrote %s ===", FLAG_FILE)


if __name__ == "__main__":
    main()
