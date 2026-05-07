"""
PluginRegistry — discovers and manages OpenCCTV plugins.

Discovery order:
  1. app/plugins/builtin/ — built-in plugins shipped with the project
  2. app/plugins/enterprise/ — enterprise plugins (loitering, line_crossing, etc.)
  3. /app/plugins/external/ — externally mounted plugins (Docker volume)

Lifecycle:
  load_all(db, app)  → FastAPI startup: load enabled plugins, mount their routes
  unload_all()       → FastAPI shutdown
  dispatch_event()   → called by EventService for every normalized event
  dispatch_frame()   → called by FrameBuffer for frame-driven plugins
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import pkgutil
import sys
from pathlib import Path

from app.plugins.base import BasePlugin, set_emit_alert_func
from app.plugins.shared.alert_service import alert_service, set_websocket_broadcast

log = logging.getLogger(__name__)

_active: dict[str, BasePlugin] = {}
_frame_subscriptions: dict[str, list[BasePlugin]] = {}
_frame_inflight: set[tuple[str, str]] = set()


class _PluginRegistry:
    def _active_plugins_add(self, plugin: BasePlugin) -> None:
        _active[plugin.name] = plugin
        self._register_frame_subscriptions(plugin)

    def _active_plugins_remove(self, name: str) -> None:
        plugin = _active.pop(name, None)
        if plugin is not None:
            self._unregister_frame_subscriptions(plugin)

    def get_active(self) -> dict[str, BasePlugin]:
        return dict(_active)

    @staticmethod
    async def _emit_alert_impl(
        plugin_name: str,
        camera_id: str,
        alert_type: str,
        severity: str,
        data: dict,
        snapshot_bytes: bytes | None = None,
        clip_path: str | None = None,
    ) -> None:
        await alert_service.emit(
            plugin_name=plugin_name,
            camera_id=camera_id,
            alert_type=alert_type,
            severity=severity,
            data=data,
            snapshot_bytes=snapshot_bytes,
            clip_path=clip_path,
        )

    @staticmethod
    def set_websocket_broadcast_func(func: callable) -> None:
        set_websocket_broadcast(func)

    # ── lifecycle ─────────────────────────────────────────────────────────────

    async def load_all(self, db: object, app: object = None) -> None:
        """Load plugins that are enabled in the plugins table."""
        from sqlalchemy import select
        from app.models.audit_log import Plugin as PluginModel

        set_emit_alert_func(self._emit_alert_impl)

        enabled: dict[str, dict] = {}
        try:
            result = await db.execute(  # type: ignore[attr-defined]
                select(PluginModel).where(PluginModel.enabled.is_(True))
            )
            for row in result.scalars():
                enabled[row.name] = row.config or {}
        except Exception as exc:
            log.warning("Could not query plugin table: %s", exc)

        for cls in self._discover():
            try:
                instance = cls()
                if instance.name not in enabled:
                    continue
                instance._emit_alert = self._emit_alert_impl
                await instance.on_load(enabled[instance.name])
                _active[instance.name] = instance
                self._register_frame_subscriptions(instance)
                log.info("Plugin loaded: %s v%s", instance.name, instance.version)

                if app is not None:
                    routes = instance.get_routes()
                    if routes is not None:
                        app.include_router(
                            routes, prefix=f"/api/v1/plugins/{instance.name}", tags=[f"plugin:{instance.name}"]
                        )
                        log.info("Mounted routes for plugin: %s", instance.name)
            except Exception as exc:
                log.error("Failed to load plugin %s: %s", getattr(cls, "name", "?"), exc)

    def _register_frame_subscriptions(self, plugin: BasePlugin) -> None:
        self._unregister_frame_subscriptions(plugin)
        subscriptions = plugin.get_frame_subscriptions()
        if not subscriptions:
            return
        for camera_name in subscriptions:
            if camera_name == "*":
                _frame_subscriptions.setdefault("*", []).append(plugin)
                break
            _frame_subscriptions.setdefault(camera_name, []).append(plugin)

    def _unregister_frame_subscriptions(self, plugin: BasePlugin) -> None:
        empty_keys: list[str] = []
        for camera_name, plugins in _frame_subscriptions.items():
            _frame_subscriptions[camera_name] = [p for p in plugins if p.name != plugin.name]
            if not _frame_subscriptions[camera_name]:
                empty_keys.append(camera_name)
        for camera_name in empty_keys:
            _frame_subscriptions.pop(camera_name, None)

    async def unload_all(self) -> None:
        for name, plugin in list(_active.items()):
            try:
                await plugin.on_unload()
            except Exception as exc:
                log.warning("Error unloading plugin %s: %s", name, exc)
        _active.clear()
        _frame_subscriptions.clear()

    async def dispatch_event(self, event: dict) -> None:
        if not _active:
            return
        results = await asyncio.gather(
            *(p.on_event(event) for p in _active.values()),
            return_exceptions=True,
        )
        for plugin, result in zip(_active.values(), results):
            if isinstance(result, Exception):
                log.warning("Plugin %s on_event error: %s", plugin.name, result, exc_info=result)

    async def dispatch_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        plugins = [
            *_frame_subscriptions.get(camera_name, []),
            *_frame_subscriptions.get("*", []),
        ]
        if not plugins:
            return
        tasks = [
            self._dispatch_frame_plugin(plugin, camera_name, frame, timestamp, width, height)
            for plugin in plugins
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _dispatch_frame_plugin(
        self,
        plugin: BasePlugin,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        key = (plugin.name, camera_name)
        if key in _frame_inflight:
            return
        _frame_inflight.add(key)
        timeout = float(getattr(plugin, "_config", {}).get("frame_timeout_seconds", 20))
        try:
            await asyncio.wait_for(plugin.on_frame(camera_name, frame, timestamp, width, height), timeout=timeout)
        except asyncio.TimeoutError:
            log.warning("Plugin %s on_frame timeout camera=%s", plugin.name, camera_name)
        except Exception as exc:
            log.warning("Plugin %s on_frame error camera=%s: %s", plugin.name, camera_name, exc, exc_info=exc)
        finally:
            _frame_inflight.discard(key)

    # ── discovery ─────────────────────────────────────────────────────────────

    def _discover(self) -> list[type[BasePlugin]]:
        classes: list[type[BasePlugin]] = []

        # Builtin plugins (app/plugins/builtin/)
        try:
            import app.plugins.builtin as builtin_pkg
            for _, mod_name, is_pkg in pkgutil.walk_packages(
                builtin_pkg.__path__, builtin_pkg.__name__ + "."  # type: ignore[attr-defined]
            ):
                if not is_pkg:
                    continue
                try:
                    mod = importlib.import_module(mod_name)
                    for attr in dir(mod):
                        obj = getattr(mod, attr)
                        if (
                            isinstance(obj, type)
                            and issubclass(obj, BasePlugin)
                            and obj is not BasePlugin
                            and hasattr(obj, "name")
                        ):
                            classes.append(obj)
                except Exception as exc:
                    log.warning("Could not import plugin package %s: %s", mod_name, exc)
        except Exception as exc:
            log.warning("Could not scan builtin plugins: %s", exc)

        # Enterprise plugins (app/plugins/enterprise/) — discovered via file system
        # to avoid import-time dependencies (cv2, etc.) at package initialization
        enterprise_path = Path("/app/app/plugins/enterprise")
        if enterprise_path.is_dir():
            for item in enterprise_path.iterdir():
                if item.is_dir() and (item / "plugin.py").exists():
                    try:
                        spec = importlib.util.spec_from_file_location(
                            f"app.plugins.enterprise.{item.name}.plugin",
                            item / "plugin.py",
                        )
                        if spec and spec.loader:
                            mod = importlib.util.module_from_spec(spec)
                            sys.modules[spec.name] = mod
                            spec.loader.exec_module(mod)
                            for attr in dir(mod):
                                obj = getattr(mod, attr)
                                if (
                                    isinstance(obj, type)
                                    and issubclass(obj, BasePlugin)
                                    and obj is not BasePlugin
                                    and hasattr(obj, "name")
                                ):
                                    classes.append(obj)
                    except Exception as exc:
                        log.warning("Could not import enterprise plugin %s: %s", item.name, exc)

        external_path = Path("/app/plugins/external")
        if external_path.exists():
            for item in external_path.iterdir():
                if item.is_dir() and (item / "__init__.py").exists():
                    try:
                        mod = importlib.import_module(item.name)
                        for attr in dir(mod):
                            obj = getattr(mod, attr)
                            if (
                                isinstance(obj, type)
                                and issubclass(obj, BasePlugin)
                                and obj is not BasePlugin
                                and hasattr(obj, "name")
                            ):
                                classes.append(obj)
                    except Exception as exc:
                        log.warning("Could not import external plugin %s: %s", item.name, exc)

        return classes


plugin_registry = _PluginRegistry()
