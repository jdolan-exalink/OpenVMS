"""
MQTTService

Consumes events from multiple Frigate MQTT brokers simultaneously.
Each FrigateServer can have its own broker (mqtt_host / mqtt_port).

Connection lifecycle:
  - One asyncio.Task per broker.
  - Exponential backoff on disconnect: 1s → 2s → 4s → ... → 60s max.
  - aiomqtt client for async operation.

Topics subscribed per broker:
  frigate/events          → detection events (new, update, end)
  frigate/+/events        → alternate format with camera in topic
  frigate/stats           → server stats heartbeat
"""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

import aiomqtt

log = logging.getLogger(__name__)

_MAX_BACKOFF = 60
_FRIGATE_TOPICS = [
    "frigate/events",
    "frigate/+/events",
    "frigate/stats",
]


class MQTTService:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = False

    async def start(self, servers: list) -> None:
        """Start one broker task per server that has mqtt_host configured."""
        self._running = True
        for server in servers:
            if not server.mqtt_host:
                log.info("Server %s has no mqtt_host, skipping MQTT", server.name)
                continue
            await self._start_server(server)
        log.info("MQTTService started %d broker task(s)", len(self._tasks))

    async def _start_server(self, server: object) -> None:
        """Start a broker task for a single server. Idempotent — replaces existing task."""
        server_name: str = server.name  # type: ignore[attr-defined]
        if server_name in self._tasks:
            self._tasks[server_name].cancel()
            del self._tasks[server_name]
        if not self._running or not server.mqtt_host:  # type: ignore[attr-defined]
            return
        task = asyncio.create_task(
            self._broker_loop(server),
            name=f"mqtt-{server_name}",
        )
        self._tasks[server_name] = task
        log.info("MQTTService started task for server %s", server_name)

    async def start_one(self, server: object) -> None:
        """Start MQTT task for a newly created or updated server."""
        if not self._running:
            self._running = True
        await self._start_server(server)

    async def stop_one(self, server_name: str) -> None:
        """Stop MQTT task for a specific server by name."""
        if server_name in self._tasks:
            self._tasks[server_name].cancel()
            del self._tasks[server_name]
            log.info("MQTTService stopped task for server %s", server_name)

    async def remove_server(self, server_name: str) -> None:
        """Remove and cancel the MQTT task for a server by name."""
        if server_name in self._tasks:
            self._tasks[server_name].cancel()
            del self._tasks[server_name]
            log.info("MQTTService removed task for server %s", server_name)

    async def stop(self) -> None:
        """Cancel all broker tasks and wait for them to finish."""
        self._running = False
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
        log.info("MQTTService stopped")

    async def _broker_loop(self, server: object) -> None:
        """Reconnect loop with exponential backoff for a single broker."""
        attempt = 0
        server_id: UUID = server.id  # type: ignore[attr-defined]
        host: str = server.mqtt_host  # type: ignore[attr-defined]
        port: int = server.mqtt_port  # type: ignore[attr-defined]
        username: str | None = getattr(server, "mqtt_username", None)  # type: ignore[attr-defined]
        password: str | None = getattr(server, "mqtt_password", None)  # type: ignore[attr-defined]
        server_name: str = server.name  # type: ignore[attr-defined]

        while self._running:
            try:
                log.info("Connecting to MQTT broker %s:%d (server: %s)", host, port, server_name)
                client_kwargs: dict = {"hostname": host, "port": port}
                if username:
                    client_kwargs["username"] = username
                    client_kwargs["password"] = password
                async with aiomqtt.Client(**client_kwargs) as client:
                    attempt = 0  # reset backoff on successful connect
                    for topic in _FRIGATE_TOPICS:
                        await client.subscribe(topic)
                    log.info("MQTT connected to %s, subscribed to Frigate topics", server_name)

                    async for message in client.messages:
                        if not self._running:
                            return
                        await self._dispatch(
                            server_id=server_id,
                            topic=str(message.topic),
                            payload=message.payload,  # type: ignore[arg-type]
                        )
            except aiomqtt.MqttError as exc:
                if not self._running:
                    return
                delay = min(2**attempt, _MAX_BACKOFF)
                log.warning(
                    "MQTT broker %s disconnected (%s). Reconnecting in %ds (attempt %d)",
                    server_name,
                    exc,
                    delay,
                    attempt + 1,
                )
                attempt += 1
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                if not self._running:
                    return
                delay = min(2**attempt, _MAX_BACKOFF)
                log.error("Unexpected MQTT error for %s: %s. Retrying in %ds", server_name, exc, delay)
                attempt += 1
                await asyncio.sleep(delay)

    async def _dispatch(self, server_id: UUID, topic: str, payload: bytes) -> None:
        """
        Pull a fresh DB session and Redis client, process the message.
        Session is short-lived per message to avoid holding connections.
        """
        from app.database import AsyncSessionLocal
        from app.deps import get_redis
        from app.services import event_service

        try:
            async with AsyncSessionLocal() as db:
                redis = get_redis()
                await event_service.process_mqtt_message(server_id, topic, payload, db, redis)
        except Exception as exc:
            log.error("Error processing MQTT message on topic %s: %s", topic, exc)


# Singleton used by main.py lifespan
mqtt_service = MQTTService()
