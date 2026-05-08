from fastapi import APIRouter

from app.api.v1 import auth, cameras, events, frigate_config, plugins, recordings, servers, system, system_config, users

router = APIRouter()

router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(servers.router, prefix="/servers", tags=["servers"])
router.include_router(cameras.router, prefix="/cameras", tags=["cameras"])
router.include_router(frigate_config.router, prefix="/frigate-config", tags=["frigate-config"])
router.include_router(events.router, prefix="/events", tags=["events"])
router.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(plugins.router, prefix="/plugins", tags=["plugins"])
router.include_router(system.router, prefix="/system", tags=["system"])
router.include_router(system_config.router, prefix="/system/config", tags=["system-config"])
