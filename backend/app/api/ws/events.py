"""
WebSocket endpoint — real-time event push to frontend clients.

URL: ws://<host>/ws/events?token=<jwt>

Auth: JWT via query param (browsers can't set headers on WebSocket connections).

Client → server messages (JSON):
  {"type": "subscribe",        "camera_ids": ["uuid1", "uuid2"]}
  {"type": "subscribe_server", "server_ids": ["uuid1"]}
  {"type": "ping"}

Server → client messages (JSON):
  {"type": "event",         ...event fields...}
  {"type": "server_status", "server_id": "uuid", "online": bool}
  {"type": "pong"}
  {"type": "error",         "detail": "..."}

Implementation:
  - Redis pub/sub on channel "vms:events" (published by EventService)
  - Per-client filter set updated via subscribe messages
  - Heartbeat: server sends ping every 30s, closes if no pong in 10s
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

router = APIRouter()
log = logging.getLogger(__name__)

_PING_INTERVAL = 30
_PONG_TIMEOUT = 10


@router.websocket("/events")
async def events_ws(
    websocket: WebSocket,
    token: str = Query(...),
):
    # 1. Authenticate via JWT query param
    try:
        from app.services.auth_service import verify_token
        payload = verify_token(token, expected_type="access")
        user_id = uuid.UUID(payload["sub"])
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return

    await websocket.accept()
    log.info("WebSocket connected: user=%s", user_id)

    # Per-connection subscription state
    subscribed_cameras: set[str] = set()   # empty = all cameras
    subscribed_servers: set[str] = set()   # empty = all servers

    # 2. Open Redis pub/sub
    from app.deps import get_redis
    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("vms:events")

    pong_received = asyncio.Event()
    pong_received.set()  # treat as received initially

    async def _reader():
        """Read messages from the client (subscribe commands, pong)."""
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                msg_type = msg.get("type")
                if msg_type == "subscribe":
                    cam_ids = msg.get("camera_ids", [])
                    subscribed_cameras.clear()
                    subscribed_cameras.update(str(c) for c in cam_ids)
                elif msg_type == "subscribe_server":
                    srv_ids = msg.get("server_ids", [])
                    subscribed_servers.clear()
                    subscribed_servers.update(str(s) for s in srv_ids)
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "pong":
                    pong_received.set()
        except (WebSocketDisconnect, RuntimeError):
            pass

    async def _broadcaster():
        """Forward Redis pub/sub messages to the WebSocket client."""
        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError):
                    continue

                # Apply subscription filters
                if subscribed_cameras:
                    cam_id = data.get("camera_id")
                    if cam_id and cam_id not in subscribed_cameras:
                        continue
                if subscribed_servers:
                    srv_id = data.get("server_id")
                    if srv_id and srv_id not in subscribed_servers:
                        continue

                await websocket.send_json(data)
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception as exc:
            log.warning("WebSocket broadcaster error: %s", exc)

    async def _heartbeat():
        """Send ping every 30s, close if no pong in 10s."""
        try:
            while True:
                await asyncio.sleep(_PING_INTERVAL)
                pong_received.clear()
                await websocket.send_json({"type": "ping"})
                try:
                    await asyncio.wait_for(pong_received.wait(), timeout=_PONG_TIMEOUT)
                except asyncio.TimeoutError:
                    log.info("WebSocket ping timeout, closing user=%s", user_id)
                    await websocket.close(code=status.WS_1001_GOING_AWAY)
                    return
        except (WebSocketDisconnect, RuntimeError):
            pass

    # 3. Run reader, broadcaster and heartbeat concurrently
    tasks = [
        asyncio.create_task(_reader(), name="ws-reader"),
        asyncio.create_task(_broadcaster(), name="ws-broadcaster"),
        asyncio.create_task(_heartbeat(), name="ws-heartbeat"),
    ]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    finally:
        await pubsub.unsubscribe("vms:events")
        await pubsub.aclose()
        log.info("WebSocket disconnected: user=%s", user_id)
