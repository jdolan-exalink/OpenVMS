"""
FrigateService — pool of async HTTP clients toward multiple Frigate servers.

Two connection modes:
  - Port 5000 (no auth): for servers on the same Docker network.
  - Port 8971 (JWT cookie): for remote/external servers.

Set api_key to "username:password" on the FrigateServer row to enable auth mode.
"""

from __future__ import annotations

import asyncio
import json
import time
from uuid import UUID

import httpx
from redis.asyncio import Redis

_CACHE_TTL_CAMERAS = 60
_CACHE_TTL_CONFIG = 30
_CACHE_TTL_SCHEMA = 3600


class FrigateConnectionError(Exception):
    pass


class FrigateConfigError(ValueError):
    pass


class FrigateClient:
    """Async HTTP client for a single Frigate server."""

    def __init__(
        self,
        base_url: str,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._token: str | None = None
        self._use_auth = username is not None and password is not None
        self._http = httpx.AsyncClient(timeout=10.0)

    # ── auth ─────────────────────────────────────────────────────────────────

    async def _login(self) -> None:
        resp = await self._http.post(
            f"{self.base_url}/api/login",
            data={"user": self._username, "password": self._password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        cookie = resp.cookies.get("frigate_token")
        if not cookie:
            raise FrigateConnectionError("Login succeeded but frigate_token cookie missing")
        self._token = cookie

    def _cookies(self) -> dict[str, str]:
        if self._use_auth and self._token:
            return {"frigate_token": self._token}
        return {}

    async def _request(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        if self._use_auth and not self._token:
            await self._login()
        url = f"{self.base_url}{path}"
        resp = await self._http.request(method, url, cookies=self._cookies(), **kwargs)
        if resp.status_code == 401 and self._use_auth:
            await self._login()
            resp = await self._http.request(method, url, cookies=self._cookies(), **kwargs)
        return resp

    async def get(self, path: str, **kw: object) -> httpx.Response:
        return await self._request("GET", path, **kw)

    async def put(self, path: str, **kw: object) -> httpx.Response:
        return await self._request("PUT", path, **kw)

    async def post(self, path: str, **kw: object) -> httpx.Response:
        return await self._request("POST", path, **kw)

    async def delete(self, path: str, **kw: object) -> httpx.Response:
        return await self._request("DELETE", path, **kw)

    # ── health ───────────────────────────────────────────────────────────────

    async def health_check(self) -> dict:
        try:
            resp = await self._http.get(f"{self.base_url}/", timeout=5.0)
            return {"online": resp.status_code == 200}
        except httpx.ConnectError:
            return {"online": False, "error": "connection_refused"}
        except httpx.TimeoutException:
            return {"online": False, "error": "timeout"}

    # ── system ───────────────────────────────────────────────────────────────

    async def get_version(self) -> str:
        """Response is plain text, not JSON."""
        resp = await self.get("/api/version")
        resp.raise_for_status()
        return resp.text.strip()

    async def get_stats(self) -> dict:
        resp = await self.get("/api/stats")
        resp.raise_for_status()
        return resp.json()

    # ── config ────────────────────────────────────────────────────────────────

    async def get_config(self) -> dict:
        """Full config as JSON with defaults merged in."""
        resp = await self.get("/api/config")
        resp.raise_for_status()
        return resp.json()

    async def get_config_schema(self) -> dict:
        """JSON Schema for config validation. Endpoint: /api/config/schema.json"""
        resp = await self.get("/api/config/schema.json")
        resp.raise_for_status()
        return resp.json()

    async def get_config_raw(self) -> str:
        """Raw YAML as stored on disk (no merged defaults)."""
        resp = await self.get("/api/config/raw")
        resp.raise_for_status()
        return resp.text

    async def config_set(self, config: dict) -> dict:
        """
        Apply config in memory. Does NOT persist to disk.
        Must send the FULL config — Frigate replaces, does not merge.
        Correct flow: get_config() → mutate → config_set() → config_save()
        """
        resp = await self.put("/api/config/set", json=config)
        if resp.status_code == 422:
            raise FrigateConfigError(f"Invalid config: {resp.json()}")
        resp.raise_for_status()
        return resp.json()

    async def config_save(self) -> dict:
        """Persist current in-memory config to disk (config.yml)."""
        resp = await self.post("/api/config/save")
        resp.raise_for_status()
        return resp.json()

    async def config_revert(self) -> dict:
        """Revert unsaved in-memory changes."""
        resp = await self.post("/api/config/revert")
        resp.raise_for_status()
        return resp.json()

    # ── cameras ───────────────────────────────────────────────────────────────

    async def get_cameras(self) -> dict:
        """Returns {camera_name: camera_data} dict."""
        resp = await self.get("/api/cameras")
        if resp.status_code != 404:
            resp.raise_for_status()
            return resp.json()

        # Frigate 0.17 exposes cameras under the merged config instead of
        # /api/cameras. Keep this fallback so sync works across versions.
        config = await self.get_config()
        return config.get("cameras") or {}

    async def get_snapshot(
        self,
        camera_name: str,
        height: int | None = None,
        quality: int | None = None,
    ) -> bytes:
        params: dict[str, int] = {}
        if height is not None:
            params["h"] = height
        if quality is not None:
            params["quality"] = quality
        resp = await self.get(f"/api/{camera_name}/latest.jpg", params=params or None)
        resp.raise_for_status()
        return resp.content

    async def get_recordings(
        self,
        camera_name: str,
        after: float | None = None,
        before: float | None = None,
    ) -> list[dict]:
        params: dict = {}
        if after is not None:
            params["after"] = after
        if before is not None:
            params["before"] = before
        resp = await self.get(f"/api/{camera_name}/recordings", params=params)
        resp.raise_for_status()
        return resp.json()

    # ── events ────────────────────────────────────────────────────────────────

    async def get_events(
        self,
        camera: str | None = None,
        label: str | None = None,
        sub_label: str | None = None,
        after: float | None = None,
        before: float | None = None,
        limit: int = 100,
        has_clip: bool | None = None,
        has_snapshot: bool | None = None,
        min_score: float | None = None,
        in_progress: bool | None = None,
    ) -> list[dict]:
        params: dict = {"limit": limit, "include_thumbnails": 0}
        if camera:
            params["camera"] = camera
        if label:
            params["label"] = label
        if sub_label:
            params["sub_label"] = sub_label
        if after is not None:
            params["after"] = after
        if before is not None:
            params["before"] = before
        if has_clip is not None:
            params["has_clip"] = int(has_clip)
        if has_snapshot is not None:
            params["has_snapshot"] = int(has_snapshot)
        if min_score is not None:
            params["min_score"] = min_score
        if in_progress is not None:
            params["in_progress"] = int(in_progress)
        resp = await self.get("/api/events", params=params)
        resp.raise_for_status()
        return resp.json()

    # ── go2rtc ────────────────────────────────────────────────────────────────

    async def get_go2rtc_streams(self) -> dict:
        resp = await self.get("/api/go2rtc/streams")
        resp.raise_for_status()
        return resp.json()

    async def get_go2rtc_stream(self, name: str) -> dict | None:
        resp = await self.get(f"/api/go2rtc/streams/{name}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    async def add_go2rtc_stream(self, name: str, url: str | list[str]) -> dict:
        resp = await self.post("/api/go2rtc/streams", json={"name": name, "url": url})
        resp.raise_for_status()
        return resp.json()

    async def delete_go2rtc_stream(self, name: str) -> bool:
        resp = await self.delete(f"/api/go2rtc/streams/{name}")
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True

    # ── PTZ ──────────────────────────────────────────────────────────────────

    async def ptz_move(self, camera_name: str, action: str, speed: float = 1.0) -> dict:
        resp = await self.post(
            f"/api/{camera_name}/ptz/move",
            json={"action": action, "speed": speed},
        )
        resp.raise_for_status()
        return resp.json()

    async def close(self) -> None:
        await self._http.aclose()


class FrigateService:
    """Pool of FrigateClient instances keyed by server UUID."""

    _clients: dict[str, FrigateClient] = {}

    @classmethod
    def _key(cls, server_id: UUID) -> str:
        return str(server_id)

    @classmethod
    def get_client(cls, server: object) -> FrigateClient:
        key = cls._key(server.id)  # type: ignore[attr-defined]
        if key not in cls._clients:
            api_key: str | None = server.api_key  # type: ignore[attr-defined]
            username = password = None
            if api_key and ":" in api_key:
                username, password = api_key.split(":", 1)
            cls._clients[key] = FrigateClient(
                base_url=server.url,  # type: ignore[attr-defined]
                username=username,
                password=password,
            )
        return cls._clients[key]

    @classmethod
    async def remove_client(cls, server_id: UUID) -> None:
        key = cls._key(server_id)
        if key in cls._clients:
            await cls._clients[key].close()
            del cls._clients[key]

    # ── cached helpers ───────────────────────────────────────────────────────

    @classmethod
    async def get_cameras_cached(cls, server: object, redis: Redis) -> dict:
        cache_key = f"frigate_cameras:{server.id}"  # type: ignore[attr-defined]
        if cached := await redis.get(cache_key):
            return json.loads(cached)
        cameras = await cls.get_client(server).get_cameras()
        await redis.setex(cache_key, _CACHE_TTL_CAMERAS, json.dumps(cameras))
        return cameras

    @classmethod
    async def invalidate_cameras_cache(cls, server_id: UUID, redis: Redis) -> None:
        await redis.delete(f"frigate_cameras:{server_id}")

    @classmethod
    async def get_config_cached(cls, server: object, redis: Redis) -> dict:
        cache_key = f"frigate_config:{server.id}"  # type: ignore[attr-defined]
        if cached := await redis.get(cache_key):
            return json.loads(cached)
        config = await cls.get_client(server).get_config()
        await redis.setex(cache_key, _CACHE_TTL_CONFIG, json.dumps(config))
        return config

    @classmethod
    async def invalidate_config_cache(cls, server_id: UUID, redis: Redis) -> None:
        await redis.delete(f"frigate_config:{server_id}")

    @classmethod
    async def get_schema_cached(cls, server: object, redis: Redis) -> dict:
        cache_key = f"frigate_schema:{server.id}"  # type: ignore[attr-defined]
        if cached := await redis.get(cache_key):
            return json.loads(cached)
        schema = await cls.get_client(server).get_config_schema()
        await redis.setex(cache_key, _CACHE_TTL_SCHEMA, json.dumps(schema))
        return schema

    # ── health ───────────────────────────────────────────────────────────────

    @classmethod
    async def health_check(cls, server: object) -> dict:
        client = cls.get_client(server)
        result = await client.health_check()
        if result.get("online"):
            try:
                t0 = time.monotonic()
                version = await client.get_version()
                latency_ms = int((time.monotonic() - t0) * 1000)
                result.update({"version": version, "latency_ms": latency_ms})
            except Exception:
                result["version"] = "unknown"
        return result

    @classmethod
    async def health_check_all(cls, servers: list) -> dict:
        tasks = {str(s.id): cls.health_check(s) for s in servers}
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        return {
            k: (v if not isinstance(v, Exception) else {"online": False, "error": str(v)})
            for k, v in zip(tasks.keys(), results)
        }

    # ── sync ─────────────────────────────────────────────────────────────────

    @classmethod
    async def sync_cameras(cls, server: object, db: object, redis: Redis) -> dict:
        """Import cameras from Frigate into the VMS cameras table (upsert)."""
        from sqlalchemy import select

        from app.models.camera import Camera
        from app.services.ome_service import OMEService

        client = cls.get_client(server)
        frigate_cameras = await client.get_cameras()
        go2rtc_streams = await client.get_go2rtc_streams()

        added = updated = unchanged = 0

        for cam_name in frigate_cameras:
            main_stream = cam_name if cam_name in go2rtc_streams else f"{cam_name}_main"
            rtsp_main = f"{server.rtsp_base}/{main_stream}"  # type: ignore[attr-defined]
            rtsp_sub = (
                f"{server.rtsp_base}/{cam_name}_sub"  # type: ignore[attr-defined]
                if f"{cam_name}_sub" in go2rtc_streams
                else None
            )
            ome_urls = OMEService.build_stream_urls(str(server.id), cam_name)  # type: ignore[attr-defined]

            result = await db.execute(  # type: ignore[attr-defined]
                select(Camera).where(
                    Camera.server_id == server.id,  # type: ignore[attr-defined]
                    Camera.frigate_name == cam_name,
                )
            )
            camera = result.scalar_one_or_none()

            if camera is None:
                camera = Camera(
                    server_id=server.id,  # type: ignore[attr-defined]
                    name=cam_name,
                    display_name=cam_name.replace("_", " ").title(),
                    frigate_name=cam_name,
                    rtsp_main=rtsp_main,
                    rtsp_sub=rtsp_sub,
                    **ome_urls,
                )
                db.add(camera)  # type: ignore[attr-defined]
                added += 1
            else:
                changed = False
                for attr, val in [("rtsp_main", rtsp_main), ("rtsp_sub", rtsp_sub), *ome_urls.items()]:
                    if getattr(camera, attr) != val:
                        setattr(camera, attr, val)
                        changed = True
                if changed:
                    updated += 1
                else:
                    unchanged += 1

        await db.commit()  # type: ignore[attr-defined]
        await cls.invalidate_cameras_cache(server.id, redis)  # type: ignore[attr-defined]
        return {"added": added, "updated": updated, "unchanged": unchanged}

    # ── proxy helpers ─────────────────────────────────────────────────────────

    @classmethod
    async def get_snapshot(
        cls,
        server: object,
        camera_name: str,
        height: int | None = None,
        quality: int | None = None,
    ) -> bytes:
        return await cls.get_client(server).get_snapshot(camera_name, height=height, quality=quality)

    @classmethod
    async def proxy_event_clip(cls, server: object, event_id: str):
        """Async generator for streaming a clip from Frigate."""
        client = cls.get_client(server)
        async with client._http.stream(
            "GET",
            f"{client.base_url}/api/events/{event_id}/clip.mp4",
            cookies=client._cookies(),
        ) as resp:
            resp.raise_for_status()
            async for chunk in resp.aiter_bytes(chunk_size=8192):
                yield chunk
