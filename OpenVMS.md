# OpenCCTV — Sistema VMS Opensource Moderno

## Objetivo del proyecto

Construir un VMS (Video Management System) completo, moderno y production-ready llamado **OpenCCTV**.
Debe ser el equivalente opensource de Nx Witness / Avigilon, orientado a instalaciones CCTV profesionales con IA.

Características clave:
- Conexión a **múltiples servidores Frigate** simultáneamente (multi-nodo)
- Sistema de plugins modular para extensibilidad futura
- Stack Docker Compose completo y reproducible
- Documentación técnica exhaustiva para comunidad opensource
- Interfaz React moderna estilo VMS profesional (grilla de cámaras, playback, eventos, mapa)

---

## Stack tecnológico OBLIGATORIO

### Backend
- **FastAPI** (Python 3.12) — API REST principal
- **PostgreSQL 16** — base de datos principal (usuarios, cámaras, eventos, auditoría)
- **Redis** — caché, sesiones, pub/sub de eventos en tiempo real
- **Mosquitto MQTT** — consumo de eventos desde múltiples Frigate
- **WebSockets** — push de eventos al frontend en tiempo real
- **Alembic** — migraciones de base de datos versionadas

### Frontend
- **React 18 + Vite**
- **TypeScript** estricto
- **TailwindCSS**
- **Zustand** para estado global
- **React Query** para data fetching
- **Socket.io-client** para eventos en tiempo real

### Video / Streaming
- **OvenMediaEngine (OME)** — reproducción WebRTC y LL-HLS
- **Frigate** — detección, grabación, eventos (uno o más nodos, versión 0.17+)
- go2rtc integrado en Frigate para RTSP restream

### Infraestructura
- **Docker Compose** como orquestador principal
- **Traefik** como reverse proxy con soporte SSL
- Volúmenes nombrados para persistencia
- Health checks en todos los servicios

---

## Estructura de directorios EXACTA a crear
opencctv/
├── README.md                    # Documentación principal del proyecto
├── ARCHITECTURE.md              # Diagrama y descripción de arquitectura
├── CONTRIBUTING.md              # Guía para contribuidores
├── LICENSE                      # MIT License
├── docker-compose.yml           # Stack completo de producción
├── docker-compose.dev.yml       # Override para desarrollo local
├── .env.example                 # Variables de entorno documentadas
├── Makefile                     # Comandos de desarrollo y deploy
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/            # Migraciones versionadas
│   └── app/
│       ├── main.py              # Entrypoint FastAPI con lifespan
│       ├── config.py            # Settings con pydantic-settings
│       ├── database.py          # SQLAlchemy async engine
│       ├── deps.py              # Dependencias inyectables (DB, auth)
│       │
│       ├── api/
│       │   ├── v1/
│       │   │   ├── router.py    # Agrupador de rutas v1
│       │   │   ├── auth.py      # Login, refresh, logout
│       │   │   ├── cameras.py   # CRUD cámaras + stream URLs
│       │   │   ├── servers.py   # CRUD servidores Frigate
│       │   │   ├── events.py    # Listado, filtros, búsqueda
│       │   │   ├── users.py     # CRUD usuarios y roles
│       │   │   ├── recordings.py # Listado clips + exportación
│       │   │   └── plugins.py   # Registry y estado de plugins
│       │   └── ws/
│       │       └── events.py    # WebSocket endpoint de eventos
│       │
│       ├── models/              # SQLAlchemy ORM models
│       │   ├── user.py
│       │   ├── camera.py
│       │   ├── frigate_server.py
│       │   ├── event.py
│       │   └── audit_log.py
│       │
│       ├── schemas/             # Pydantic schemas (request/response)
│       │   ├── auth.py
│       │   ├── camera.py
│       │   ├── event.py
│       │   └── user.py
│       │
│       ├── services/
│       │   ├── auth_service.py       # JWT, hashing, tokens
│       │   ├── frigate_service.py    # Cliente HTTP multi-servidor Frigate
│       │   ├── mqtt_service.py       # Consumidor MQTT multi-broker
│       │   ├── ome_service.py        # Gestión streams OME
│       │   ├── event_service.py      # Normalización y almacenamiento eventos
│       │   └── export_service.py     # FFmpeg export de clips
│       │
│       └── plugins/
│           ├── base.py          # Clase base abstracta Plugin
│           ├── registry.py      # Registro dinámico de plugins
│           └── builtin/
│               ├── lpr/         # Plugin LPR (consume eventos Frigate)
│               └── notifications/ # Plugin notificaciones (Telegram, email)
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── router.tsx           # React Router con rutas protegidas
│       │
│       ├── api/                 # Clientes API tipados
│       │   ├── client.ts        # Axios base con interceptores JWT
│       │   ├── cameras.ts
│       │   ├── events.ts
│       │   ├── auth.ts
│       │   └── servers.ts
│       │
│       ├── store/               # Zustand stores
│       │   ├── authStore.ts
│       │   ├── cameraStore.ts
│       │   └── eventStore.ts
│       │
│       ├── hooks/
│       │   ├── useWebSocket.ts  # Hook Socket.io con reconexión
│       │   ├── usePlayer.ts     # Hook OvenPlayer WebRTC/LL-HLS
│       │   └── useEvents.ts
│       │
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Topbar.tsx
│       │   │   └── Layout.tsx
│       │   │
│       │   ├── liveview/
│       │   │   ├── LiveGrid.tsx        # Grilla configurable (1x1 a 6x6)
│       │   │   ├── CameraCell.tsx      # Celda individual con overlay
│       │   │   ├── VideoPlayer.tsx     # OvenPlayer wrapper WebRTC/LL-HLS
│       │   │   └── GridControls.tsx    # Selector layout y cámaras
│       │   │
│       │   ├── events/
│       │   │   ├── EventFeed.tsx       # Feed en tiempo real WebSocket
│       │   │   ├── EventCard.tsx
│       │   │   ├── EventFilters.tsx
│       │   │   └── EventTimeline.tsx
│       │   │
│       │   ├── playback/
│       │   │   ├── PlaybackView.tsx    # Vista reproducción con timeline
│       │   │   ├── TimelineBar.tsx     # Barra timeline con eventos marcados
│       │   │   └── ExportModal.tsx
│       │   │
│       │   └── settings/
│       │       ├── CameraForm.tsx
│       │       ├── ServerForm.tsx      # Agregar servidor Frigate
│       │       └── UserManagement.tsx
│       │
│       └── pages/
│           ├── Login.tsx
│           ├── LiveView.tsx
│           ├── Events.tsx
│           ├── Playback.tsx
│           ├── Settings.tsx
│           └── Dashboard.tsx
│
├── ome/
│   └── Server.xml               # Config OME con RTSP pull + WebRTC + LL-HLS
│
├── mosquitto/
│   └── mosquitto.conf
│
├── nginx/
│   └── nginx.conf               # Reverse proxy para frontend en producción
│
└── docs/
├── api.md                   # Documentación API REST
├── plugin-development.md    # Guía desarrollo plugins
├── frigate-integration.md   # Cómo conectar Frigate
├── deployment.md            # Guía deploy producción
└── architecture-diagram.md  # Diagramas ASCII y Mermaid

---

## Esquema de base de datos COMPLETO

Crear estas tablas vía Alembic (migration inicial):

```sql
-- Servidores Frigate (multi-nodo)
CREATE TABLE frigate_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  url TEXT NOT NULL,                    -- http://frigate-host:5000
  rtsp_base TEXT NOT NULL,              -- rtsp://frigate-host:8554
  mqtt_host TEXT,
  mqtt_port INTEGER DEFAULT 1883,
  api_key TEXT,
  enabled BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cámaras
CREATE TABLE cameras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES frigate_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- nombre en Frigate (ej: entrada_principal)
  display_name TEXT NOT NULL,
  frigate_name TEXT NOT NULL,
  ome_stream_main TEXT,                 -- ws://ome:3333/app/camara
  ome_stream_sub TEXT,
  llhls_main TEXT,                      -- http://ome:3334/app/camara/llhls.m3u8
  llhls_sub TEXT,
  rtsp_main TEXT,                       -- rtsp://frigate:8554/camara
  rtsp_sub TEXT,
  has_audio BOOLEAN DEFAULT false,
  has_ptz BOOLEAN DEFAULT false,
  position_x FLOAT,                     -- para mapa de cámaras
  position_y FLOAT,
  floor_level INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, frigate_name)
);

-- Usuarios
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',  -- admin, operator, viewer
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permisos por cámara (granular)
CREATE TABLE camera_permissions (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  camera_id UUID REFERENCES cameras(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,
  can_playback BOOLEAN DEFAULT false,
  can_export BOOLEAN DEFAULT false,
  can_ptz BOOLEAN DEFAULT false,
  PRIMARY KEY (user_id, camera_id)
);

-- Eventos (normalizados desde Frigate)
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  frigate_event_id TEXT UNIQUE,
  server_id UUID REFERENCES frigate_servers(id),
  camera_id UUID REFERENCES cameras(id),
  label TEXT NOT NULL,
  sub_label TEXT,
  event_type TEXT,                       -- detection, lpr, audio, motion
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  score NUMERIC(5,2),
  zones TEXT[] DEFAULT '{}',
  has_clip BOOLEAN DEFAULT false,
  has_snapshot BOOLEAN DEFAULT false,
  snapshot_path TEXT,
  clip_path TEXT,
  plate_number TEXT,                     -- para LPR
  plate_score NUMERIC(5,2),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_events_camera_time ON events (camera_id, start_time DESC);
CREATE INDEX idx_events_label_time ON events (label, start_time DESC);
CREATE INDEX idx_events_plate ON events (plate_number) WHERE plate_number IS NOT NULL;
CREATE INDEX idx_events_metadata_gin ON events USING GIN (metadata);
CREATE INDEX idx_events_server_time ON events (server_id, start_time DESC);

-- Log de auditoría
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,                  -- export, login, ptz, config_change
  resource_type TEXT,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plugins registrados
CREATE TABLE plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  version TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Sistema de plugins — IMPLEMENTAR COMPLETO

### Clase base (backend/app/plugins/base.py)

```python
from abc import ABC, abstractmethod
from typing import Any

class BasePlugin(ABC):
    name: str
    version: str
    description: str

    @abstractmethod
    async def on_load(self, config: dict) -> None:
        """Inicialización del plugin"""
        pass

    @abstractmethod
    async def on_event(self, event: dict) -> None:
        """Se llama por cada evento Frigate recibido"""
        pass

    async def on_unload(self) -> None:
        """Limpieza al descargar el plugin"""
        pass

    def get_routes(self):
        """Retorna rutas APIRouter adicionales opcionales"""
        return None
```

### Registry dinámico
- Debe descubrir plugins en `plugins/builtin/` y en un directorio `plugins/external/` montable vía Docker volume
- Cada plugin puede agregar sus propias rutas a FastAPI (`/api/v1/plugins/{name}/...`)
- Estado de plugins en PostgreSQL, config editable desde UI

---

## Endpoints API REST MÍNIMOS

Todos bajo `/api/v1/`. Documentar con OpenAPI/Swagger automático de FastAPI.

### Auth
- `POST /auth/login` — username + password → JWT access + refresh token
- `POST /auth/refresh` — renovar tokens
- `POST /auth/logout`
- `GET /auth/me`

### Servidores Frigate
- `GET /servers` — listar servidores
- `POST /servers` — agregar servidor
- `PUT /servers/{id}`
- `DELETE /servers/{id}`
- `GET /servers/{id}/status` — ping a Frigate, retorna versión y cámaras detectadas
- `POST /servers/{id}/sync` — importar cámaras desde Frigate automáticamente

### Cámaras
- `GET /cameras` — listado con paginación, filtro por servidor/tag
- `POST /cameras`
- `PUT /cameras/{id}`
- `DELETE /cameras/{id}`
- `GET /cameras/{id}/stream` — retorna URLs OME WebRTC + LL-HLS según permisos
- `POST /cameras/{id}/ptz` — comandos PTZ (si soportado)
- `GET /cameras/{id}/snapshot` — proxy snapshot desde Frigate

### Eventos
- `GET /events` — filtros: camera_id, server_id, label, plate, start, end, zona, score_min; paginación cursor-based
- `GET /events/{id}`
- `GET /events/{id}/clip` — proxy clip desde Frigate
- `GET /events/{id}/snapshot` — proxy snapshot

### Grabaciones
- `GET /recordings` — por cámara y rango de tiempo
- `POST /recordings/export` — exporta via FFmpeg, retorna job_id
- `GET /recordings/export/{job_id}` — estado del export

### Usuarios
- `GET /users` — solo admin
- `POST /users`
- `PUT /users/{id}`
- `DELETE /users/{id}`
- `PUT /users/{id}/permissions` — asignar permisos por cámara

### WebSocket
- `WS /ws/events` — stream de eventos en tiempo real (autenticado via query param token)
  - Formato mensajes: `{type: "event", server_id, camera_id, label, score, snapshot_url, timestamp}`

---

## Frontend — Vistas y componentes REQUERIDOS

### Diseño visual
- Tema oscuro por defecto (fondo #0d0f14, sidebar #131720)
- Acento principal: verde #00d084 (estilo Nx Witness)
- Sin librerías de componentes externas — todo con TailwindCSS custom
- Tipografía: Inter para UI, JetBrains Mono para datos técnicos/placas

### Página LiveView (`/live`)
- Grilla configurable: 1x1, 2x2, 3x3, 4x4, 2+4, 5x5 (preset buttons)
- Cada celda: reproduce WebRTC por defecto via OvenPlayer, fallback a LL-HLS
- En grillas grandes (≥ 4x4): usar substream automáticamente
- Doble click en celda: expande a fullscreen, activa audio, muestra overlay PTZ
- Overlay por celda: nombre cámara, servidor origen, estado conexión, última detección
- Selector de cámaras drag-and-drop para asignar a celdas
- Panel lateral retráctil con feed de eventos en tiempo real (WebSocket)

### Página Eventos (`/events`)
- Tabla paginada con filtros: servidor, cámara, tipo, etiqueta, placa, rango fecha
- Thumbnail/snapshot inline
- Click en evento: modal con snapshot + botón ver clip + metadata
- Botón exportar selección
- Feed live en sidebar (toggle)

### Página Playback (`/playback`)
- Selector cámara + rango de tiempo
- Timeline visual con bloques de grabación y marcadores de eventos
- Player de clips con controles velocidad (0.25x a 4x)
- Vista multi-cámara sincronizada (hasta 4 simultáneas)

### Página Dashboard (`/`)
- Cards resumen: cámaras activas, eventos hoy, detecciones por tipo (charts)
- Mapa de cámaras (canvas o SVG simple, sin Google Maps)
- Tabla últimos eventos
- Estado de servidores Frigate (ping visual)

### Configuración (`/settings`)
- Gestión servidores Frigate (agregar, editar, sincronizar cámaras)
- Gestión cámaras (editar display name, tags, habilitar/deshabilitar)
- Usuarios y roles (solo admin)
- Plugins (listar, habilitar/deshabilitar, configurar)

---

## Servicios backend CRÍTICOS

### FrigateService (services/frigate_service.py)
```python
# Debe manejar múltiples servidores simultáneamente
# - Pool de conexiones HTTP (httpx async) por servidor
# - Cache de cámaras en Redis (TTL 60s)
# - Método sync_cameras(server_id) que importa cámaras vía GET /api/cameras
# - Método get_event_clip(server_id, event_id) → streaming proxy
# - Método get_snapshot(server_id, camera_name) → proxy imagen
# - Health check async con timeout 5s
```

### MQTTService (services/mqtt_service.py)
```python
# - Conectar a múltiples brokers MQTT (uno por servidor Frigate)
# - Suscribir a: frigate/events, frigate/+/events, frigate/stats
# - Al recibir evento: normalizar, guardar en PostgreSQL, publicar via WebSocket a clientes
# - Reconexión automática con backoff exponencial
# - Usar asyncio-mqtt o aiomqtt
```

### OMEService (services/ome_service.py)
```python
# - Construir URLs WebRTC y LL-HLS para cada cámara
# - Verificar que OME tiene el stream activo (API REST de OME)
# - Retornar URL correcta según tamaño de grilla (main vs sub)
```

---

## Docker Compose COMPLETO

```yaml
# docker-compose.yml — PRODUCCIÓN
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-opencctv}
      POSTGRES_USER: ${POSTGRES_USER:-opencctv}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-opencctv}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  mqtt:
    image: eclipse-mosquitto:2
    volumes:
      - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf
      - mosquitto_data:/mosquitto/data

  ovenmediaengine:
    image: airensoft/ovenmediaengine:latest
    network_mode: host
    volumes:
      - ./ome/Server.xml:/opt/ovenmediaengine/bin/origin_conf/Server.xml

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      MQTT_BROKER: mqtt
      SECRET_KEY: ${SECRET_KEY}
      OME_WEBRTC_BASE: ${OME_WEBRTC_BASE}
      OME_LLHLS_BASE: ${OME_LLHLS_BASE}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8080:8080"
    volumes:
      - ./backend/app/plugins/external:/app/plugins/external

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  mosquitto_data:
```

---

## Configuración OME (ome/Server.xml)

Crear configuración completa que:
- Acepte entrada RTSP (pull desde Frigate :8554)
- Publique WebRTC en puerto 3333
- Publique LL-HLS en puerto 3334
- Application name: `live`
- Soporte para múltiples streams simultáneos
- Low-latency mode habilitado

---

## Makefile con comandos útiles

```makefile
.PHONY: up down dev migrate seed logs shell-backend shell-db

up:
	docker compose up -d

down:
	docker compose down

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

migrate:
	docker compose exec backend alembic upgrade head

seed:
	docker compose exec backend python -m app.scripts.seed_db

logs:
	docker compose logs -f --tail=100

shell-backend:
	docker compose exec backend bash

shell-db:
	docker compose exec postgres psql -U opencctv opencctv

test:
	docker compose exec backend pytest tests/ -v

lint:
	docker compose exec backend ruff check app/
```

---

## Documentación a generar

### README.md — incluir:
- Badge de licencia, versión, Docker
- Screenshot de la UI (placeholder ASCII art)
- Quick start en 5 minutos (`git clone` + `.env` + `make up`)
- Lista de features
- Tabla de compatibilidad con versiones Frigate
- Links a docs/

### ARCHITECTURE.md — incluir:
- Diagrama ASCII de arquitectura completa
- Descripción de cada componente y por qué se eligió
- Flujo de video: cámara → Frigate → OME → Frontend
- Flujo de eventos: Frigate MQTT → Backend → WebSocket → Frontend
- Decisiones de diseño (por qué OME y no MediaMTX, por qué FastAPI y no Node, etc.)

### docs/plugin-development.md — incluir:
- Tutorial crear primer plugin paso a paso
- Hooks disponibles (on_event, on_load, on_unload, get_routes)
- Ejemplo plugin completo: "Telegram Notifier"
- Cómo montar plugin externo via Docker volume

---

## Restricciones y reglas de implementación

1. **TypeScript estricto** — no usar `any`, no ignorar errores de tipos
2. **Async/await en todo el backend** — usar SQLAlchemy async, httpx async, aiomqtt
3. **Variables de entorno** — NUNCA hardcodear credenciales, todo via `.env`
4. **Error handling** — todos los endpoints retornan errores estructurados `{detail: string, code: string}`
5. **Logging** — usar structlog en backend, logs en formato JSON para producción
6. **Tests** — crear al menos tests de integración para: auth, CRUD cámaras, CRUD servidores, listado eventos
7. **Paginación cursor-based** en todos los listados que puedan crecer (eventos, grabaciones)
8. **CORS configurado** correctamente para desarrollo y producción
9. **Rate limiting** en endpoints de auth (usar slowapi)
10. **El plugin system DEBE funcionar** — demostrar con al menos un plugin builtin funcional (LPR o notificaciones)

---

## Orden de implementación sugerido

1. Estructura de directorios y archivos base
2. docker-compose.yml + .env.example
3. Backend: modelos SQLAlchemy + migraciones Alembic
4. Backend: auth (JWT) + endpoints usuarios
5. Backend: CRUD servidores Frigate + sync de cámaras
6. Backend: MQTTService + EventService (consumo y almacenamiento)
7. Backend: WebSocket events endpoint
8. Backend: Plugin system base + registry
9. Frontend: Layout base + routing + auth
10. Frontend: LiveView con OvenPlayer
11. Frontend: Página eventos con WebSocket
12. Frontend: Playback
13. Frontend: Settings (servidores, cámaras, usuarios)
14. OME Server.xml + Mosquitto config
15. Makefile + documentación

---

Empezá por la estructura de directorios completa y el docker-compose.yml, luego avanzá en el orden indicado.
Para cada módulo, crear primero los modelos/schemas, luego los servicios, luego los endpoints.
Documentar cada archivo con docstrings y comentarios explicativos donde el código no sea autoevidente.
Este proyecto debe poder ser usado por la comunidad como base para despliegues reales de CCTV.
