from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis
from app.limiter import limiter
from app.models.user import User
from app.schemas.auth import LoginRequest, MeResponse, RefreshRequest, TokenResponse
from app.services import auth_service

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if user is None or not auth_service.verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    access_token = auth_service.create_access_token(user.id, user.role)
    refresh_token = auth_service.create_refresh_token(user.id)
    await auth_service.store_refresh_token(redis, refresh_token, user.id)

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    payload = auth_service.verify_token(body.refresh_token, expected_type="refresh")

    if not await auth_service.is_refresh_token_valid(redis, body.refresh_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked")

    import uuid
    result = await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    await auth_service.revoke_refresh_token(redis, body.refresh_token)

    access_token = auth_service.create_access_token(user.id, user.role)
    new_refresh = auth_service.create_refresh_token(user.id)
    await auth_service.store_refresh_token(redis, new_refresh, user.id)

    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshRequest,
    redis=Depends(get_redis),
):
    await auth_service.revoke_refresh_token(redis, body.refresh_token)


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return MeResponse.model_validate(user)
