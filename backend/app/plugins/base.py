from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from fastapi import APIRouter

log = logging.getLogger(__name__)


class BasePlugin(ABC):
    name: str
    version: str
    description: str
    display_name: str = ""   # Human-readable name shown in UI; falls back to `name`
    author: str = "OpenCCTV Community"
    requires_gpu: bool = False
    supports_openvino: bool = False
    min_ram_gb: int = 8
    category: str = "other"   # "recognition" | "analytics" | "safety" | "ai" | "notifications"
    tags: list[str] = []

    # Sidebar integration — set True to give the plugin its own sidebar tab
    has_sidebar_page: bool = False
    sidebar_icon: str = "🔌"
    sidebar_label: str = ""   # displayed in sidebar; falls back to `name`
    sidebar_route: str = ""   # URL segment; falls back to `name`

    _emit_alert: Optional[callable] = None

    @abstractmethod
    async def on_load(self, config: dict) -> None:
        """Initialize the plugin with its stored configuration."""

    @abstractmethod
    async def on_event(self, event: dict) -> None:
        """Called for every Frigate event received via MQTT."""

    async def on_unload(self) -> None:
        """Cleanup when the plugin is disabled or the server shuts down."""

    def get_routes(self) -> Optional[APIRouter]:
        """Return an optional APIRouter mounted at /api/v1/plugins/{name}/."""
        return None

    def get_config_schema(self) -> dict:
        """JSON Schema for the plugin configuration UI (rendered as a form)."""
        return {}

    def get_frame_subscriptions(self) -> list[str]:
        """
        List of camera_name to subscribe for on_frame() analysis.
        Return ["*"] for all cameras.
        Default: [] (no frame subscriptions).
        """
        return []

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        """Optional hook for continuous frame-by-frame analysis."""

    async def emit_alert(
        self,
        camera_id: str,
        alert_type: str,
        severity: str,
        data: dict,
        snapshot_bytes: Optional[bytes] = None,
    ) -> None:
        """Emit an alert distributed via WebSocket and configured channels."""
        if self._emit_alert is not None:
            await self._emit_alert(
                plugin_name=self.name,
                camera_id=camera_id,
                alert_type=alert_type,
                severity=severity,
                data=data,
                snapshot_bytes=snapshot_bytes,
            )

        cfg: dict = getattr(self, "_config", {})
        tg: dict = cfg.get("telegram_notify", {})
        if tg.get("enabled") and tg.get("bot_token") and tg.get("chat_id"):
            time_from: str = tg.get("time_from", "")
            time_to: str = tg.get("time_to", "")
            in_range = (
                not time_from or not time_to
                or self._tg_in_time_range(time_from, time_to)
            )
            if in_range:
                await self._send_telegram_notify(tg, alert_type, severity, camera_id, data)

    @staticmethod
    def _tg_in_time_range(time_from: str, time_to: str) -> bool:
        now = datetime.now().strftime("%H:%M")
        if time_from <= time_to:
            return time_from <= now <= time_to
        return now >= time_from or now <= time_to

    async def _send_telegram_notify(
        self, tg: dict, alert_type: str, severity: str, camera_id: str, data: dict
    ) -> None:
        try:
            import httpx
            camera = data.get("camera_name") or camera_id
            icon = {"critical": "🔴", "high": "🟠", "medium": "🟡"}.get(severity, "🔵")
            text = (
                f"{icon} *{alert_type.replace('_', ' ').title()}*\n"
                f"Plugin: `{self.name}`\n"
                f"Cámara: {camera}"
            )
            if label := data.get("label"):
                text += f"\nLabel: {label}"
            if violations := data.get("violations"):
                text += f"\nViolaciones: {', '.join(violations)}"
            if conf := data.get("confidence"):
                text += f"\nConfianza: {float(conf)*100:.0f}%"
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(
                    f"https://api.telegram.org/bot{tg['bot_token']}/sendMessage",
                    json={"chat_id": tg["chat_id"], "text": text, "parse_mode": "Markdown"},
                )
        except Exception as exc:
            log.warning("Telegram quick-notify failed (plugin=%s): %s", self.name, exc)


def set_emit_alert_func(func: callable) -> None:
    """Called by PluginRegistry on load to inject the emit_alert implementation."""
    BasePlugin._emit_alert = func
