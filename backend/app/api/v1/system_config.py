from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_admin
from app.services.system_config_service import SystemConfigService, _EDITABLE_KEYS

router = APIRouter()


class SystemConfigResponse(BaseModel):
    ome_webrtc_base: str
    ome_llhls_base: str
    go2rtc_rtsp_host: str
    cors_origins: list[str]


class SystemConfigUpdate(BaseModel):
    ome_webrtc_base: str | None = None
    ome_llhls_base: str | None = None
    go2rtc_rtsp_host: str | None = None
    cors_origins: list[str] | None = None


def _to_response(data: dict[str, Any]) -> SystemConfigResponse:
    return SystemConfigResponse(
        ome_webrtc_base=data.get("ome_webrtc_base", ""),
        ome_llhls_base=data.get("ome_llhls_base", ""),
        go2rtc_rtsp_host=data.get("go2rtc_rtsp_host", ""),
        cors_origins=data.get("cors_origins", []),
    )


@router.get("", response_model=SystemConfigResponse)
async def get_system_config(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
) -> SystemConfigResponse:
    data = await SystemConfigService.get_all(db)
    return _to_response(data)


@router.put("", response_model=SystemConfigResponse)
async def update_system_config(
    body: SystemConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> SystemConfigResponse:
    updates: dict[str, Any] = {}
    for key in _EDITABLE_KEYS:
        val = getattr(body, key, None)
        if val is not None:
            updates[key] = val
    data = await SystemConfigService.set_many(updates, db)
    return _to_response(data)
