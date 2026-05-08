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
ACCESS_LOG_FLAG="--no-access-log"
if [ "${UVICORN_ACCESS_LOG:-0}" = "1" ]; then
  ACCESS_LOG_FLAG="--access-log"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8080}" --workers 1 "$ACCESS_LOG_FLAG"
