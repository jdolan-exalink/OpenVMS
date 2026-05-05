import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


class UserCreate(BaseModel):
    username: str
    password: str
    email: str | None = None
    full_name: str | None = None
    role: str = "viewer"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("admin", "operator", "viewer"):
            raise ValueError("role must be admin, operator or viewer")
        return v


class UserUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ("admin", "operator", "viewer"):
            raise ValueError("role must be admin, operator or viewer")
        return v


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str | None
    role: str
    is_active: bool
    last_login: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PermissionUpdate(BaseModel):
    camera_id: uuid.UUID
    can_view: bool = True
    can_playback: bool = False
    can_export: bool = False
    can_ptz: bool = False
