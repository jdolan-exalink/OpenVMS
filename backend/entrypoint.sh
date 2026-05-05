#!/bin/sh
set -e

# ── Redirect PaddleOCR cache to the persisted models volume ─────────────────
if [ -d /models ]; then
  mkdir -p /models/.cache/paddleocr
  ln -sfn /models/.cache/paddleocr /root/.paddleocr
fi

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Starting backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1
