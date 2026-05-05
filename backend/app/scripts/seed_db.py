"""
Run with: docker compose exec backend python -m app.scripts.seed_db
Or called automatically from lifespan on startup.
"""
import asyncio
import json
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import Plugin as PluginModel
from app.models.user import User
from app.services.auth_service import hash_password


async def seed_default_admin() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.username == settings.admin_username))
        if result.scalar_one_or_none() is not None:
            return

        admin = User(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            role="admin",
            full_name="Administrator",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print(f"[seed] Admin user '{settings.admin_username}' created")


DEFAULT_PLUGINS = [
    # Builtin
    {"name": "lpr", "version": "1.0.0"},
    {"name": "notifications", "version": "1.0.0"},
    # Analytics
    {"name": "loitering", "version": "1.0.0"},
    {"name": "line_crossing", "version": "1.0.0"},
    {"name": "people_counting", "version": "1.0.0"},
    {"name": "epp", "version": "1.0.0"},
    {"name": "abandoned_object", "version": "1.0.0"},
    # Safety
    {"name": "camera_sabotage", "version": "1.0.0"},
    {"name": "fall_detection", "version": "1.0.0"},
    {"name": "smoke_fire", "version": "1.0.0"},
    # Recognition
    {"name": "face_recognition", "version": "1.0.0"},
    {"name": "lpr_advanced", "version": "1.0.0"},
    {"name": "ocr_general", "version": "1.0.0"},
    # AI
    {"name": "ai_summary", "version": "1.0.0"},
    {"name": "semantic_search", "version": "1.0.0"},
]

DEFAULT_CONFIGS = {
    "lpr": {},
    "notifications": {},
    "loitering": {"zones": {}},
    "line_crossing": {"lines": {}},
    "people_counting": {"counting_lines": {}},
    "epp": {"zones": {}, "alert_cooldown": 60, "min_violation_seconds": 2},
    "abandoned_object": {"min_abandoned_seconds": 30, "movement_threshold": 50, "enabled_cameras": []},
    "camera_sabotage": {
        "blur_threshold": 50,
        "ssim_threshold": 0.4,
        "consecutive_frames_required": 3,
        "monitored_cameras": []
    },
    "fall_detection": {
        "enabled_cameras": [],
        "sensitivity": "normal",
        "alert_cooldown": 60,
        "model_complexity": 1
    },
    "smoke_fire": {"confidence": 0.4, "consecutive_frames_required": 3, "alert_cooldown": 120, "enabled_cameras": []},
    "face_recognition": {"similarity_threshold": 0.6, "enabled_cameras": []},
    "lpr_advanced": {"plate_model_path": "/models/license_plate_detector.onnx", "enabled_cameras": []},
    "ocr_general": {"enabled_cameras": [], "patterns": []},
    "ai_summary": {"ollama_url": "http://localhost:11434", "model": "llava"},
    "semantic_search": {"clip_model": "ViT-B/32", "embedding_interval": 30, "enabled_cameras": []},
}


async def seed_plugins() -> None:
    async with AsyncSessionLocal() as db:
        for plugin_data in DEFAULT_PLUGINS:
            result = await db.execute(
                select(PluginModel).where(PluginModel.name == plugin_data["name"])
            )
            if result.scalar_one_or_none() is not None:
                continue

            plugin = PluginModel(
                name=plugin_data["name"],
                version=plugin_data["version"],
                enabled=False,
                config=DEFAULT_CONFIGS.get(plugin_data["name"], {}),
            )
            db.add(plugin)
            print(f"[seed] Plugin '{plugin_data['name']}' created")

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_default_admin())
