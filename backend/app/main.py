import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import router as v1_router
from app.api.ws.events import router as ws_router
from app.config import settings
from app.limiter import limiter

log = logging.getLogger(__name__)


async def _frame_dispatch_loop(
    camera_name: str,
    rtsp_url: str,
    plugin_registry,
    fps: float = 1.0,
) -> None:
    from app.plugins.shared.frame_buffer import FrameBuffer
    fb = FrameBuffer.get_instance()
    queue = await fb.subscribe(camera_name, rtsp_url, fps=fps)
    log.info("Frame dispatch loop started: camera=%s url=%s", camera_name, rtsp_url)
    while True:
        try:
            result = await asyncio.wait_for(queue.get(), timeout=15.0)
            ts, frame_bytes, w, h = result
            await plugin_registry.dispatch_frame(camera_name, frame_bytes, ts, w, h)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            fb.stop_capture(camera_name)
            return
        except Exception as exc:
            log.warning("Frame dispatch error camera=%s: %s", camera_name, exc)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed default admin and plugins on first boot
    from app.scripts.seed_db import seed_default_admin, seed_plugins
    await seed_default_admin()
    await seed_plugins()

    # Start MQTT consumers for all enabled Frigate servers
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.frigate_server import FrigateServer
    from app.services.mqtt_service import mqtt_service

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FrigateServer).where(FrigateServer.enabled.is_(True))
        )
        servers = result.scalars().all()

    await mqtt_service.start(servers)

    # Load plugin registry (pass app so plugins can mount their routes)
    from app.plugins.registry import plugin_registry, _frame_subscriptions
    async with AsyncSessionLocal() as db:
        await plugin_registry.load_all(db, app=app)

    # Start frame capture + dispatch tasks for plugins that subscribe to frames
    frame_tasks: list[asyncio.Task] = []
    from app.models.camera import Camera
    async with AsyncSessionLocal() as db:
        cam_rows = await db.execute(select(Camera))
        all_cameras = {c.name: c for c in cam_rows.scalars().all()}

    # Cameras explicitly subscribed by plugins
    explicit_cameras: set[str] = {
        name for name in _frame_subscriptions.keys() if name != "*"
    }
    # If any plugin uses the wildcard, start loops for all cameras
    has_wildcard = "*" in _frame_subscriptions

    cameras_to_start = set(explicit_cameras)
    if has_wildcard:
        cameras_to_start.update(all_cameras.keys())

    for cam_name in cameras_to_start:
        cam = all_cameras.get(cam_name)
        if cam is None:
            log.warning("Frame subscription for unknown camera '%s' — skipped", cam_name)
            continue
        rtsp_url = cam.rtsp_sub or cam.rtsp_main
        if not rtsp_url:
            log.warning("Camera '%s' has no RTSP URL — skipped", cam_name)
            continue
        fps = 2.0 if cam_name in explicit_cameras else 1.0
        task = asyncio.create_task(
            _frame_dispatch_loop(cam_name, rtsp_url, plugin_registry, fps=fps),
            name=f"frame-{cam_name}",
        )
        frame_tasks.append(task)
        log.info("Frame dispatch scheduled: camera=%s fps=%.1f", cam_name, fps)

    yield

    # Shutdown frame tasks
    for task in frame_tasks:
        task.cancel()
    if frame_tasks:
        await asyncio.gather(*frame_tasks, return_exceptions=True)

    await mqtt_service.stop()
    await plugin_registry.unload_all()


app = FastAPI(
    title="OpenCCTV",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix="/api/v1")
app.include_router(ws_router, prefix="/ws")
