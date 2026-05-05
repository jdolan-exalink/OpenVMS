"""Plugin management endpoints — list, enable, disable, configure plugins."""

import json
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_admin, require_operator
from app.models.audit_log import Plugin as PluginModel
from app.plugins.registry import plugin_registry

# Load default/example configs from plugin_configs.json once at import time
def _load_defaults() -> dict[str, dict]:
    path = Path(__file__).parent.parent.parent / "plugins/enterprise/plugin_configs.json"
    try:
        raw = json.loads(path.read_text())
        return {k: v.get("example", {}) for k, v in raw.items() if not k.startswith("_") and isinstance(v, dict)}
    except Exception:
        return {}

_PLUGIN_DEFAULTS: dict[str, dict] = _load_defaults()

router = APIRouter()


class PluginResponse(BaseModel):
    id: uuid.UUID | None
    name: str
    display_name: str = ""
    version: str
    description: str
    enabled: bool
    config: dict
    default_config: dict = {}
    is_active: bool
    has_sidebar_page: bool = False
    sidebar_icon: str = ""
    sidebar_label: str = ""
    sidebar_route: str = ""
    category: str = "other"
    requires_gpu: bool = False
    config_schema: dict = {}

    model_config = {"from_attributes": True}


class PluginConfigUpdate(BaseModel):
    config: dict


class SidebarItem(BaseModel):
    name: str
    sidebar_icon: str
    sidebar_label: str
    sidebar_route: str
    category: str


def _meta_from(obj) -> dict:
    """Extract sidebar/category metadata from a plugin instance or class."""
    name = getattr(obj, "name", "")
    return {
        "display_name": getattr(obj, "display_name", "") or name,
        "has_sidebar_page": getattr(obj, "has_sidebar_page", False),
        "sidebar_icon": getattr(obj, "sidebar_icon", ""),
        "sidebar_label": getattr(obj, "sidebar_label", "") or name,
        "sidebar_route": getattr(obj, "sidebar_route", "") or name,
        "category": getattr(obj, "category", "other"),
        "requires_gpu": getattr(obj, "requires_gpu", False),
    }


def _schema_from(obj) -> dict:
    """Safely get config_schema from a plugin instance or class."""
    try:
        instance = obj() if isinstance(obj, type) else obj
        return instance.get_config_schema()
    except Exception:
        return {}


@router.get("/sidebar-items", response_model=list[SidebarItem])
async def get_sidebar_items(_=Depends(get_current_user)):
    """Returns active plugins that have a dedicated sidebar page."""
    active = plugin_registry.get_active()
    result = []
    for name, plugin in active.items():
        if plugin.has_sidebar_page:
            result.append(SidebarItem(
                name=name,
                sidebar_icon=plugin.sidebar_icon or "🔌",
                sidebar_label=plugin.sidebar_label or name,
                sidebar_route=plugin.sidebar_route or name,
                category=plugin.category,
            ))
    return result


@router.get("", response_model=list[PluginResponse])
async def list_plugins(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    """Returns all plugins — discovered, loaded, and those in the DB."""
    result = await db.execute(select(PluginModel).order_by(PluginModel.name))
    db_plugins = {p.name: p for p in result.scalars()}

    active = plugin_registry.get_active()
    discovered = {cls.name: cls for cls in plugin_registry._discover()}

    all_names = set(db_plugins) | set(active) | set(discovered)
    response = []
    for name in sorted(all_names):
        db_p = db_plugins.get(name)
        active_p = active.get(name)
        discovered_cls = discovered.get(name)

        meta_src = active_p or discovered_cls
        meta = _meta_from(meta_src) if meta_src else {}
        config_schema = _schema_from(active_p or discovered_cls) if (active_p or discovered_cls) else {}

        response.append(
            PluginResponse(
                id=db_p.id if db_p else None,
                name=name,
                version=(
                    db_p.version if db_p
                    else (active_p.version if active_p
                          else (getattr(discovered_cls, "version", "?") if discovered_cls else "?"))
                ),
                description=(
                    active_p.description if active_p
                    else (getattr(discovered_cls, "description", "") if discovered_cls else "")
                ),
                enabled=db_p.enabled if db_p else False,
                config=db_p.config if db_p else {},
                default_config=_PLUGIN_DEFAULTS.get(name, {}),
                is_active=name in active,
                config_schema=config_schema,
                **meta,
            )
        )
    return response


@router.get("/{name}/schema")
async def get_plugin_schema(name: str, _=Depends(get_current_user)):
    """Returns the JSON Schema for a plugin's configuration."""
    active = plugin_registry.get_active()
    if name in active:
        return active[name].get_config_schema()
    for cls in plugin_registry._discover():
        if cls.name == name:
            return _schema_from(cls)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")


@router.get("/{name}", response_model=PluginResponse)
async def get_plugin(
    name: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    result = await db.execute(select(PluginModel).where(PluginModel.name == name))
    db_p = result.scalar_one_or_none()
    active = plugin_registry.get_active()
    active_p = active.get(name)

    if db_p is None and active_p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")

    meta = _meta_from(active_p) if active_p else {}
    config_schema = _schema_from(active_p) if active_p else {}

    return PluginResponse(
        id=db_p.id if db_p else None,
        name=name,
        version=db_p.version if db_p else (active_p.version if active_p else "?"),
        description=active_p.description if active_p else "",
        enabled=db_p.enabled if db_p else False,
        config=db_p.config if db_p else {},
        default_config=_PLUGIN_DEFAULTS.get(name, {}),
        is_active=name in active,
        config_schema=config_schema,
        **meta,
    )


@router.put("/{name}/enable", response_model=PluginResponse)
async def enable_plugin(
    name: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(PluginModel).where(PluginModel.name == name))
    db_p = result.scalar_one_or_none()
    if db_p is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plugin not found in DB. Configure it first via PUT /plugins/{name}/config",
        )

    db_p.enabled = True
    await db.commit()

    active = plugin_registry.get_active()
    if name not in active:
        discovered = plugin_registry._discover()
        for cls in discovered:
            if cls.name == name:
                try:
                    instance = cls()
                    instance._emit_alert = plugin_registry._emit_alert_impl
                    await instance.on_load(db_p.config or {})
                    plugin_registry._active_plugins_add(instance)
                except Exception as exc:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Plugin load failed: {exc}",
                    )
                break

    return await get_plugin(name, db)


@router.put("/{name}/disable", response_model=PluginResponse)
async def disable_plugin(
    name: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(PluginModel).where(PluginModel.name == name))
    db_p = result.scalar_one_or_none()
    if db_p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")

    db_p.enabled = False
    await db.commit()

    active = plugin_registry.get_active()
    if name in active:
        try:
            await active[name].on_unload()
        except Exception:
            pass
        plugin_registry._active_plugins_remove(name)

    return await get_plugin(name, db)


class TelegramTestPayload(BaseModel):
    bot_token: str
    chat_id: str


@router.post("/notifications/test-telegram")
async def test_telegram_notification(
    body: TelegramTestPayload,
    _=Depends(get_current_user),
):
    """Send a test Telegram message to verify bot credentials."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{body.bot_token}/sendMessage",
                json={
                    "chat_id": body.chat_id,
                    "text": "✅ *OpenCCTV*: Test de conexión exitoso.",
                    "parse_mode": "Markdown",
                },
            )
            if resp.status_code != 200:
                detail = resp.json().get("description", "Telegram API error")
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}


@router.put("/{name}/config", response_model=PluginResponse)
async def update_plugin_config(
    name: str,
    body: PluginConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(PluginModel).where(PluginModel.name == name))
    db_p = result.scalar_one_or_none()

    if db_p is None:
        active = plugin_registry.get_active()
        plugin_obj = active.get(name)
        db_p = PluginModel(
            name=name,
            version=plugin_obj.version if plugin_obj else "0.0.0",
            enabled=False,
            config=body.config,
        )
        db.add(db_p)
    else:
        db_p.config = body.config

    await db.commit()
    await db.refresh(db_p)

    active = plugin_registry.get_active()
    if name in active:
        try:
            await active[name].on_load(body.config)
            plugin_registry._register_frame_subscriptions(active[name])
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Plugin reload failed: {exc}",
            )

    return await get_plugin(name, db)
