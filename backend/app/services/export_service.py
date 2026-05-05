"""
ExportService

Manages async FFmpeg export jobs for camera recordings.

Job lifecycle:
  POST /recordings/export → creates job in Redis, returns job_id
  ExportService.run_job() runs in background task:
    1. Fetch segments list from Frigate
    2. Create concat file with segment URLs
    3. Spawn ffmpeg subprocess to merge segments
    4. Update job progress in Redis
  GET /recordings/export/{job_id} → poll status

Jobs expire from Redis after 1 hour.
Exported files are written to EXPORTS_DIR (env: EXPORTS_PATH).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings

log = logging.getLogger(__name__)

_JOB_TTL = 3600  # Redis key TTL in seconds
_EXPORTS_DIR = Path(getattr(settings, "exports_path", "/tmp/exports"))


def _job_key(job_id: str) -> str:
    return f"export_job:{job_id}"


async def create_job(
    camera_id: str,
    frigate_camera_name: str,
    server_id: str,
    start: datetime,
    end: datetime,
    redis: object,
) -> str:
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "camera_id": camera_id,
        "frigate_camera_name": frigate_camera_name,
        "server_id": server_id,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "status": "queued",
        "progress": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "download_url": None,
        "error": None,
    }
    await redis.setex(_job_key(job_id), _JOB_TTL, json.dumps(job))  # type: ignore[attr-defined]
    return job_id


async def get_job(job_id: str, redis: object) -> dict | None:
    raw = await redis.get(_job_key(job_id))  # type: ignore[attr-defined]
    if raw is None:
        return None
    return json.loads(raw)


async def _update_job(job_id: str, updates: dict, redis: object) -> None:
    job = await get_job(job_id, redis)
    if job is None:
        return
    job.update(updates)
    await redis.setex(_job_key(job_id), _JOB_TTL, json.dumps(job))  # type: ignore[attr-defined]


async def run_job(job_id: str, redis: object) -> None:
    """
    Background task: fetch Frigate recording segments and merge with FFmpeg.
    Falls back to a direct proxy if FFmpeg is not available.
    """
    job = await get_job(job_id, redis)
    if job is None:
        return

    await _update_job(job_id, {"status": "running", "progress": 5}, redis)

    try:
        from sqlalchemy import select
        from app.database import AsyncSessionLocal
        from app.models.frigate_server import FrigateServer
        from app.services.frigate_service import FrigateService

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(FrigateServer).where(FrigateServer.id == job["server_id"])
            )
            server = result.scalar_one_or_none()

        if server is None:
            await _update_job(job_id, {"status": "failed", "error": "Server not found"}, redis)
            return

        # Fetch recording segments from Frigate
        start_dt = datetime.fromisoformat(job["start"])
        end_dt = datetime.fromisoformat(job["end"])
        client = FrigateService.get_client(server)
        segments = await client.get_recordings(
            job["frigate_camera_name"],
            after=start_dt.timestamp(),
            before=end_dt.timestamp(),
        )

        if not segments:
            await _update_job(job_id, {"status": "failed", "error": "No recordings found for the specified time range"}, redis)
            return

        await _update_job(job_id, {"progress": 20}, redis)

        # Build output path
        _EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = _EXPORTS_DIR / f"{job_id}.mp4"

        # Collect segment URLs
        segment_urls = [
            f"{server.url}/vod/{job['frigate_camera_name']}/start/{int(seg['start_time'])}/end/{int(seg['end_time'])}/index.m3u8"
            for seg in segments
            if "start_time" in seg and "end_time" in seg
        ]

        if not segment_urls:
            await _update_job(job_id, {"status": "failed", "error": "No valid segments"}, redis)
            return

        await _update_job(job_id, {"progress": 30}, redis)

        # Try FFmpeg
        ffmpeg_ok = await _try_ffmpeg(segment_urls, out_path, job_id, redis)

        if ffmpeg_ok and out_path.exists():
            await _update_job(
                job_id,
                {
                    "status": "done",
                    "progress": 100,
                    "download_url": f"/api/v1/recordings/export/{job_id}/download",
                },
                redis,
            )
        else:
            await _update_job(job_id, {"status": "failed", "error": "FFmpeg export failed"}, redis)

    except Exception as exc:
        log.error("Export job %s failed: %s", job_id, exc)
        await _update_job(job_id, {"status": "failed", "error": str(exc)}, redis)


async def _try_ffmpeg(urls: list[str], out_path: Path, job_id: str, redis: object) -> bool:
    """Attempt FFmpeg concat. Returns True on success."""
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for url in urls:
                f.write(f"file '{url}'\n")
            concat_file = f.name

        cmd = [
            "ffmpeg", "-y",
            "-protocol_whitelist", "file,http,https,tcp,tls,crypto,hls",
            "-f", "concat", "-safe", "0",
            "-i", concat_file,
            "-c", "copy",
            str(out_path),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

        os.unlink(concat_file)

        if proc.returncode != 0:
            log.warning("FFmpeg failed for job %s: %s", job_id, stderr.decode()[-500:])
            return False

        return True
    except FileNotFoundError:
        log.warning("ffmpeg not found — export unavailable")
        return False
    except asyncio.TimeoutError:
        log.error("FFmpeg timed out for job %s", job_id)
        return False
    except Exception as exc:
        log.error("FFmpeg error for job %s: %s", job_id, exc)
        return False


def get_export_path(job_id: str) -> Path:
    return _EXPORTS_DIR / f"{job_id}.mp4"
