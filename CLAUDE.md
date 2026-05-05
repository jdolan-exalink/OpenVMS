# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenCCTV** — an open-source VMS (Video Management System), open-source equivalent to Nx Witness/Avigilon for professional CCTV installations with AI. Supports multiple simultaneous Frigate servers (multi-node), a modular plugin system, and a real-time event pipeline.

The full specification lives in `OpenVMS.md`. **No source code has been implemented yet** — that document is the authoritative blueprint to follow.

## Tech Stack

- **Backend:** FastAPI (Python 3.12), SQLAlchemy async + asyncpg, Alembic, Redis, aiomqtt, httpx async, structlog, ruff, slowapi
- **Frontend:** React 18 + Vite, TypeScript (strict), TailwindCSS, Zustand, React Query, Socket.io-client, OvenPlayer
- **Infrastructure:** PostgreSQL 16, Redis 7, Mosquitto MQTT 2, OvenMediaEngine (WebRTC + LL-HLS), Docker Compose, Traefik

## Commands

All commands run through Docker Compose via the Makefile:

```bash
make up              # Start production stack
make down            # Stop stack
make dev             # Start with hot-reload (docker-compose.dev.yml override)
make migrate         # Run Alembic migrations (alembic upgrade head)
make seed            # Populate test data
make logs            # Tail all logs
make shell-backend   # Exec into backend container
make shell-db        # Connect to PostgreSQL (psql)
make test            # Run pytest tests
make lint            # Run ruff on app/
```

Direct equivalents without Make:
```bash
docker compose exec backend pytest tests/ -v              # run all tests
docker compose exec backend pytest tests/test_auth.py -v  # run single test file
docker compose exec backend ruff check app/
docker compose exec backend alembic upgrade head
```

## Architecture

### Data / Event Flow

1. **Video:** IP camera → Frigate (recording + detection) → go2rtc restream → OvenMediaEngine (RTSP pull) → Frontend (WebRTC / LL-HLS via OvenPlayer)
2. **Events:** Frigate MQTT broker → `MQTTService` (multi-broker consumer) → `EventService` (normalize + store in PostgreSQL) → WebSocket endpoint → Frontend Socket.io-client

### Backend Structure (`backend/app/`)

- `main.py` — FastAPI entrypoint with lifespan (starts MQTT consumer, loads plugins)
- `config.py` — pydantic-settings; all env vars live here
- `database.py` — SQLAlchemy async engine + session factory
- `deps.py` — injectable dependencies (DB session, current user)
- `api/v1/` — REST routers: `auth`, `cameras`, `servers`, `events`, `recordings`, `users`, `plugins`
- `api/ws/events.py` — WebSocket endpoint (auth via query param token)
- `models/` — SQLAlchemy ORM models
- `schemas/` — Pydantic request/response schemas
- `services/` — business logic: `frigate_service` (multi-server HTTP client with Redis cache TTL 60s), `mqtt_service` (multi-broker with exponential backoff), `ome_service` (stream URL builder), `event_service`, `export_service` (FFmpeg)
- `plugins/` — `base.py` (abstract `BasePlugin`), `registry.py` (dynamic discovery from `builtin/` and `external/`), `builtin/lpr/`, `builtin/notifications/`

### Frontend Structure (`frontend/src/`)

- `api/client.ts` — Axios base with JWT interceptors (auto-refresh)
- `store/` — Zustand stores: `authStore`, `cameraStore`, `eventStore`
- `hooks/useWebSocket.ts` — Socket.io with auto-reconnect
- `hooks/usePlayer.ts` — OvenPlayer WebRTC with LL-HLS fallback
- Pages: `LiveView` (configurable grid 1×1–6×6), `Events` (cursor-paginated table), `Playback` (timeline + multi-camera sync up to 4), `Dashboard` (cards + camera map), `Settings`

### Key Design Rules

- All backend I/O must be async (SQLAlchemy async, httpx, aiomqtt)
- No TypeScript `any` — strict mode throughout
- All credentials via `.env`, never hardcoded
- API errors always return `{detail: string, code: string}`
- Cursor-based pagination on all growing collections (events, recordings)
- Rate-limit auth endpoints with slowapi
- Plugin system must be functional — at minimum one builtin plugin working

### Database

Core tables (created via Alembic initial migration): `frigate_servers`, `cameras`, `users`, `camera_permissions`, `events`, `audit_logs`, `plugins`. See `OpenVMS.md` for the full schema SQL.

Performance indexes on `events`: `(camera_id, start_time DESC)`, `(label, start_time DESC)`, `(plate_number)`, `metadata` GIN, `(server_id, start_time DESC)`.

### Environment Variables

```
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
SECRET_KEY          # JWT signing key
OME_WEBRTC_BASE     # e.g. ws://ome:3333
OME_LLHLS_BASE      # e.g. http://ome:3334
REDIS_URL
MQTT_BROKER
```

## Implementation Order

Follow the order in `OpenVMS.md` §"Orden de implementación sugerido": directory skeleton → Docker Compose → SQLAlchemy models + Alembic → auth → Frigate CRUD + sync → MQTT/EventService → WebSocket → plugin system → frontend (layout → LiveView → Events → Playback → Settings) → OME/Mosquitto configs → Makefile + docs.

For each backend module: models/schemas first, then service, then API router.
