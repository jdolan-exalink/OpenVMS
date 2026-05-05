"""
Notifications Plugin

Sends configurable alerts when Frigate events match defined rules.

Supported channels:
  - telegram: POST to Telegram Bot API with event details
  - webhook:  POST JSON payload to any URL

Config structure (stored in plugins.config JSONB):
{
  "rules": [
    {
      "name": "Person at entrance",
      "cameras": ["cam1", "cam2"],   // [] = all cameras
      "labels": ["person"],          // [] = all labels
      "min_score": 0.75,
      "zones": ["zona_entrada"],     // [] = any zone
      "channel": "telegram",         // "telegram" | "webhook"
      "cooldown_seconds": 60,
      "telegram": {"bot_token": "...", "chat_id": "..."},
      "webhook": {"url": "...", "headers": {}, "extra_fields": {}}
    }
  ]
}

Cooldown is tracked per-rule in Redis to avoid notification floods.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import httpx

from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)

_COOLDOWN_PREFIX = "notif:cooldown:"


class NotificationsPlugin(BasePlugin):
    name = "notifications"
    display_name = "Alertas Multicanal"
    version = "1.0.0"
    description = "Envía alertas por Telegram o Webhook según reglas configurables de label, cámara, zona y score mínimo"
    category = "notifications"
    has_sidebar_page = True
    sidebar_icon = "🔔"
    sidebar_label = "Alertas"
    sidebar_route = "notifications"

    _rules: list[dict]

    async def on_load(self, config: dict) -> None:
        self._rules = [self._normalize_rule(rule) for rule in config.get("rules", [])]
        log.info("Notifications plugin loaded with %d rule(s)", len(self._rules))

    @staticmethod
    def _normalize_rule(rule: dict) -> dict:
        return {
            "name": rule.get("name") or "Regla sin nombre",
            "enabled": rule.get("enabled", True),
            "cameras": rule.get("cameras", []),
            "labels": rule.get("labels", []),
            "min_score": float(rule.get("min_score", 0.0)),
            "zones": rule.get("zones", []),
            "time_from": rule.get("time_from", ""),
            "time_to": rule.get("time_to", ""),
            "channel": rule.get("channel", "telegram"),
            "cooldown_seconds": int(rule.get("cooldown_seconds", 60)),
            "telegram": rule.get("telegram", {}),
            "webhook": rule.get("webhook", {}),
        }

    async def on_event(self, event: dict) -> None:
        if not self._rules:
            return

        label: str = event.get("label", "")
        camera_id: str | None = event.get("camera_id")
        camera_name: str | None = event.get("camera_name")
        score: float | None = event.get("score")
        zones: list[str] = event.get("zones") or []
        timestamp: str = event.get("timestamp", datetime.now(timezone.utc).isoformat())

        for rule in self._rules:
            if not rule.get("enabled", True):
                continue
            if not self._matches(rule, label, camera_id, camera_name, score, zones):
                continue
            if not await self._check_cooldown(rule, event):
                continue
            await self._send(rule, event)
            await self._set_cooldown(rule, event, rule.get("cooldown_seconds", 60))

    def _matches(
        self,
        rule: dict,
        label: str,
        camera_id: str | None,
        camera_name: str | None,
        score: float | None,
        zones: list[str],
    ) -> bool:
        allowed_labels: list[str] = rule.get("labels", [])
        if allowed_labels and label not in allowed_labels:
            return False

        allowed_cameras: list[str] = rule.get("cameras", [])
        if allowed_cameras and camera_name not in allowed_cameras and camera_id not in allowed_cameras:
            return False

        min_score: float = rule.get("min_score", 0.0)
        if score is not None and score < min_score:
            return False

        required_zones: list[str] = rule.get("zones", [])
        if required_zones and not any(z in zones for z in required_zones):
            return False

        time_from: str = rule.get("time_from", "")
        time_to: str = rule.get("time_to", "")
        if time_from and time_to:
            now = datetime.now().strftime("%H:%M")
            if not self._in_time_range(now, time_from, time_to):
                return False

        return True

    @staticmethod
    def _in_time_range(current: str, time_from: str, time_to: str) -> bool:
        if time_from <= time_to:
            return time_from <= current <= time_to
        # Spans midnight (e.g. 22:00–06:00)
        return current >= time_from or current <= time_to

    async def _check_cooldown(self, rule: dict, event: dict) -> bool:
        """Return True if the rule is NOT in cooldown (i.e. should fire)."""
        try:
            from app.deps import get_redis
            redis = get_redis()
            key = self._cooldown_key(rule, event)
            return not await redis.exists(key)
        except Exception:
            return True  # if Redis unavailable, allow notification

    async def _set_cooldown(self, rule: dict, event: dict, seconds: int) -> None:
        try:
            from app.deps import get_redis
            redis = get_redis()
            key = self._cooldown_key(rule, event)
            await redis.setex(key, seconds, "1")
        except Exception:
            pass

    @staticmethod
    def _cooldown_key(rule: dict, event: dict) -> str:
        scope = rule.get("cooldown_scope", "camera_label")
        parts = [rule.get("name", "default")]
        if scope in ("camera", "camera_label"):
            parts.append(str(event.get("camera_id") or event.get("camera_name") or "all"))
        if scope == "camera_label":
            parts.append(str(event.get("label") or "event"))
        return _COOLDOWN_PREFIX + ":".join(parts)

    async def _send(self, rule: dict, event: dict) -> None:
        channel: str = rule.get("channel", "webhook")
        try:
            if channel == "telegram":
                await self._send_telegram(rule, event)
            elif channel == "webhook":
                await self._send_webhook(rule, event)
            else:
                log.warning("Unknown notification channel: %s", channel)
        except Exception as exc:
            log.error("Notification send failed (rule=%s): %s", rule.get("name"), exc)

    async def _send_telegram(self, rule: dict, event: dict) -> None:
        cfg = rule.get("telegram", {})
        bot_token: str | None = cfg.get("bot_token")
        chat_id: str | None = cfg.get("chat_id")
        if not bot_token or not chat_id:
            log.warning("Telegram rule '%s' missing bot_token or chat_id", rule.get("name"))
            return

        text = (
            f"🚨 *OpenCCTV Alert*\n"
            f"*Rule:* {rule.get('name', 'unnamed')}\n"
            f"*Label:* {event.get('label', '?')}\n"
            f"*Camera:* {event.get('camera_name', event.get('camera_id', '?'))}\n"
            f"*Score:* {event.get('score', '?')}\n"
            f"*Zones:* {', '.join(event.get('zones') or []) or '—'}\n"
            f"*Time:* {event.get('timestamp', '?')}"
        )
        if plate := event.get("plate_number"):
            text += f"\n*Plate:* `{plate}`"

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            )

    async def _send_webhook(self, rule: dict, event: dict) -> None:
        cfg = rule.get("webhook", {})
        url: str | None = cfg.get("url")
        if not url:
            log.warning("Webhook rule '%s' missing url", rule.get("name"))
            return

        headers: dict = {"Content-Type": "application/json", **cfg.get("headers", {})}
        payload = {
            "rule_name": rule.get("name"),
            "event": event,
            **cfg.get("extra_fields", {}),
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "title": "Configuración Notificaciones",
            "properties": {
                "rules": {
                    "type": "array",
                    "title": "Reglas de notificación",
                    "description": "Lista de reglas — cada una define condiciones y canal de envío",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "title": "Nombre de la regla"},
                            "enabled": {
                                "type": "boolean",
                                "title": "Regla activa",
                                "default": True,
                            },
                            "cameras": {
                                "type": "array",
                                "title": "Cámaras (vacío = todas)",
                                "items": {"type": "string"},
                            },
                            "labels": {
                                "type": "array",
                                "title": "Labels (vacío = todos)",
                                "items": {"type": "string"},
                            },
                            "time_from": {
                                "type": "string",
                                "title": "Hora inicio (HH:MM)",
                                "pattern": "^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
                                "default": "",
                            },
                            "time_to": {
                                "type": "string",
                                "title": "Hora fin (HH:MM)",
                                "pattern": "^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
                                "default": "",
                            },
                            "min_score": {
                                "type": "number",
                                "title": "Confianza mínima",
                                "minimum": 0.0,
                                "maximum": 1.0,
                                "default": 0.5,
                            },
                            "cooldown_seconds": {
                                "type": "integer",
                                "title": "Cooldown (s)",
                                "default": 60,
                                "minimum": 10,
                            },
                            "cooldown_scope": {
                                "type": "string",
                                "title": "Alcance del cooldown",
                                "enum": ["global", "camera", "camera_label"],
                                "default": "camera_label",
                                "description": "Controla si el cooldown aplica globalmente, por cámara o por cámara+label.",
                            },
                            "channel": {
                                "type": "string",
                                "title": "Canal",
                                "enum": ["telegram", "webhook"],
                                "default": "telegram",
                            },
                            "telegram": {
                                "type": "object",
                                "title": "Telegram",
                                "properties": {
                                    "bot_token": {"type": "string", "title": "Bot token"},
                                    "chat_id": {"type": "string", "title": "Chat ID"},
                                },
                            },
                            "webhook": {
                                "type": "object",
                                "title": "Webhook",
                                "properties": {
                                    "url": {"type": "string", "title": "URL"},
                                    "headers": {"type": "object", "title": "Headers", "default": {}},
                                    "extra_fields": {"type": "object", "title": "Campos extra", "default": {}},
                                },
                            },
                        },
                    },
                    "default": [],
                }
            },
        }

    async def on_unload(self) -> None:
        log.info("Notifications plugin unloaded")
