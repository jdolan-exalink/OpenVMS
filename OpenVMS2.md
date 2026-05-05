# OpenCCTV — Sistema VMS Opensource Moderno

> **Prompt maestro para Claude Code**
> Versión 1.0 | Stack: Frigate 0.17+ · OME · FastAPI · React · PostgreSQL · Docker

---

## Objetivo del proyecto

Construir un VMS (Video Management System) completo, moderno y production-ready llamado **OpenCCTV**.
Debe ser el equivalente opensource de Nx Witness / Avigilon, orientado a instalaciones CCTV profesionales con IA.

Características clave:

- Conexión a **múltiples servidores Frigate** simultáneamente (multi-nodo)
- **Configuración completa de Frigate vía API REST 0.17+** — agregar cámaras, modificar config, recargar sin reiniciar
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
- **httpx** — cliente HTTP async para consumo API Frigate
- **aiomqtt** — cliente MQTT async

### Frontend

- **React 18 + Vite**
- **TypeScript** estricto (sin `any`)
- **TailwindCSS**
- **Zustand** para estado global
- **React Query (TanStack Query v5)** para data fetching y caché
- **Socket.io-client** para eventos en tiempo real
- **OvenPlayer** para reproducción WebRTC y LL-HLS

### Video / Streaming

- **OvenMediaEngine (OME)** — reproducción WebRTC y LL-HLS
- **Frigate 0.17+** — detección, grabación, eventos, restream RTSP (uno o más nodos)
- go2rtc integrado en Frigate para RTSP restream en puerto 8554

### Infraestructura

- **Docker Compose** como orquestador principal
- **Traefik** como reverse proxy con soporte SSL opcional
- Volúmenes nombrados para persistencia
- Health checks en todos los servicios

---

## Estructura de directorios EXACTA a crear

```
opencctv/
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── LICENSE
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── Makefile
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── deps.py
│       │
│       ├── api/
│       │   ├── v1/
│       │   │   ├── router.py
│       │   │   ├── auth.py
│       │   │   ├── cameras.py
│       │   │   ├── servers.py
│       │   │   ├── frigate_config.py   ← configuración Frigate vía API
│       │   │   ├── events.py
│       │   │   ├── users.py
│       │   │   ├── recordings.py
│       │   │   └── plugins.py
│       │   └── ws/
│       │       └── events.py
│       │
│       ├── models/
│       │   ├── user.py
│       │   ├── camera.py
│       │   ├── frigate_server.py
│       │   ├── event.py
│       │   └── audit_log.py
│       │
│       ├── schemas/
│       │   ├── auth.py
│       │   ├── camera.py
│       │   ├── event.py
│       │   ├── user.py
│       │   └── frigate_config.py       ← schemas para config Frigate
│       │
│       ├── services/
│       │   ├── auth_service.py
│       │   ├── frigate_service.py      ← cliente HTTP + config API
│       │   ├── frigate_config_service.py ← gestión config YAML vía API
│       │   ├── mqtt_service.py
│       │   ├── ome_service.py
│       │   ├── event_service.py
│       │   └── export_service.py
│       │
│       └── plugins/
│           ├── base.py
│           ├── registry.py
│           └── builtin/
│               ├── lpr/
│               └── notifications/
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
│       ├── router.tsx
│       │
│       ├── api/
│       │   ├── client.ts
│       │   ├── cameras.ts
│       │   ├── events.ts
│       │   ├── auth.ts
│       │   ├── servers.ts
│       │   └── frigateConfig.ts        ← API de configuración Frigate
│       │
│       ├── store/
│       │   ├── authStore.ts
│       │   ├── cameraStore.ts
│       │   └── eventStore.ts
│       │
│       ├── hooks/
│       │   ├── useWebSocket.ts
│       │   ├── usePlayer.ts
│       │   └── useEvents.ts
│       │
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Topbar.tsx
│       │   │   └── Layout.tsx
│       │   │
│       │   ├── liveview/
│       │   │   ├── LiveGrid.tsx
│       │   │   ├── CameraCell.tsx
│       │   │   ├── VideoPlayer.tsx
│       │   │   └── GridControls.tsx
│       │   │
│       │   ├── events/
│       │   │   ├── EventFeed.tsx
│       │   │   ├── EventCard.tsx
│       │   │   ├── EventFilters.tsx
│       │   │   └── EventTimeline.tsx
│       │   │
│       │   ├── playback/
│       │   │   ├── PlaybackView.tsx
│       │   │   ├── TimelineBar.tsx
│       │   │   └── ExportModal.tsx
│       │   │
│       │   ├── frigate-config/         ← componentes configuración Frigate
│       │   │   ├── FrigateConfigEditor.tsx
│       │   │   ├── CameraWizard.tsx
│       │   │   ├── DetectionZoneEditor.tsx
│       │   │   ├── RecordingSettings.tsx
│       │   │   └── Go2rtcStreams.tsx
│       │   │
│       │   └── settings/
│       │       ├── CameraForm.tsx
│       │       ├── ServerForm.tsx
│       │       └── UserManagement.tsx
│       │
│       └── pages/
│           ├── Login.tsx
│           ├── LiveView.tsx
│           ├── Events.tsx
│           ├── Playback.tsx
│           ├── FrigateConfig.tsx       ← página configuración Frigate
│           ├── Settings.tsx
│           └── Dashboard.tsx
│
├── ome/
│   └── Server.xml
│
├── mosquitto/
│   └── mosquitto.conf
│
├── nginx/
│   └── nginx.conf
│
└── docs/
    ├── api.md
    ├── plugin-development.md
    ├── frigate-integration.md
    ├── frigate-api-config.md           ← documentación API config Frigate
    ├── deployment.md
    └── architecture-diagram.md
```

---

## Esquema de base de datos COMPLETO

Crear vía Alembic (migration inicial `001_initial_schema.py`):

```sql
-- Servidores Frigate (multi-nodo)
CREATE TABLE frigate_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  url TEXT NOT NULL,                       -- http://frigate-host:5000
  rtsp_base TEXT NOT NULL,                 -- rtsp://frigate-host:8554
  mqtt_host TEXT,
  mqtt_port INTEGER DEFAULT 1883,
  api_key TEXT,
  enabled BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ,
  frigate_version TEXT,                    -- detectada al conectar
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cámaras (sincronizadas desde Frigate o creadas desde VMS)
CREATE TABLE cameras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES frigate_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                      -- nombre interno Frigate
  display_name TEXT NOT NULL,
  frigate_name TEXT NOT NULL,              -- camera key en config Frigate
  ome_stream_main TEXT,
  ome_stream_sub TEXT,
  llhls_main TEXT,
  llhls_sub TEXT,
  rtsp_main TEXT,
  rtsp_sub TEXT,
  has_audio BOOLEAN DEFAULT false,
  has_ptz BOOLEAN DEFAULT false,
  position_x FLOAT,
  position_y FLOAT,
  floor_level INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  tags TEXT[] DEFAULT '{}',
  -- Config Frigate sincronizada
  detect_width INTEGER,
  detect_height INTEGER,
  detect_fps INTEGER,
  record_enabled BOOLEAN DEFAULT false,
  snapshots_enabled BOOLEAN DEFAULT false,
  zones JSONB DEFAULT '[]',
  objects JSONB DEFAULT '[]',
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
  role TEXT NOT NULL DEFAULT 'viewer',    -- admin, operator, viewer
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permisos por cámara
CREATE TABLE camera_permissions (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  camera_id UUID REFERENCES cameras(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,
  can_playback BOOLEAN DEFAULT false,
  can_export BOOLEAN DEFAULT false,
  can_ptz BOOLEAN DEFAULT false,
  can_configure BOOLEAN DEFAULT false,    -- puede editar config Frigate de esta cámara
  PRIMARY KEY (user_id, camera_id)
);

-- Eventos normalizados desde Frigate
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  frigate_event_id TEXT UNIQUE,
  server_id UUID REFERENCES frigate_servers(id),
  camera_id UUID REFERENCES cameras(id),
  label TEXT NOT NULL,
  sub_label TEXT,
  event_type TEXT,                         -- detection, lpr, audio, motion
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  score NUMERIC(5,2),
  zones TEXT[] DEFAULT '{}',
  has_clip BOOLEAN DEFAULT false,
  has_snapshot BOOLEAN DEFAULT false,
  snapshot_path TEXT,
  clip_path TEXT,
  plate_number TEXT,
  plate_score NUMERIC(5,2),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_events_camera_time ON events (camera_id, start_time DESC);
CREATE INDEX idx_events_label_time ON events (label, start_time DESC);
CREATE INDEX idx_events_plate ON events (plate_number) WHERE plate_number IS NOT NULL;
CREATE INDEX idx_events_metadata_gin ON events USING GIN (metadata);
CREATE INDEX idx_events_server_time ON events (server_id, start_time DESC);

-- Historial de cambios de config Frigate
CREATE TABLE frigate_config_history (
  id BIGSERIAL PRIMARY KEY,
  server_id UUID REFERENCES frigate_servers(id),
  user_id UUID REFERENCES users(id),
  change_type TEXT NOT NULL,               -- add_camera, update_camera, delete_camera, update_global
  camera_name TEXT,
  config_diff JSONB,
  full_config_snapshot JSONB,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

-- Log de auditoría
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plugins
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

## API de Frigate 0.17+ — INTEGRACIÓN COMPLETA

Esta sección es el núcleo de la capa de configuración del VMS.
Frigate 0.17 expone endpoints REST para leer y modificar la config sin reiniciar el contenedor.

### Endpoints de Frigate que DEBE consumir el VMS

```
GET  /api/version                      → versión de Frigate
GET  /api/config                       → config completa en JSON
PUT  /api/config/set                   → modificar config completa o parcial
GET  /api/config/schema                → JSON Schema de la config (validación)
POST /api/config/save                  → guardar config a disco (persiste)
POST /api/config/revert                → revertir cambios no guardados

GET  /api/cameras                      → listado de cámaras activas
GET  /api/<camera_name>/recordings     → grabaciones de una cámara
GET  /api/<camera_name>/recordings/summary → resumen por hora
GET  /api/<camera_name>/latest.jpg     → snapshot más reciente
GET  /api/<camera_name>/grid.jpg       → miniatura de grilla

GET  /api/events                       → listado de eventos (filtros: camera, label, limit, etc)
GET  /api/events/<event_id>            → evento específico
GET  /api/events/<event_id>/clip.mp4   → clip del evento
GET  /api/events/<event_id>/snapshot.jpg → snapshot del evento
DELETE /api/events/<event_id>          → eliminar evento

GET  /api/go2rtc/streams               → streams configurados en go2rtc
POST /api/go2rtc/streams               → agregar stream go2rtc (body: {name, url})
DELETE /api/go2rtc/streams/<name>      → eliminar stream go2rtc

GET  /api/stats                        → estadísticas de detección y sistema
GET  /api/<camera_name>/ptz/info       → info PTZ de la cámara
POST /api/<camera_name>/ptz/move       → mover cámara PTZ
POST /api/restart                      → reiniciar Frigate (solo si es necesario)
```

### FrigateConfigService — IMPLEMENTAR COMPLETO

**Archivo: `backend/app/services/frigate_config_service.py`**

Este servicio es el puente entre el VMS y la API de configuración de Frigate.
Debe implementar las siguientes funcionalidades:

```python
"""
FrigateConfigService

Gestiona la configuración de Frigate 0.17+ vía API REST.
Permite agregar, modificar y eliminar cámaras sin acceder al YAML directamente.

Principios:
- Siempre leer la config actual antes de modificar (GET /api/config)
- Validar contra el JSON Schema de Frigate antes de aplicar
- Guardar historial de cambios en frigate_config_history
- Aplicar cambios con PUT /api/config/set, luego persistir con POST /api/config/save
- Ante error: revertir con POST /api/config/revert y registrar el fallo
"""

class FrigateConfigService:

    async def get_full_config(self, server_id: UUID) -> dict:
        """
        GET /api/config
        Retorna la config completa de Frigate como dict Python.
        Cachear en Redis con TTL 30s (key: frigate_config:{server_id}).
        """

    async def get_config_schema(self, server_id: UUID) -> dict:
        """
        GET /api/config/schema
        Retorna el JSON Schema de validación de Frigate.
        Cachear en Redis con TTL 3600s (no cambia entre reinicios).
        """

    async def validate_camera_config(self, server_id: UUID, camera_config: dict) -> tuple[bool, list[str]]:
        """
        Valida una config de cámara contra el schema de Frigate antes de aplicar.
        Retorna (is_valid, list_of_errors).
        Usar jsonschema para validar el sub-schema de cameras.
        """

    async def get_camera_config(self, server_id: UUID, camera_name: str) -> dict | None:
        """
        Extrae la config de una cámara específica de la config completa.
        Retorna None si la cámara no existe en Frigate.
        """

    async def add_camera(
        self,
        server_id: UUID,
        user_id: UUID,
        camera_name: str,
        camera_config: dict,
        go2rtc_streams: dict | None = None,
        auto_save: bool = True
    ) -> dict:
        """
        Agrega una nueva cámara a Frigate.

        Flujo:
        1. Verificar que camera_name no existe ya en Frigate
        2. Si se pasan go2rtc_streams: POST /api/go2rtc/streams para cada stream
        3. GET /api/config para obtener config actual
        4. Agregar camera_config bajo config["cameras"][camera_name]
        5. PUT /api/config/set con la config modificada
        6. Verificar respuesta (Frigate retorna errores de validación)
        7. Si auto_save: POST /api/config/save
        8. Registrar en frigate_config_history
        9. Invalidar cache Redis
        10. Retornar config resultante

        camera_config mínima esperada (ver schema completo más abajo):
        {
          "ffmpeg": {"inputs": [...]},
          "detect": {"width": int, "height": int, "fps": int, "enabled": bool},
          "record": {"enabled": bool},
          "snapshots": {"enabled": bool}
        }
        """

    async def update_camera(
        self,
        server_id: UUID,
        user_id: UUID,
        camera_name: str,
        updates: dict,
        auto_save: bool = True
    ) -> dict:
        """
        Actualiza config parcial de una cámara existente.

        Flujo:
        1. GET /api/config para obtener config actual
        2. Deep merge de updates sobre config["cameras"][camera_name]
        3. PUT /api/config/set con config completa modificada
        4. POST /api/config/save si auto_save
        5. Registrar diff en frigate_config_history
        6. Invalidar cache Redis
        """

    async def delete_camera(
        self,
        server_id: UUID,
        user_id: UUID,
        camera_name: str,
        delete_go2rtc_streams: bool = True,
        auto_save: bool = True
    ) -> bool:
        """
        Elimina una cámara de la config de Frigate.

        Flujo:
        1. GET /api/config para obtener config actual
        2. Verificar que la cámara existe
        3. Eliminar go2rtc streams asociados si delete_go2rtc_streams=True
        4. Remover config["cameras"][camera_name]
        5. PUT /api/config/set
        6. POST /api/config/save si auto_save
        7. Registrar en historial
        """

    async def update_global_config(
        self,
        server_id: UUID,
        user_id: UUID,
        section: str,
        config: dict
    ) -> dict:
        """
        Actualiza secciones globales de Frigate (mqtt, ffmpeg, detect, record, snapshots, etc.)

        section puede ser: "mqtt" | "ffmpeg" | "detect" | "record" | "snapshots" |
                          "birdseye" | "live" | "ui" | "logger" | "environment_vars"
        """

    async def get_go2rtc_streams(self, server_id: UUID) -> dict:
        """
        GET /api/go2rtc/streams
        Retorna todos los streams configurados en go2rtc.
        """

    async def add_go2rtc_stream(self, server_id: UUID, name: str, url: str) -> dict:
        """
        POST /api/go2rtc/streams
        Agrega un stream go2rtc para una cámara.
        Body: {"name": str, "url": str | list[str]}
        """

    async def delete_go2rtc_stream(self, server_id: UUID, name: str) -> bool:
        """
        DELETE /api/go2rtc/streams/<name>
        Elimina un stream go2rtc.
        """

    async def sync_cameras_to_vms(self, server_id: UUID, db: AsyncSession) -> dict:
        """
        Importa las cámaras desde Frigate al VMS (tabla cameras de PostgreSQL).

        Flujo:
        1. GET /api/config → obtener cameras
        2. GET /api/go2rtc/streams → obtener streams
        3. Para cada cámara en config:
           a. Construir URLs OME (main + sub)
           b. Upsert en tabla cameras
           c. Sincronizar campos detect_width, detect_height, etc.
        4. Retornar resumen: {added: N, updated: N, unchanged: N}
        """

    async def get_config_history(
        self,
        server_id: UUID,
        camera_name: str | None = None,
        limit: int = 50
    ) -> list[dict]:
        """
        Retorna historial de cambios de config desde frigate_config_history.
        """

    async def revert_last_change(self, server_id: UUID, user_id: UUID) -> bool:
        """
        POST /api/config/revert en Frigate + actualizar historial.
        Solo revierte cambios no guardados a disco.
        """
```

---

## Schema completo de configuración de cámara para Frigate 0.17+

Este schema debe usarse en los forms del frontend y en la validación del backend.
Es el mínimo completo para que una cámara funcione correctamente con el VMS.

```python
# backend/app/schemas/frigate_config.py

from pydantic import BaseModel, Field
from typing import Optional, List, Literal

class FFmpegInputConfig(BaseModel):
    path: str                                           # RTSP URL de la cámara
    roles: List[Literal["detect", "record", "audio"]]

class FFmpegCameraConfig(BaseModel):
    inputs: List[FFmpegInputConfig]
    output_args: Optional[dict] = None
    retry_interval: Optional[float] = None

class DetectConfig(BaseModel):
    enabled: bool = True
    width: int = 1280
    height: int = 720
    fps: int = 5
    min_initialized: Optional[int] = None
    max_disappeared: Optional[int] = None

class RecordConfig(BaseModel):
    enabled: bool = False
    retain: Optional[dict] = Field(
        default={"days": 7, "mode": "motion"},
        description="days: días a retener, mode: all|motion|active_objects"
    )
    events: Optional[dict] = Field(
        default={"retain": {"default": 10, "mode": "active_objects"}},
        description="Retención de eventos grabados"
    )
    export: Optional[dict] = None

class SnapshotsConfig(BaseModel):
    enabled: bool = True
    timestamp: bool = False
    bounding_box: bool = True
    crop: bool = False
    height: Optional[int] = None
    retain: Optional[dict] = Field(
        default={"default": 10},
        description="días de retención de snapshots"
    )

class ZoneCoordinate(BaseModel):
    coordinates: str                                    # "x1,y1,x2,y2,..." porcentajes 0-1
    objects: Optional[List[str]] = None
    inertia: Optional[int] = None
    loitering_time: Optional[int] = None
    filters: Optional[dict] = None

class ObjectFilterConfig(BaseModel):
    min_score: Optional[float] = None
    threshold: Optional[float] = None
    min_area: Optional[int] = None
    max_area: Optional[int] = None
    min_ratio: Optional[float] = None
    max_ratio: Optional[float] = None

class ObjectsConfig(BaseModel):
    track: List[str] = ["person", "car"]
    filters: Optional[dict[str, ObjectFilterConfig]] = None

class MotionConfig(BaseModel):
    enabled: Optional[bool] = None
    threshold: Optional[int] = None
    improve_contrast: Optional[bool] = None
    contour_area: Optional[int] = None
    frame_alpha: Optional[float] = None
    frame_height: Optional[int] = None
    mask: Optional[str | List[str]] = None

class LiveConfig(BaseModel):
    stream_name: Optional[str] = None                  # go2rtc stream name
    height: Optional[int] = None
    quality: Optional[int] = None

class PTZConfig(BaseModel):
    enabled: bool = False
    autotracking: Optional[dict] = None

class AudioConfig(BaseModel):
    enabled: bool = False
    listen: Optional[List[str]] = None
    filters: Optional[dict] = None

class CameraConfig(BaseModel):
    """Config completa de una cámara para Frigate 0.17+"""
    ffmpeg: FFmpegCameraConfig
    detect: DetectConfig = DetectConfig()
    record: RecordConfig = RecordConfig()
    snapshots: SnapshotsConfig = SnapshotsConfig()
    zones: Optional[dict[str, ZoneCoordinate]] = None
    objects: Optional[ObjectsConfig] = None
    motion: Optional[MotionConfig] = None
    live: Optional[LiveConfig] = None
    ptz: Optional[PTZConfig] = None
    audio: Optional[AudioConfig] = None
    best_image_timeout: Optional[int] = None
    onvif: Optional[dict] = None
    ui: Optional[dict] = None
    enabled: bool = True

class AddCameraRequest(BaseModel):
    """Request para agregar una cámara desde el VMS"""
    camera_name: str = Field(..., pattern=r'^[a-z0-9_-]+$',
                              description="Nombre de cámara (solo minúsculas, números, guiones)")
    display_name: str
    server_id: str
    # Streams go2rtc
    rtsp_main: str = Field(..., description="URL RTSP stream principal")
    rtsp_sub: Optional[str] = Field(None, description="URL RTSP substream (detección)")
    # Config de detección
    detect_width: int = 1280
    detect_height: int = 720
    detect_fps: int = 5
    detect_enabled: bool = True
    # Grabación
    record_enabled: bool = True
    record_retain_days: int = 7
    record_mode: Literal["all", "motion", "active_objects"] = "motion"
    # Snapshots
    snapshots_enabled: bool = True
    snapshots_retain_days: int = 10
    # Objetos a detectar
    track_objects: List[str] = ["person", "car", "truck"]
    # Opcionales
    has_audio: bool = False
    has_ptz: bool = False
    zones: Optional[dict] = None
    tags: List[str] = []
    auto_save: bool = True

class UpdateCameraConfigRequest(BaseModel):
    """Request para actualizar config parcial de cámara"""
    detect: Optional[DetectConfig] = None
    record: Optional[RecordConfig] = None
    snapshots: Optional[SnapshotsConfig] = None
    zones: Optional[dict[str, ZoneCoordinate]] = None
    objects: Optional[ObjectsConfig] = None
    motion: Optional[MotionConfig] = None
    audio: Optional[AudioConfig] = None
    auto_save: bool = True
```

---

## Endpoints API del VMS para configuración de Frigate

**Archivo: `backend/app/api/v1/frigate_config.py`**

Todos los endpoints bajo `/api/v1/frigate-config/`. Requieren rol `operator` o `admin`.

```
# Configuración global de un servidor Frigate
GET  /frigate-config/{server_id}/config           → config completa actual
GET  /frigate-config/{server_id}/config/schema    → JSON Schema de Frigate
GET  /frigate-config/{server_id}/config/history   → historial de cambios (paginado)
POST /frigate-config/{server_id}/config/revert    → revertir último cambio no guardado

# Go2rtc streams
GET    /frigate-config/{server_id}/streams                       → listar streams go2rtc
POST   /frigate-config/{server_id}/streams                       → agregar stream
DELETE /frigate-config/{server_id}/streams/{stream_name}         → eliminar stream

# Cámaras (via API Frigate)
GET    /frigate-config/{server_id}/cameras                       → cámaras en config Frigate
POST   /frigate-config/{server_id}/cameras                       → agregar cámara (wizard completo)
GET    /frigate-config/{server_id}/cameras/{camera_name}         → config de cámara específica
PUT    /frigate-config/{server_id}/cameras/{camera_name}         → actualizar config parcial
DELETE /frigate-config/{server_id}/cameras/{camera_name}         → eliminar cámara de Frigate

# Secciones globales
PUT  /frigate-config/{server_id}/global/{section}  → actualizar sección global
                                                     # section: mqtt|ffmpeg|detect|record|
                                                     #          snapshots|birdseye|live

# Sincronización con VMS
POST /frigate-config/{server_id}/sync              → importar cámaras Frigate → tabla cameras VMS

# Stats y estado
GET  /frigate-config/{server_id}/stats             → stats de Frigate (CPU, detecciones/s, etc.)
GET  /frigate-config/{server_id}/version           → versión de Frigate
```

---

## FrigateService — cliente HTTP multi-servidor

**Archivo: `backend/app/services/frigate_service.py`**

```python
"""
FrigateService

Pool de conexiones HTTP async (httpx) hacia múltiples servidores Frigate.
Cache de cámaras y configs en Redis.

Funcionalidades:
- Pool httpx.AsyncClient por servidor (persistente, con timeout y retry)
- Autenticación opcional via API key (header Authorization: Bearer <key>)
- Cache en Redis: cámaras (TTL 60s), config (TTL 30s), schema (TTL 3600s)
- Health check async: ping GET /api/version, timeout 5s
- Proxy de snapshots y clips (streaming, sin buffer en memoria completo)
- Manejo de errores con FrigateConnectionError, FrigateConfigError

Métodos públicos:

  get_version(server_id) → str
  get_cameras(server_id) → list[dict]          # desde /api/cameras
  get_snapshot(server_id, camera_name) → bytes
  get_event_clip(server_id, event_id) → AsyncGenerator[bytes]
  get_events(server_id, **filters) → list[dict]
  get_stats(server_id) → dict
  get_recordings(server_id, camera_name, after, before) → list[dict]
  health_check(server_id) → dict               # {online: bool, version: str, latency_ms: int}
  health_check_all() → dict[server_id, dict]
"""
```

---

## MQTTService — consumo multi-broker

**Archivo: `backend/app/services/mqtt_service.py`**

```python
"""
MQTTService

Consume eventos de múltiples brokers MQTT Frigate simultáneamente.
Cada servidor Frigate tiene su propio broker (o comparten uno vía mosquitto bridge).

Flujo por mensaje recibido:
  1. Parsear mensaje JSON del topic frigate/events o frigate/+/events
  2. Identificar a qué server_id corresponde el broker
  3. Normalizar evento al schema de la tabla events
  4. Guardar en PostgreSQL (EventService.create_event)
  5. Publicar en Redis pub/sub canal "vms:events"
  6. El WebSocket endpoint consume Redis pub/sub y hace push a clientes suscritos

Topics a suscribir por broker:
  frigate/events               → evento nuevo o actualizado
  frigate/+/events             → alternativo con camera name en topic
  frigate/stats                → estadísticas del servidor
  frigate/<camera>/motion      → detección de movimiento

Reconexión automática:
  - Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s, 60s max
  - Registrar en audit_log si un broker estuvo offline > 60s

Usar aiomqtt (async). Iniciar como tarea asyncio en lifespan de FastAPI.
"""
```

---

## WebSocket endpoint de eventos

**Archivo: `backend/app/api/ws/events.py`**

```python
"""
WebSocket /ws/events

Autenticación: query param ?token=<jwt>
El cliente se conecta y recibe eventos en tiempo real.

Protocolo mensajes cliente → servidor (JSON):
  {"type": "subscribe", "camera_ids": ["uuid1", "uuid2"]}   → filtrar por cámaras
  {"type": "subscribe_server", "server_ids": ["uuid1"]}      → filtrar por servidor
  {"type": "ping"}                                           → keepalive

Protocolo mensajes servidor → cliente (JSON):
  {
    "type": "event",
    "id": "bigint",
    "server_id": "uuid",
    "camera_id": "uuid",
    "camera_name": "string",
    "label": "string",
    "score": 0.95,
    "plate_number": "string | null",
    "snapshot_url": "string",
    "has_clip": true,
    "timestamp": "ISO8601"
  }
  {"type": "server_status", "server_id": "uuid", "online": true, "latency_ms": 12}
  {"type": "pong"}

Implementación:
  - Consumir canal Redis pub/sub "vms:events" con aioredis
  - Filtrar eventos según subscripciones del cliente
  - Verificar permisos can_view por camera_id antes de enviar
  - Heartbeat: enviar ping cada 30s, cerrar si no hay pong en 10s
  - Manejar desconexiones limpias
"""
```

---

## Frontend — Wizard de agregado de cámaras (componente clave)

**Archivo: `frontend/src/components/frigate-config/CameraWizard.tsx`**

El wizard debe implementar un flujo de 5 pasos:

```
Paso 1: Selección de servidor Frigate
  - Dropdown con servidores activos (estado: online/offline)
  - Mostrar versión y cantidad de cámaras actuales
  - Botón "Verificar conexión" que hace ping

Paso 2: Configuración de streams
  - Campo: Nombre de cámara (validación: solo a-z, 0-9, guiones bajos)
  - Campo: Nombre para mostrar
  - Campo: RTSP URL stream principal
    - Botón "Probar conexión" (hace GET /api/go2rtc/streams y verifica)
  - Toggle: ¿Tiene substream? (si sí, campo RTSP URL sub)
  - Tags (multi-select)

Paso 3: Detección y objetos
  - Campos: Resolución detección (width x height) con presets: 1280x720, 704x576, 640x480
  - Campo: FPS detección (5, 10, 15)
  - Toggle: Detección habilitada
  - Multi-select: Objetos a detectar (person, car, truck, bicycle, motorcycle, bus, dog, cat, etc.)
  - Campo: Máscara de detección (input de texto, futuro: editor gráfico)

Paso 4: Grabación y snapshots
  - Toggle: Grabación habilitada
  - Select: Modo retención (all | motion | active_objects)
  - Número: Días de retención
  - Toggle: Snapshots habilitados
  - Número: Días de retención snapshots
  - Toggle: Bounding box en snapshots

Paso 5: Revisión y confirmación
  - Preview del YAML que se va a aplicar (solo lectura, syntax highlight)
  - Checkbox: "Guardar config a disco" (auto_save)
  - Botón: "Agregar cámara"
  - Indicador de progreso durante el proceso
  - Resultado: éxito (con links a LiveView) o error con detalle

Estado del wizard: useWizardStore (Zustand) con persistencia de pasos
```

---

## Frontend — Editor de configuración Frigate

**Archivo: `frontend/src/components/frigate-config/FrigateConfigEditor.tsx`**

Vista completa de gestión de configuración de Frigate accesible desde `/frigate-config`.

Secciones:

```
1. Header: selector de servidor Frigate + badge estado + botón "Sincronizar cámaras VMS"

2. Panel "Cámaras Frigate":
   - Tabla con columnas: Nombre, Estado, Detección, Grabación, Snapshots, Acciones
   - Acciones por fila: Editar config, Ver en LiveView, Eliminar
   - Botón "Agregar cámara" → abre CameraWizard

3. Panel "Streams go2rtc":
   - Tabla: Nombre stream, URL(s), Acciones (eliminar)
   - Botón "Agregar stream manual"

4. Panel "Configuración global":
   - Tabs: MQTT | Grabación global | Snapshots global | Detección global | Birdseye
   - Formularios por sección con validación
   - Botón "Aplicar cambios"

5. Panel "Historial de cambios":
   - Timeline de cambios con: fecha, usuario, tipo de cambio, diff
   - Botón "Revertir último cambio" (solo si hay cambios sin guardar)

6. Panel "Config YAML raw":
   - Editor Monaco o textarea con el YAML actual
   - Solo lectura por defecto, toggle para editar (solo admin)
   - Botón "Copiar YAML"
```

---

## Docker Compose COMPLETO

```yaml
# docker-compose.yml — PRODUCCIÓN

services:
  postgres:
    image: postgres:16-alpine
    container_name: opencctv-postgres
    restart: unless-stopped
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
    container_name: opencctv-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  mqtt:
    image: eclipse-mosquitto:2
    container_name: opencctv-mqtt
    restart: unless-stopped
    volumes:
      - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf
      - mosquitto_data:/mosquitto/data
      - mosquitto_logs:/mosquitto/log
    ports:
      - "1883:1883"

  ovenmediaengine:
    image: airensoft/ovenmediaengine:latest
    container_name: opencctv-ome
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./ome/Server.xml:/opt/ovenmediaengine/bin/origin_conf/Server.xml
      - ome_logs:/var/log/ovenmediaengine

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: opencctv-backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      SECRET_KEY: ${SECRET_KEY}
      OME_WEBRTC_BASE: ${OME_WEBRTC_BASE:-ws://localhost:3333/live}
      OME_LLHLS_BASE: ${OME_LLHLS_BASE:-http://localhost:3334/live}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:3000}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend/app/plugins/external:/app/plugins/external

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: opencctv-frontend
    restart: unless-stopped
    environment:
      VITE_API_URL: ${VITE_API_URL:-http://localhost:8080}
      VITE_WS_URL: ${VITE_WS_URL:-ws://localhost:8080}
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  mosquitto_data:
  mosquitto_logs:
  ome_logs:
```

---

## .env.example COMPLETO

```bash
# ===========================
# OpenCCTV — Variables de entorno
# Copiar a .env y completar antes de ejecutar
# ===========================

# Base de datos
POSTGRES_DB=opencctv
POSTGRES_USER=opencctv
POSTGRES_PASSWORD=CAMBIAR_ESTO_EN_PRODUCCION

# Seguridad
SECRET_KEY=GENERAR_CON_openssl_rand_-hex_32
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# OME (OvenMediaEngine)
# Reemplazar con la IP pública o hostname del servidor VMS
OME_WEBRTC_BASE=ws://TU_IP_O_DOMINIO:3333/live
OME_LLHLS_BASE=http://TU_IP_O_DOMINIO:3334/live

# Frontend
VITE_API_URL=http://TU_IP_O_DOMINIO:8080
VITE_WS_URL=ws://TU_IP_O_DOMINIO:8080

# CORS (separar múltiples con comas)
CORS_ORIGINS=http://localhost:3000,http://TU_IP_O_DOMINIO:3000

# Logging
LOG_LEVEL=info

# ===========================
# NOTA: Los servidores Frigate se agregan desde la UI o API.
# No se configuran aquí — son multi-nodo y dinámicos.
# ===========================
```

---

## Configuración OME (ome/Server.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Server version="8">
  <Name>OpenCCTV-OME</Name>
  <Type>origin</Type>
  <IP>*</IP>
  <PrivacyProtection>false</PrivacyProtection>

  <Managers>
    <Host>
      <Names>
        <Name>*</Name>
      </Names>
      <TLS>
        <CertPath></CertPath>
        <KeyPath></KeyPath>
      </TLS>
    </Host>
    <API>
      <AccessToken>opencctv_ome_api_token</AccessToken>
      <CrossDomains>
        <Url>*</Url>
      </CrossDomains>
    </API>
  </Managers>

  <Bind>
    <Providers>
      <RTSP>
        <Port>10554</Port>
      </RTSP>
      <RTSPPull>
        <!-- Puerto para pull de streams RTSP externos (Frigate) -->
      </RTSPPull>
      <WebRTC>
        <Signalling>
          <Port>3333</Port>
        </Signalling>
        <IceCandidates>
          <IceCandidate>*:10000/udp</IceCandidate>
        </IceCandidates>
      </WebRTC>
    </Providers>

    <Publishers>
      <WebRTC>
        <Signalling>
          <Port>3333</Port>
        </Signalling>
        <IceCandidates>
          <IceCandidate>*:10000/udp</IceCandidate>
        </IceCandidates>
      </WebRTC>
      <LLHLS>
        <Port>3334</Port>
      </LLHLS>
    </Publishers>
  </Bind>

  <VirtualHosts>
    <VirtualHost>
      <Name>default</Name>
      <Host>
        <Names>
          <Name>*</Name>
        </Names>
      </Host>

      <Applications>
        <Application>
          <Name>live</Name>
          <Type>live</Type>

          <Providers>
            <!-- Pull RTSP desde Frigate go2rtc restream -->
            <RTSPPull>
              <!-- Las cámaras se agregan dinámicamente via API OME -->
            </RTSPPull>
          </Providers>

          <Publishers>
            <WebRTC>
              <!-- Sub-second latency para LiveView -->
              <Timeout>30000</Timeout>
            </WebRTC>
            <LLHLS>
              <!-- 2-5 segundos de latencia para grillas grandes y mobile -->
              <SegmentDuration>1</SegmentDuration>
              <SegmentCount>3</SegmentCount>
              <CrossDomains>
                <Url>*</Url>
              </CrossDomains>
            </LLHLS>
          </Publishers>
        </Application>
      </Applications>
    </VirtualHost>
  </VirtualHosts>
</Server>
```

---

## Mosquitto (mosquitto/mosquitto.conf)

```conf
listener 1883
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
log_type all
```

---

## Makefile COMPLETO

```makefile
.PHONY: up down dev build migrate seed logs shell-backend shell-db test lint clean

# === Producción ===
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

restart:
	docker compose restart

# === Desarrollo ===
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# === Base de datos ===
migrate:
	docker compose exec backend alembic upgrade head

migrate-create:
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"

migrate-down:
	docker compose exec backend alembic downgrade -1

seed:
	docker compose exec backend python -m app.scripts.seed_db

# === Diagnóstico ===
logs:
	docker compose logs -f --tail=100

logs-backend:
	docker compose logs -f backend --tail=200

logs-ome:
	docker compose logs -f ovenmediaengine --tail=100

status:
	docker compose ps

# === Shells ===
shell-backend:
	docker compose exec backend bash

shell-db:
	docker compose exec postgres psql -U opencctv opencctv

shell-redis:
	docker compose exec redis redis-cli

# === Testing y calidad ===
test:
	docker compose exec backend pytest tests/ -v --tb=short

test-coverage:
	docker compose exec backend pytest tests/ --cov=app --cov-report=html -v

lint:
	docker compose exec backend ruff check app/
	docker compose exec backend mypy app/

format:
	docker compose exec backend ruff format app/

# === Utilidades ===
clean:
	docker compose down -v
	docker system prune -f

backup-db:
	docker compose exec postgres pg_dump -U opencctv opencctv > backup_$(shell date +%Y%m%d_%H%M%S).sql

restore-db:
	docker compose exec -T postgres psql -U opencctv opencctv < $(FILE)

# === Primera vez ===
init:
	cp .env.example .env
	@echo "⚠️  Editar .env con tus valores antes de continuar"
	@echo "Luego ejecutar: make up && make migrate && make seed"
```

---

## Sistema de Plugins — IMPLEMENTAR COMPLETO

### Clase base (`backend/app/plugins/base.py`)

```python
from abc import ABC, abstractmethod
from typing import Optional
from fastapi import APIRouter

class BasePlugin(ABC):
    name: str
    version: str
    description: str
    author: str = "OpenCCTV Community"

    @abstractmethod
    async def on_load(self, config: dict) -> None:
        """Inicialización del plugin. Se llama al habilitar."""
        pass

    @abstractmethod
    async def on_event(self, event: dict) -> None:
        """
        Se llama por cada evento Frigate normalizado.
        event contiene: {server_id, camera_id, label, score, snapshot_url,
                          plate_number, zones, timestamp, ...}
        """
        pass

    async def on_unload(self) -> None:
        """Limpieza al deshabilitar el plugin."""
        pass

    def get_routes(self) -> Optional[APIRouter]:
        """
        Retorna un APIRouter con rutas adicionales (opcional).
        Se montará en /api/v1/plugins/{plugin_name}/
        """
        return None

    def get_config_schema(self) -> dict:
        """
        Retorna un JSON Schema para la config del plugin.
        Se usa en la UI de configuración de plugins.
        """
        return {}
```

### Registry dinámico (`backend/app/plugins/registry.py`)

```python
"""
PluginRegistry

Descubre y gestiona plugins de forma dinámica.

Rutas de descubrimiento (en orden):
  1. /app/plugins/builtin/     — plugins incluidos en el proyecto
  2. /app/plugins/external/    — directorio montable vía Docker volume

Cada plugin debe ser un directorio con:
  - __init__.py exportando una clase que hereda BasePlugin
  - plugin.json con metadata: {name, version, description, author}

Al arrancar FastAPI (lifespan):
  1. Descubrir todos los plugins disponibles
  2. Cargar los habilitados (enabled=true en tabla plugins de PostgreSQL)
  3. Montar sus rutas en el router de FastAPI
  4. Iniciar on_load() para cada uno

Métodos:
  discover()                    → list[PluginMeta]
  load_plugin(name)             → None
  unload_plugin(name)           → None
  reload_plugin(name)           → None  # útil en desarrollo
  get_active_plugins()          → list[BasePlugin]
  dispatch_event(event: dict)   → None  # llama on_event() en todos los plugins activos
"""
```

### Plugin builtin: LPR (`backend/app/plugins/builtin/lpr/`)

```python
"""
Plugin LPR (License Plate Recognition)

Procesa eventos de Frigate que contengan sub_label (placas).
Almacena en tabla lpr_events (extender schema con migración propia).
Expone /api/v1/plugins/lpr/search?plate=ABC123 para búsqueda.

on_event():
  - Si event["label"] == "car" y event["sub_label"] no está vacío:
    → Guardar en tabla lpr_events
    → Verificar contra lista negra (tabla lpr_blacklist)
    → Si coincide: enviar alerta via WebSocket con type="lpr_alert"

Rutas adicionales:
  GET  /api/v1/plugins/lpr/plates          → historial de placas (filtros: camera, date)
  GET  /api/v1/plugins/lpr/search          → búsqueda por placa (parcial o exacta)
  POST /api/v1/plugins/lpr/blacklist       → agregar placa a lista negra
  GET  /api/v1/plugins/lpr/blacklist       → listar placas en lista negra
  DELETE /api/v1/plugins/lpr/blacklist/{id}
"""
```

### Plugin builtin: Notificaciones

```python
"""
Plugin Notifications

Envía notificaciones configurables cuando ocurren eventos de Frigate.

Canales soportados:
  - Telegram: bot_token + chat_id, envía snapshot adjunto
  - Email: SMTP, envía snapshot como attachment
  - Webhook: POST a URL con payload JSON configurable

Config del plugin (JSON Schema):
  {
    "rules": [
      {
        "name": "Persona en entrada",
        "cameras": ["entrada_principal"],
        "labels": ["person"],
        "min_score": 0.75,
        "zones": ["zona_entrada"],
        "channel": "telegram",
        "config": {"bot_token": "...", "chat_id": "..."},
        "cooldown_seconds": 60
      }
    ]
  }

on_event():
  - Evaluar cada regla contra el evento
  - Si coincide y no está en cooldown: enviar notificación con snapshot
  - Registrar envío en tabla notification_log (migración propia)
"""
```

---

## Endpoints API VMS — MÍNIMO COMPLETO

```
# === Autenticación ===
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

# === Servidores Frigate ===
GET    /api/v1/servers
POST   /api/v1/servers
GET    /api/v1/servers/{id}
PUT    /api/v1/servers/{id}
DELETE /api/v1/servers/{id}
GET    /api/v1/servers/{id}/status          → ping + versión + cámaras detectadas
POST   /api/v1/servers/{id}/sync            → importar cámaras Frigate → VMS

# === Cámaras (VMS) ===
GET    /api/v1/cameras                      → lista paginada, filtros: server_id, tag, enabled
POST   /api/v1/cameras                      → crear cámara manual (sin wizard Frigate)
GET    /api/v1/cameras/{id}
PUT    /api/v1/cameras/{id}
DELETE /api/v1/cameras/{id}
GET    /api/v1/cameras/{id}/stream          → URLs OME según permisos y grilla
GET    /api/v1/cameras/{id}/snapshot        → proxy snapshot Frigate
POST   /api/v1/cameras/{id}/ptz            → comandos PTZ

# === Configuración Frigate (vía API 0.17+) ===
GET    /api/v1/frigate-config/{server_id}/config
GET    /api/v1/frigate-config/{server_id}/config/schema
GET    /api/v1/frigate-config/{server_id}/config/history
POST   /api/v1/frigate-config/{server_id}/config/revert
GET    /api/v1/frigate-config/{server_id}/streams
POST   /api/v1/frigate-config/{server_id}/streams
DELETE /api/v1/frigate-config/{server_id}/streams/{name}
GET    /api/v1/frigate-config/{server_id}/cameras
POST   /api/v1/frigate-config/{server_id}/cameras           ← wizard completo
GET    /api/v1/frigate-config/{server_id}/cameras/{name}
PUT    /api/v1/frigate-config/{server_id}/cameras/{name}
DELETE /api/v1/frigate-config/{server_id}/cameras/{name}
PUT    /api/v1/frigate-config/{server_id}/global/{section}
POST   /api/v1/frigate-config/{server_id}/sync
GET    /api/v1/frigate-config/{server_id}/stats
GET    /api/v1/frigate-config/{server_id}/version

# === Eventos ===
GET    /api/v1/events                       → cursor-based, filtros: camera, server, label,
                                              plate, start, end, zone, score_min, has_clip
GET    /api/v1/events/{id}
GET    /api/v1/events/{id}/clip             → streaming proxy clip Frigate
GET    /api/v1/events/{id}/snapshot         → proxy snapshot
DELETE /api/v1/events/{id}

# === Grabaciones ===
GET    /api/v1/recordings                   → por camera_id + rango tiempo
POST   /api/v1/recordings/export            → exportar via FFmpeg → job_id
GET    /api/v1/recordings/export/{job_id}   → estado del job

# === Usuarios ===
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/{id}
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}
PUT    /api/v1/users/{id}/permissions

# === Plugins ===
GET    /api/v1/plugins
GET    /api/v1/plugins/{name}
PUT    /api/v1/plugins/{name}/enable
PUT    /api/v1/plugins/{name}/disable
PUT    /api/v1/plugins/{name}/config

# === WebSocket ===
WS     /ws/events?token=<jwt>
```

---

## Frontend — Vistas y componentes REQUERIDOS

### Diseño visual

- Tema oscuro por defecto: fondo `#0d0f14`, sidebar `#131720`, cards `#1a1f2e`
- Acento principal: verde `#00d084` (estilo Nx Witness)
- Sin librerías de componentes externas — todo con TailwindCSS custom
- Tipografía: Inter para UI, JetBrains Mono para datos técnicos, placas y YAML

### Página LiveView (`/live`)

- Grilla configurable: 1x1, 2x2, 3x3, 4x4, 2+4, 5x5 (preset buttons)
- Cada celda: reproduce WebRTC por defecto via OvenPlayer, fallback a LL-HLS
- Grillas ≥ 4x4: usar substream automáticamente
- Doble click en celda: expande a fullscreen, activa audio, muestra overlay PTZ
- Overlay por celda: nombre cámara, servidor origen, estado conexión, última detección, badge LPR
- Selector de cámaras drag-and-drop para asignar a celdas
- Panel lateral retráctil con feed de eventos en tiempo real (WebSocket)
- Selector "Multi-servidor": mostrar cámaras de distintos servidores en la misma grilla

### Página Eventos (`/events`)

- Tabla paginada con filtros: servidor, cámara, tipo, etiqueta, placa, rango fecha, score mínimo
- Thumbnail/snapshot inline
- Click en evento: modal con snapshot + botón ver clip + metadata completa
- Botón exportar selección
- Feed live en sidebar (toggle WebSocket)

### Página Playback (`/playback`)

- Selector cámara + rango de tiempo
- Timeline visual con bloques de grabación y marcadores de eventos
- Player de clips con controles velocidad (0.25x a 4x)
- Vista multi-cámara sincronizada (hasta 4 simultáneas)

### Página Configuración Frigate (`/frigate-config`)

- Ver sección "Frontend — Editor de configuración Frigate" más arriba
- Acceso solo para roles `operator` y `admin`

### Dashboard (`/`)

- Cards resumen: cámaras activas, eventos hoy, detecciones por tipo (charts recharts)
- Mapa de cámaras (canvas SVG simple, sin Google Maps)
- Tabla últimos eventos
- Estado de todos los servidores Frigate (ping visual, latencia)
- Alertas LPR recientes (si plugin habilitado)

### Configuración general (`/settings`)

- Gestión servidores Frigate (agregar, editar, test conexión, sincronizar)
- Gestión cámaras VMS (editar display name, tags, habilitar/deshabilitar)
- Usuarios y roles (solo admin)
- Plugins (listar, habilitar/deshabilitar, configurar)

---

## Reglas de implementación OBLIGATORIAS

1. **TypeScript estricto** — `strict: true` en tsconfig, sin `any`, sin ignorar errores
2. **Async/await en todo el backend** — SQLAlchemy async, httpx async, aiomqtt, aioredis
3. **Variables de entorno** — NUNCA hardcodear credenciales, todo via `.env` y pydantic-settings
4. **Error handling estructurado** — todos los endpoints retornan `{detail: string, code: string, field?: string}`
5. **Logging** — structlog en backend, formato JSON en producción, contexto enriquecido (request_id, user_id, server_id)
6. **Tests** — pytest con fixtures async: auth completo, CRUD servidores, CRUD cámaras via API Frigate mockeada, listado eventos con filtros
7. **Paginación cursor-based** en eventos y grabaciones (campo `cursor` en respuesta)
8. **CORS** configurado correctamente (origins via variable de entorno)
9. **Rate limiting** en auth (slowapi): 10 intentos/minuto por IP
10. **Plugin system FUNCIONAL** — demostrar con plugin LPR o Notificaciones funcionando end-to-end
11. **FrigateConfigService** — validar config contra JSON Schema de Frigate antes de aplicar, SIEMPRE registrar en `frigate_config_history`
12. **Manejo de versiones Frigate** — verificar en conexión que el servidor es 0.17+, advertir si es anterior
13. **Cache Redis** — configs Frigate con TTL, nunca hacer más de 1 GET /api/config por petición
14. **Transacciones DB** — usar `async with db.begin()` en operaciones que escriben en múltiples tablas

---

## Orden de implementación sugerido

```
FASE 1 — Infraestructura base
  1. Estructura de directorios completa
  2. docker-compose.yml + .env.example + Makefile
  3. Backend: Dockerfile + pyproject.toml + config.py
  4. Backend: modelos SQLAlchemy + migraciones Alembic (001_initial_schema)
  5. Backend: auth (JWT, hashing, refresh tokens)
  6. Mosquitto config + OME Server.xml

FASE 2 — Core backend
  7. Backend: CRUD servidores Frigate + FrigateService (HTTP client pool)
  8. Backend: FrigateConfigService (get_full_config, add_camera, sync_cameras)
  9. Backend: MQTTService + EventService (consumo, normalización, almacenamiento)
  10. Backend: WebSocket endpoint con Redis pub/sub
  11. Backend: CRUD cámaras VMS + endpoints stream URLs
  12. Backend: Plugin system base + registry

FASE 3 — API configuración Frigate
  13. Backend: frigate_config.py endpoints (todos los de /frigate-config/)
  14. Backend: schemas Pydantic para config Frigate (AddCameraRequest, etc.)
  15. Backend: go2rtc stream management
  16. Backend: historial de config + revert

FASE 4 — Frontend base
  17. Frontend: Setup Vite + TypeScript + Tailwind + Zustand + React Query
  18. Frontend: Layout, sidebar, topbar, router, páginas skeleton
  19. Frontend: Auth (login, interceptores JWT, rutas protegidas)
  20. Frontend: Clientes API tipados para todos los endpoints

FASE 5 — Frontend features
  21. Frontend: LiveView con OvenPlayer (WebRTC + LL-HLS fallback)
  22. Frontend: CameraWizard (5 pasos completos)
  23. Frontend: FrigateConfigEditor
  24. Frontend: Página Eventos con WebSocket
  25. Frontend: Playback con timeline
  26. Frontend: Dashboard + Settings

FASE 6 — Plugins y documentación
  27. Plugin LPR builtin funcional
  28. Plugin Notificaciones builtin funcional
  29. README.md + ARCHITECTURE.md + docs/
  30. Tests de integración
```

---

## Documentación a generar

### README.md — incluir

- Badges: licencia MIT, Docker, versión, estado CI
- Screenshot placeholder (ASCII art de la grilla)
- Quick start en 5 pasos: `git clone` → `cp .env.example .env` → editar `.env` → `make up` → `make migrate`
- Lista completa de features
- Tabla de compatibilidad con versiones Frigate (0.14, 0.15, 0.16, **0.17+** recomendado)
- Tabla de puertos usados
- Links a docs/

### ARCHITECTURE.md — incluir

- Diagrama ASCII de arquitectura completa
- Descripción de cada componente y decisión de diseño
- Flujo de video: Cámara → Frigate → go2rtc RTSP restream → OME WebRTC/LL-HLS → Frontend
- Flujo de eventos: Cámara → Frigate AI → MQTT → Backend EventService → Redis pub/sub → WebSocket → Frontend
- Flujo configuración: Frontend Wizard → Backend FrigateConfigService → Frigate REST API → Config guardada

### docs/frigate-api-config.md — incluir

- Todos los endpoints de Frigate 0.17+ con ejemplos de request/response
- Cómo funciona PUT /api/config/set (merge vs replace, formato esperado)
- Diferencia entre /api/config/set y /api/config/save
- Ejemplos de config de cámara completa en JSON
- Errores comunes y cómo manejarlos
- Guía para agregar una cámara desde cero (go2rtc stream → camera config → sync VMS)

### docs/plugin-development.md — incluir

- Tutorial paso a paso: crear plugin "Hello World"
- Todos los hooks disponibles con tipos TypedDict de los parámetros
- Cómo montar plugin externo via Docker volume
- Ejemplo completo: Plugin "Telegram Notifier"
- Cómo agregar rutas propias al backend
- Cómo agregar schema de config para la UI

---

Empezar por FASE 1. Para cada archivo, incluir docstring en el módulo explicando
su responsabilidad y cómo encaja en la arquitectura. El código debe ser legible
por la comunidad — priorizar claridad sobre brevedad.
Este proyecto debe poder deployarse en producción con `make up && make migrate`.

---

---

# APÉNDICE — Referencia real de la API Frigate 0.17+ con ejemplos de integración

> **Fuente**: https://docs.frigate.video/integrations/api/frigate-http-api/
> Esta sección reemplaza cualquier suposición anterior sobre endpoints. Usar exclusivamente los paths documentados aquí.

---

## Puertos y autenticación — CRÍTICO

Frigate 0.17 expone **dos puertos con comportamiento radicalmente distinto**:

| Puerto | Descripción | Autenticación |
|--------|-------------|---------------|
| `8971` | UI y API autenticada. Usar en producción. | JWT cookie o Bearer token |
| `5000` | API interna sin autenticación. Solo dentro de red Docker. | Ninguna — todo es admin |

**Decisión de diseño para el VMS:**

- Si Frigate y el backend VMS corren en la misma red Docker Compose → usar puerto **5000** para llamadas internas (más simple, sin tokens).
- Si Frigate está en un servidor remoto o expuesto → usar puerto **8971** con autenticación JWT.
- **Nunca exponer el puerto 5000 al exterior.**

```python
# backend/app/services/frigate_service.py
# El cliente debe soportar ambos modos:

class FrigateClient:
    def __init__(self, base_url: str, use_auth: bool = False,
                 username: str = None, password: str = None):
        """
        base_url ejemplos:
          - "http://frigate:5000"   → puerto interno, sin auth (mismo compose)
          - "http://192.168.1.50:8971" → puerto externo, con auth
        """
        self.base_url = base_url.rstrip("/")
        self.use_auth = use_auth
        self._session_cookie: str | None = None
        self._client = httpx.AsyncClient(timeout=10.0)

    async def _get_headers(self) -> dict:
        if not self.use_auth:
            return {}
        if not self._session_cookie:
            await self._login()
        return {"Cookie": f"frigate_token={self._session_cookie}"}
```

---

## Autenticación con puerto 8971

Frigate usa **JWT almacenado en cookie** (`frigate_token`). También acepta `Authorization: Bearer <token>`.

### Login

```
POST /api/login
Content-Type: application/x-www-form-urlencoded

user=admin&password=tu_password
```

**Respuesta exitosa:** HTTP 200, setea cookie `frigate_token` (JWT, expira según `session_length`, default 24h).

**Implementación Python completa:**

```python
import httpx
from typing import Optional

class FrigateAuthClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self._token: Optional[str] = None
        self._client = httpx.AsyncClient(timeout=10.0)

    async def login(self) -> str:
        """
        POST /api/login — devuelve JWT token.
        Frigate usa form-encoded, NO JSON.
        """
        resp = await self._client.post(
            f"{self.base_url}/api/login",
            data={"user": self.username, "password": self.password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        # El token viene en la cookie 'frigate_token'
        cookie = resp.cookies.get("frigate_token")
        if not cookie:
            raise ValueError("Login exitoso pero no se recibió cookie frigate_token")
        self._token = cookie
        return cookie

    async def get(self, path: str, **kwargs) -> httpx.Response:
        """Wrapper GET con auto-login y retry."""
        if not self._token:
            await self.login()
        resp = await self._client.get(
            f"{self.base_url}{path}",
            cookies={"frigate_token": self._token},
            **kwargs,
        )
        if resp.status_code == 401:
            # Token expirado → re-login y reintentar una vez
            await self.login()
            resp = await self._client.get(
                f"{self.base_url}{path}",
                cookies={"frigate_token": self._token},
                **kwargs,
            )
        return resp

    async def put(self, path: str, **kwargs) -> httpx.Response:
        if not self._token:
            await self.login()
        return await self._client.put(
            f"{self.base_url}{path}",
            cookies={"frigate_token": self._token},
            **kwargs,
        )

    async def post(self, path: str, **kwargs) -> httpx.Response:
        if not self._token:
            await self.login()
        return await self._client.post(
            f"{self.base_url}{path}",
            cookies={"frigate_token": self._token},
            **kwargs,
        )

    async def delete(self, path: str, **kwargs) -> httpx.Response:
        if not self._token:
            await self.login()
        return await self._client.delete(
            f"{self.base_url}{path}",
            cookies={"frigate_token": self._token},
            **kwargs,
        )

    # Endpoints de autenticación Frigate
    async def get_profile(self) -> dict:
        """GET /api/profile — info del usuario autenticado."""
        resp = await self.get("/api/profile")
        return resp.json()

    async def logout(self):
        """GET /api/logout — invalida la sesión."""
        await self.get("/api/logout")
        self._token = None
```

**Verificación de autenticación con `GET /api/auth`:**

```python
async def verify_auth(self) -> bool:
    """
    GET /api/auth — verifica si el token actual es válido.
    Retorna True si autenticado, False si expirado.
    Útil como health check de sesión antes de operaciones críticas.
    """
    try:
        resp = await self._client.get(
            f"{self.base_url}/api/auth",
            cookies={"frigate_token": self._token},
            timeout=5.0,
        )
        return resp.status_code == 200
    except Exception:
        return False
```

---

## Endpoints App — Salud, configuración y sistema

### GET / — Health check

```
GET /
```

Retorna HTTP 200 si Frigate está funcionando. No requiere autenticación en puerto 5000.

```python
async def health_check(self) -> dict:
    """
    Verificación de salud del servidor Frigate.
    Usar GET / (root) como health check principal.
    Timeout reducido a 5s para no bloquear.
    """
    try:
        resp = await self._client.get(
            f"{self.base_url}/",
            timeout=5.0,
        )
        return {
            "online": resp.status_code == 200,
            "status_code": resp.status_code,
        }
    except httpx.ConnectError:
        return {"online": False, "error": "connection_refused"}
    except httpx.TimeoutException:
        return {"online": False, "error": "timeout"}
```

### GET /api/version — Versión de Frigate

```
GET /api/version
```

**Respuesta:** string plano con la versión, ejemplo: `0.17.1`

```python
async def get_version(self) -> str:
    """
    Retorna la versión de Frigate como string.
    IMPORTANTE: la respuesta es texto plano, NO JSON.
    """
    resp = await self.get("/api/version")
    resp.raise_for_status()
    version = resp.text.strip()  # ej: "0.17.1"

    # Validar que sea 0.17+
    parts = version.split(".")
    major, minor = int(parts[0]), int(parts[1])
    if (major, minor) < (0, 17):
        raise ValueError(
            f"Frigate {version} no soportado. Se requiere 0.17+. "
            "Actualizar Frigate antes de conectar al VMS."
        )
    return version
```

### GET /api/stats — Estadísticas del sistema

```
GET /api/stats
```

**Respuesta JSON:**

```json
{
  "detection_fps": 14.5,
  "detectors": {
    "coral": {
      "detection_start": 0.0,
      "inference_speed": 10.5,
      "pid": 12345
    }
  },
  "cameras": {
    "entrada_principal": {
      "camera_fps": 30.0,
      "capture_pid": 67890,
      "detection_fps": 5.0,
      "process_fps": 5.1,
      "skipped_fps": 0.0
    }
  },
  "cpu_usages": { ... },
  "gpu_usages": { ... },
  "service": {
    "last_updated": 1700000000,
    "latest_version": "0.17.1",
    "storage": {
      "/media/frigate/recordings": {
        "total": 500000000000,
        "used": 120000000000,
        "free": 380000000000,
        "mnt_type": "ext4"
      }
    },
    "uptime": 86400,
    "version": "0.17.1"
  }
}
```

```python
async def get_stats(self) -> dict:
    resp = await self.get("/api/stats")
    resp.raise_for_status()
    return resp.json()
```

### GET /api/config — Configuración completa

```
GET /api/config
```

Retorna la config completa de Frigate **como JSON** (no YAML). Incluye valores defaults mergeados.

```python
async def get_config(self) -> dict:
    """
    Obtiene la config completa de Frigate como dict Python.
    IMPORTANTE: incluye defaults, puede diferir del YAML en disco.
    """
    resp = await self.get("/api/config")
    resp.raise_for_status()
    return resp.json()
```

### GET /api/config/schema.json — JSON Schema de validación

```
GET /api/config/schema.json
```

Retorna el JSON Schema completo para validar configuraciones.

```python
async def get_config_schema(self) -> dict:
    """
    Retorna el JSON Schema de Frigate para validación.
    Cachear agresivamente — no cambia entre requests.
    """
    resp = await self.get("/api/config/schema.json")
    resp.raise_for_status()
    return resp.json()
```

### GET /api/config/raw — Config en YAML raw

```
GET /api/config/raw
```

Retorna el YAML exacto que está en disco (sin defaults mergeados). Útil para mostrar en el editor.

```python
async def get_config_raw(self) -> str:
    """Retorna el YAML de config tal como está guardado en disco."""
    resp = await self.get("/api/config/raw")
    resp.raise_for_status()
    return resp.text  # YAML como string
```

### PUT /api/config/set — Aplicar nueva configuración

```
PUT /api/config/set
Content-Type: application/json

{<config completa en JSON>}
```

**CRÍTICO — comportamiento real de este endpoint:**

- Recibe la config completa (o parcial con merge) como JSON.
- Aplica los cambios **en memoria** (Frigate recarga los procesos afectados).
- **NO persiste a disco** automáticamente — los cambios se pierden si Frigate reinicia.
- Para persistir, llamar `POST /api/config/save` después.
- Retorna HTTP 200 si válido, HTTP 422 si hay errores de validación.

```python
async def config_set(self, config: dict) -> dict:
    """
    Aplica config en memoria. NO persiste a disco.
    Siempre llamar config_save() después si querés persistir.

    IMPORTANTE: enviar la config COMPLETA, no solo el delta.
    Frigate reemplaza la config, no hace merge inteligente.
    Flujo correcto:
      1. config = await get_config()
      2. config["cameras"]["nueva_cam"] = {...}
      3. await config_set(config)
      4. await config_save()
    """
    resp = await self.put(
        "/api/config/set",
        json=config,
        headers={"Content-Type": "application/json"},
    )
    if resp.status_code == 422:
        error_detail = resp.json()
        raise ValueError(f"Config inválida: {error_detail}")
    resp.raise_for_status()
    return resp.json()
```

### POST /api/config/save — Persistir config a disco

```
POST /api/config/save
```

Guarda la config actual (en memoria) al archivo YAML en disco.

```python
async def config_save(self) -> dict:
    """
    Persiste la config en memoria a disco (config.yml).
    Llamar siempre después de config_set() si querés que sobreviva reinicios.
    """
    resp = await self.post("/api/config/save")
    resp.raise_for_status()
    return resp.json()
```

---

## Flujo completo: agregar una cámara vía API

Este es el flujo real, testeado y documentado, para agregar una cámara sin errores:

```python
async def add_camera_complete(
    self,
    camera_name: str,
    rtsp_main: str,
    rtsp_sub: str | None = None,
    detect_width: int = 1280,
    detect_height: int = 720,
    detect_fps: int = 5,
    track_objects: list[str] = None,
    record_enabled: bool = True,
    snapshots_enabled: bool = True,
) -> dict:
    """
    Agrega una cámara a Frigate de forma completa y segura.

    Paso 1: Registrar streams en go2rtc
    Paso 2: Leer config actual
    Paso 3: Agregar entrada de cámara
    Paso 4: Aplicar (config_set)
    Paso 5: Persistir (config_save)
    """
    if track_objects is None:
        track_objects = ["person", "car"]

    # PASO 1: Registrar streams go2rtc
    # go2rtc debe conocer el stream antes de que Frigate lo use
    await self.post(
        "/api/go2rtc/streams",
        json={"name": camera_name, "url": rtsp_main},
    )
    if rtsp_sub:
        await self.post(
            "/api/go2rtc/streams",
            json={"name": f"{camera_name}_sub", "url": rtsp_sub},
        )

    # PASO 2: Leer config actual completa
    config = await self.get_config()

    # PASO 3: Asegurarse de que "cameras" existe
    if "cameras" not in config:
        config["cameras"] = {}

    # Verificar que la cámara no existe ya
    if camera_name in config["cameras"]:
        raise ValueError(f"Cámara '{camera_name}' ya existe en Frigate")

    # PASO 4: Construir config de la cámara
    # IMPORTANTE: usar rtsp://127.0.0.1:8554/ (go2rtc restream local)
    # No usar la URL de la cámara directamente en ffmpeg.inputs cuando go2rtc está activo
    detect_stream = (
        f"rtsp://127.0.0.1:8554/{camera_name}_sub"
        if rtsp_sub
        else f"rtsp://127.0.0.1:8554/{camera_name}"
    )
    record_stream = f"rtsp://127.0.0.1:8554/{camera_name}"

    camera_config = {
        "ffmpeg": {
            "inputs": [
                {
                    "path": detect_stream,
                    "roles": ["detect"],
                },
                {
                    "path": record_stream,
                    "roles": ["record"],
                },
            ]
        },
        "detect": {
            "enabled": True,
            "width": detect_width,
            "height": detect_height,
            "fps": detect_fps,
        },
        "record": {
            "enabled": record_enabled,
            "retain": {"days": 7, "mode": "motion"},
            "events": {
                "retain": {"default": 10, "mode": "active_objects"}
            },
        },
        "snapshots": {
            "enabled": snapshots_enabled,
            "bounding_box": True,
            "retain": {"default": 10},
        },
        "objects": {
            "track": track_objects,
        },
    }

    config["cameras"][camera_name] = camera_config

    # PASO 5: Aplicar config
    await self.config_set(config)

    # PASO 6: Persistir a disco
    await self.config_save()

    return {
        "camera_name": camera_name,
        "config": camera_config,
        "status": "created",
    }
```

### Eliminar una cámara

```python
async def delete_camera(self, camera_name: str) -> bool:
    """
    Elimina una cámara de Frigate y sus streams go2rtc.
    """
    # Leer config actual
    config = await self.get_config()

    if camera_name not in config.get("cameras", {}):
        raise ValueError(f"Cámara '{camera_name}' no existe en Frigate")

    # Eliminar streams go2rtc asociados
    streams = await self.get_go2rtc_streams()
    for stream_name in list(streams.keys()):
        if stream_name == camera_name or stream_name == f"{camera_name}_sub":
            await self.delete(f"/api/go2rtc/streams/{stream_name}")

    # Eliminar de la config
    del config["cameras"][camera_name]

    # Aplicar y persistir
    await self.config_set(config)
    await self.config_save()
    return True
```

---

## Endpoints go2rtc

### GET /api/go2rtc/streams — Listar streams

```
GET /api/go2rtc/streams
```

**Respuesta JSON:**

```json
{
  "entrada_principal": {
    "producers": [
      {"url": "rtsp://usuario:password@192.168.1.101:554/stream1"}
    ],
    "consumers": []
  },
  "entrada_principal_sub": {
    "producers": [
      {"url": "rtsp://usuario:password@192.168.1.101:554/stream2"}
    ],
    "consumers": []
  }
}
```

```python
async def get_go2rtc_streams(self) -> dict:
    resp = await self.get("/api/go2rtc/streams")
    resp.raise_for_status()
    return resp.json()
```

### GET /api/go2rtc/streams/{camera_name} — Stream específico

```
GET /api/go2rtc/streams/{camera_name}
```

```python
async def get_go2rtc_stream(self, camera_name: str) -> dict | None:
    resp = await self.get(f"/api/go2rtc/streams/{camera_name}")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()
```

### POST /api/go2rtc/streams — Agregar stream

```
POST /api/go2rtc/streams
Content-Type: application/json

{"name": "entrada_principal", "url": "rtsp://user:pass@192.168.1.101:554/stream1"}
```

**IMPORTANTE:** go2rtc acepta múltiples URLs por stream (fallback):

```python
async def add_go2rtc_stream(
    self,
    name: str,
    url: str | list[str],
) -> dict:
    """
    Agrega un stream go2rtc.
    url puede ser un string o lista de strings (fallback automático).

    Ejemplos de URL soportadas por go2rtc:
      - "rtsp://user:pass@ip:554/stream"      → RTSP
      - "ffmpeg:rtsp://ip/stream#video=h264"  → FFmpeg pipeline
      - "http://ip/snapshot.jpg"              → JPEG polling
    """
    resp = await self.post(
        "/api/go2rtc/streams",
        json={"name": name, "url": url},
    )
    resp.raise_for_status()
    return resp.json()
```

### DELETE /api/go2rtc/streams/{name} — Eliminar stream

```
DELETE /api/go2rtc/streams/{name}
```

```python
async def delete_go2rtc_stream(self, name: str) -> bool:
    resp = await self.delete(f"/api/go2rtc/streams/{name}")
    if resp.status_code == 404:
        return False  # No existía, no es error
    resp.raise_for_status()
    return True
```

---

## Endpoints de Eventos

### GET /api/events — Listar eventos

```
GET /api/events
```

**Query params disponibles:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `camera` | string | Filtrar por cámara |
| `label` | string | Filtrar por etiqueta (person, car, etc.) |
| `sub_label` | string | Filtrar por sub-etiqueta (placas LPR) |
| `after` | float | Unix timestamp inicio |
| `before` | float | Unix timestamp fin |
| `limit` | int | Cantidad de resultados (default 100) |
| `has_clip` | int | 0 o 1 — filtrar por si tiene clip |
| `has_snapshot` | int | 0 o 1 |
| `include_thumbnails` | int | 0 o 1 (default 1) |
| `in_progress` | int | 0 o 1 — solo eventos en curso |
| `min_score` | float | Score mínimo (0.0 a 1.0) |
| `max_score` | float | Score máximo |
| `zones` | string | Zona específica |
| `favorites` | int | 0 o 1 |

**Respuesta — lista de objetos:**

```json
[
  {
    "id": "1700000000.123456-abc123",
    "camera": "entrada_principal",
    "frame_time": 1700000000.123456,
    "snapshot": {
      "frame_time": 1700000000.123456,
      "box": {"xmin": 100, "ymin": 200, "xmax": 300, "ymax": 400},
      "area": 40000,
      "region": {"xmin": 0, "ymin": 0, "xmax": 640, "ymax": 480},
      "score": 0.95,
      "attributes": []
    },
    "label": "person",
    "sub_label": null,
    "top_score": 0.95,
    "false_positive": null,
    "start_time": 1700000000.0,
    "end_time": 1700000060.0,
    "score": 0.95,
    "has_clip": true,
    "has_snapshot": true,
    "retain_indefinitely": false,
    "zones": ["zona_entrada"],
    "thumbnail": "<base64>",
    "plus_id": null,
    "model_hash": null,
    "detector_type": null,
    "model_type": null,
    "attributes": {}
  }
]
```

```python
async def get_events(
    self,
    camera: str | None = None,
    label: str | None = None,
    sub_label: str | None = None,
    after: float | None = None,
    before: float | None = None,
    limit: int = 100,
    has_clip: bool | None = None,
    has_snapshot: bool | None = None,
    min_score: float | None = None,
    in_progress: bool | None = None,
) -> list[dict]:
    params = {"limit": limit, "include_thumbnails": 0}  # thumbnails off para velocidad
    if camera:
        params["camera"] = camera
    if label:
        params["label"] = label
    if sub_label:
        params["sub_label"] = sub_label
    if after is not None:
        params["after"] = after
    if before is not None:
        params["before"] = before
    if has_clip is not None:
        params["has_clip"] = int(has_clip)
    if has_snapshot is not None:
        params["has_snapshot"] = int(has_snapshot)
    if min_score is not None:
        params["min_score"] = min_score
    if in_progress is not None:
        params["in_progress"] = int(in_progress)

    resp = await self.get("/api/events", params=params)
    resp.raise_for_status()
    return resp.json()
```

### GET /api/events/{event_id} — Evento específico

```
GET /api/events/{event_id}
```

```python
async def get_event(self, event_id: str) -> dict | None:
    resp = await self.get(f"/api/events/{event_id}")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()
```

### DELETE /api/events/{event_id} — Eliminar evento

```
DELETE /api/events/{event_id}
```

```python
async def delete_event(self, event_id: str) -> bool:
    resp = await self.delete(f"/api/events/{event_id}")
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    return True
```

### POST /api/events/{event_id}/retain — Retener indefinidamente

```
POST /api/events/{event_id}/retain
```

```python
async def retain_event(self, event_id: str) -> dict:
    resp = await self.post(f"/api/events/{event_id}/retain")
    resp.raise_for_status()
    return resp.json()
```

### POST /api/events/{event_id}/sub_label — Agregar sub-etiqueta (LPR)

```
POST /api/events/{event_id}/sub_label
Content-Type: application/json

{"subLabel": "ABC123", "subLabelScore": 0.95}
```

```python
async def set_event_sub_label(
    self, event_id: str, sub_label: str, score: float = 0.0
) -> dict:
    resp = await self.post(
        f"/api/events/{event_id}/sub_label",
        json={"subLabel": sub_label, "subLabelScore": score},
    )
    resp.raise_for_status()
    return resp.json()
```

---

## Endpoints de Media

### GET /{camera_name} — MJPEG feed en vivo

```
GET /{camera_name}
```

Retorna stream MJPEG. Para preview fallback cuando WebRTC no está disponible.

```
# URL de uso en el frontend (como src de <img>):
http://frigate:5000/entrada_principal
```

### GET /{camera_name}/latest.jpg — Snapshot más reciente

```
GET /{camera_name}/latest.jpg
```

Query params: `h` (height en px, opcional).

```python
async def get_latest_snapshot(
    self, camera_name: str, height: int | None = None
) -> bytes:
    """
    Retorna bytes de la imagen JPEG más reciente de la cámara.
    Usar como proxy en el backend VMS para agregar autenticación.
    """
    params = {}
    if height:
        params["h"] = height
    resp = await self.get(f"/api/{camera_name}/latest.jpg", params=params)
    resp.raise_for_status()
    return resp.content  # bytes JPEG
```

### GET /api/events/{event_id}/snapshot.jpg — Snapshot de evento

```
GET /api/events/{event_id}/snapshot.jpg
```

Query params: `bbox` (0/1 — mostrar bounding box), `timestamp` (0/1), `h` (height).

```python
async def get_event_snapshot(
    self,
    event_id: str,
    bbox: bool = True,
    height: int | None = None,
) -> bytes:
    params = {"bbox": int(bbox)}
    if height:
        params["h"] = height
    resp = await self.get(
        f"/api/events/{event_id}/snapshot.jpg", params=params
    )
    resp.raise_for_status()
    return resp.content
```

### GET /api/events/{event_id}/clip.mp4 — Clip de evento

```
GET /api/events/{event_id}/clip.mp4
```

```python
async def stream_event_clip(
    self, event_id: str
) -> httpx.Response:
    """
    Retorna response de streaming para hacer proxy al cliente.
    Usar con stream=True para no bufferear el video completo en memoria.
    """
    resp = await self._client.get(
        f"{self.base_url}/api/events/{event_id}/clip.mp4",
        cookies={"frigate_token": self._token} if self._token else {},
        follow_redirects=True,
    )
    resp.raise_for_status()
    return resp
```

**Proxy de clip en FastAPI (streaming):**

```python
# backend/app/api/v1/events.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

@router.get("/{event_id}/clip")
async def proxy_event_clip(
    event_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Proxy del clip de Frigate al cliente con autenticación VMS."""
    # Obtener event de la BD para verificar permisos
    event = await event_service.get_event(db, event_id)
    if not event:
        raise HTTPException(404, "Evento no encontrado")

    # Verificar permiso can_playback del usuario
    await check_camera_permission(current_user, event.camera_id, "can_playback", db)

    # Obtener cliente Frigate del servidor correspondiente
    client = await frigate_service.get_client(event.server_id)

    async def generate():
        async with client._client.stream(
            "GET",
            f"{client.base_url}/api/events/{event.frigate_event_id}/clip.mp4",
            cookies={"frigate_token": client._token} if client._token else {},
        ) as response:
            async for chunk in response.aiter_bytes(chunk_size=8192):
                yield chunk

    return StreamingResponse(
        generate(),
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{event_id}.mp4"'},
    )
```

### GET /{camera_name}/recordings — Grabaciones

```
GET /api/{camera_name}/recordings
```

Query params: `after` (unix timestamp), `before` (unix timestamp).

**Respuesta:**

```json
[
  {
    "id": "1700000000-entrada_principal",
    "camera": "entrada_principal",
    "start_time": 1700000000.0,
    "end_time": 1700003600.0,
    "duration": 3600.0,
    "motion": 120.5,
    "objects": 5,
    "dBFS": -40.2
  }
]
```

```python
async def get_recordings(
    self,
    camera_name: str,
    after: float | None = None,
    before: float | None = None,
) -> list[dict]:
    params = {}
    if after:
        params["after"] = after
    if before:
        params["before"] = before
    resp = await self.get(f"/api/{camera_name}/recordings", params=params)
    resp.raise_for_status()
    return resp.json()
```

### GET /{camera_name}/recordings/summary — Resumen por hora

```
GET /api/{camera_name}/recordings/summary
```

Retorna resumen de grabaciones agrupado por día/hora. Útil para la barra de timeline.

```python
async def get_recordings_summary(self, camera_name: str) -> dict:
    resp = await self.get(f"/api/{camera_name}/recordings/summary")
    resp.raise_for_status()
    return resp.json()
```

---

## Endpoints de Grabaciones (Media)

### GET /api/{camera_name}/grid.jpg — Miniatura grilla

```
GET /api/{camera_name}/grid.jpg
```

Imagen en grilla con múltiples frames recientes. Útil para preview en selector de cámaras.

### Recording clip por rango de tiempo

```
GET /api/{camera_name}/start/{start_ts}/end/{end_ts}/clip.mp4
```

```python
async def get_recording_clip(
    self,
    camera_name: str,
    start_ts: float,
    end_ts: float,
) -> httpx.Response:
    resp = await self._client.get(
        f"{self.base_url}/api/{camera_name}/start/{start_ts}/end/{end_ts}/clip.mp4",
        cookies={"frigate_token": self._token} if self._token else {},
    )
    resp.raise_for_status()
    return resp
```

---

## Endpoints PTZ

### GET /api/{camera_name}/ptz/info — Info PTZ

```
GET /api/{camera_name}/ptz/info
```

**Respuesta:**

```json
{
  "name": "entrada_ptz",
  "features": ["pt", "zoom", "presets"],
  "presets": ["home", "puerta", "estacionamiento"]
}
```

```python
async def get_ptz_info(self, camera_name: str) -> dict | None:
    resp = await self.get(f"/api/{camera_name}/ptz/info")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()
```

### POST /api/{camera_name}/ptz/move — Mover cámara PTZ

```
POST /api/{camera_name}/ptz/move
Content-Type: application/json

{
  "action": "move",
  "pan": 0.5,
  "tilt": -0.3,
  "zoom": 0.0
}
```

Acciones disponibles: `move`, `stop`, `preset`, `home`.
Valores de pan/tilt/zoom: `-1.0` a `1.0`.

```python
async def ptz_move(
    self,
    camera_name: str,
    action: str = "move",
    pan: float = 0.0,
    tilt: float = 0.0,
    zoom: float = 0.0,
    preset: str | None = None,
) -> dict:
    """
    Controla una cámara PTZ.

    action: "move" | "stop" | "preset" | "home"
    pan/tilt/zoom: -1.0 a 1.0 (solo para action="move")
    preset: nombre del preset (solo para action="preset")
    """
    payload = {"action": action}
    if action == "move":
        payload.update({"pan": pan, "tilt": tilt, "zoom": zoom})
    elif action == "preset" and preset:
        payload["preset"] = preset

    resp = await self.post(
        f"/api/{camera_name}/ptz/move",
        json=payload,
    )
    resp.raise_for_status()
    return resp.json()
```

---

## Endpoints de Timeline

### GET /api/timeline — Timeline de objetos

```
GET /api/timeline
```

Query params: `camera`, `source_id`, `after`, `before`, `limit`.

```python
async def get_timeline(
    self,
    camera: str | None = None,
    after: float | None = None,
    before: float | None = None,
    limit: int = 100,
) -> list[dict]:
    params = {"limit": limit}
    if camera:
        params["camera"] = camera
    if after:
        params["after"] = after
    if before:
        params["before"] = before
    resp = await self.get("/api/timeline", params=params)
    resp.raise_for_status()
    return resp.json()
```

### GET /api/timeline/hourly — Timeline por hora

```
GET /api/timeline/hourly
```

Agrupado por hora. Ideal para la barra de timeline del playback.

---

## Endpoints de Logs

### GET /api/logs/{service} — Logs de servicios

```
GET /api/logs/{service}
```

`service` puede ser: `frigate`, `go2rtc`, `nginx`.

```python
async def get_logs(
    self,
    service: str = "frigate",
    after: int | None = None,
) -> str:
    """
    Retorna los logs del servicio como texto plano.
    after: número de línea para paginación (opcional).
    """
    params = {}
    if after is not None:
        params["after"] = after
    resp = await self.get(f"/api/logs/{service}", params=params)
    resp.raise_for_status()
    return resp.text
```

---

## Restart

### POST /api/restart — Reiniciar Frigate

```
POST /api/restart
```

**Usar con extrema precaución** — interrumpe todas las grabaciones activas.

```python
async def restart(self) -> dict:
    """
    PELIGROSO: reinicia Frigate completamente.
    Interrumpe grabaciones. Solo usar si config_set/config_save no fue suficiente.
    Esperar ~30s después de llamar antes de hacer nuevas requests.
    """
    resp = await self.post("/api/restart")
    resp.raise_for_status()
    return resp.json()
```

---

## FrigateService completo — implementación de referencia

Este es el cliente completo a implementar en `backend/app/services/frigate_service.py`:

```python
"""
FrigateService — cliente multi-servidor para Frigate 0.17+

Gestiona un pool de clientes httpx hacia múltiples instancias Frigate.
Soporta puerto 5000 (sin auth, Docker interno) y 8971 (con auth JWT).

Uso:
    frigate_service = FrigateService(redis_client)
    await frigate_service.add_server(server_id, url="http://frigate:5000")
    version = await frigate_service.get_version(server_id)
    config = await frigate_service.get_config(server_id)
"""

import asyncio
import logging
from uuid import UUID
from typing import AsyncGenerator

import httpx
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

CACHE_TTL_CONFIG = 30        # segundos
CACHE_TTL_SCHEMA = 3600      # 1 hora
CACHE_TTL_CAMERAS = 60       # 1 minuto
CACHE_TTL_STATS = 10         # 10 segundos


class FrigateConnectionError(Exception):
    pass


class FrigateConfigError(Exception):
    pass


class FrigateClient:
    """Cliente HTTP para una instancia Frigate."""

    def __init__(
        self,
        server_id: UUID,
        base_url: str,
        use_auth: bool = False,
        username: str | None = None,
        password: str | None = None,
    ):
        self.server_id = server_id
        self.base_url = base_url.rstrip("/")
        self.use_auth = use_auth
        self.username = username
        self.password = password
        self._token: str | None = None
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
            follow_redirects=True,
        )

    async def _get_cookies(self) -> dict:
        if not self.use_auth:
            return {}
        if not self._token:
            await self._login()
        return {"frigate_token": self._token}

    async def _login(self):
        try:
            resp = await self._client.post(
                f"{self.base_url}/api/login",
                data={"user": self.username, "password": self.password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            self._token = resp.cookies.get("frigate_token")
            if not self._token:
                raise FrigateConnectionError("Login OK pero sin cookie frigate_token")
        except httpx.HTTPError as e:
            raise FrigateConnectionError(f"Error autenticando con Frigate: {e}")

    async def get(self, path: str, **kwargs) -> httpx.Response:
        try:
            resp = await self._client.get(
                f"{self.base_url}{path}",
                cookies=await self._get_cookies(),
                **kwargs,
            )
            if resp.status_code == 401 and self.use_auth:
                self._token = None
                await self._login()
                resp = await self._client.get(
                    f"{self.base_url}{path}",
                    cookies=await self._get_cookies(),
                    **kwargs,
                )
            return resp
        except httpx.ConnectError as e:
            raise FrigateConnectionError(f"No se puede conectar a {self.base_url}: {e}")
        except httpx.TimeoutException:
            raise FrigateConnectionError(f"Timeout conectando a {self.base_url}")

    async def put(self, path: str, **kwargs) -> httpx.Response:
        try:
            resp = await self._client.put(
                f"{self.base_url}{path}",
                cookies=await self._get_cookies(),
                **kwargs,
            )
            if resp.status_code == 401 and self.use_auth:
                self._token = None
                await self._login()
                resp = await self._client.put(
                    f"{self.base_url}{path}",
                    cookies=await self._get_cookies(),
                    **kwargs,
                )
            return resp
        except httpx.HTTPError as e:
            raise FrigateConnectionError(str(e))

    async def post(self, path: str, **kwargs) -> httpx.Response:
        try:
            resp = await self._client.post(
                f"{self.base_url}{path}",
                cookies=await self._get_cookies(),
                **kwargs,
            )
            if resp.status_code == 401 and self.use_auth:
                self._token = None
                await self._login()
                resp = await self._client.post(
                    f"{self.base_url}{path}",
                    cookies=await self._get_cookies(),
                    **kwargs,
                )
            return resp
        except httpx.HTTPError as e:
            raise FrigateConnectionError(str(e))

    async def delete(self, path: str, **kwargs) -> httpx.Response:
        try:
            resp = await self._client.delete(
                f"{self.base_url}{path}",
                cookies=await self._get_cookies(),
                **kwargs,
            )
            return resp
        except httpx.HTTPError as e:
            raise FrigateConnectionError(str(e))

    async def close(self):
        await self._client.aclose()


class FrigateService:
    """
    Gestiona múltiples clientes Frigate con cache Redis.
    """

    def __init__(self, redis: aioredis.Redis):
        self.redis = redis
        self._clients: dict[UUID, FrigateClient] = {}

    def add_client(
        self,
        server_id: UUID,
        base_url: str,
        use_auth: bool = False,
        username: str | None = None,
        password: str | None = None,
    ) -> FrigateClient:
        client = FrigateClient(server_id, base_url, use_auth, username, password)
        self._clients[server_id] = client
        return client

    def get_client(self, server_id: UUID) -> FrigateClient:
        client = self._clients.get(server_id)
        if not client:
            raise FrigateConnectionError(
                f"Servidor {server_id} no registrado. "
                "Agregar el servidor desde la UI antes de operar."
            )
        return client

    async def remove_client(self, server_id: UUID):
        client = self._clients.pop(server_id, None)
        if client:
            await client.close()

    # ---- Health & Version ----

    async def health_check(self, server_id: UUID) -> dict:
        client = self.get_client(server_id)
        import time
        start = time.monotonic()
        try:
            resp = await client.get("/")
            latency_ms = int((time.monotonic() - start) * 1000)
            return {
                "online": resp.status_code == 200,
                "latency_ms": latency_ms,
                "server_id": str(server_id),
            }
        except FrigateConnectionError as e:
            return {"online": False, "error": str(e), "server_id": str(server_id)}

    async def get_version(self, server_id: UUID) -> str:
        client = self.get_client(server_id)
        cache_key = f"frigate_version:{server_id}"
        cached = await self.redis.get(cache_key)
        if cached:
            return cached.decode()
        resp = await client.get("/api/version")
        resp.raise_for_status()
        version = resp.text.strip()
        await self.redis.setex(cache_key, 300, version)
        return version

    # ---- Config ----

    async def get_config(self, server_id: UUID, use_cache: bool = True) -> dict:
        cache_key = f"frigate_config:{server_id}"
        if use_cache:
            cached = await self.redis.get(cache_key)
            if cached:
                import json
                return json.loads(cached)
        client = self.get_client(server_id)
        resp = await client.get("/api/config")
        resp.raise_for_status()
        config = resp.json()
        await self.redis.setex(cache_key, CACHE_TTL_CONFIG, resp.text)
        return config

    async def config_set(self, server_id: UUID, config: dict) -> dict:
        client = self.get_client(server_id)
        resp = await client.put("/api/config/set", json=config)
        if resp.status_code == 422:
            raise FrigateConfigError(f"Config inválida: {resp.json()}")
        resp.raise_for_status()
        # Invalidar cache
        await self.redis.delete(f"frigate_config:{server_id}")
        return resp.json()

    async def config_save(self, server_id: UUID) -> dict:
        client = self.get_client(server_id)
        resp = await client.post("/api/config/save")
        resp.raise_for_status()
        return resp.json()

    # ---- Cameras & go2rtc ----

    async def get_go2rtc_streams(self, server_id: UUID) -> dict:
        client = self.get_client(server_id)
        resp = await client.get("/api/go2rtc/streams")
        resp.raise_for_status()
        return resp.json()

    async def add_go2rtc_stream(self, server_id: UUID, name: str, url: str) -> dict:
        client = self.get_client(server_id)
        resp = await client.post("/api/go2rtc/streams", json={"name": name, "url": url})
        resp.raise_for_status()
        return resp.json()

    async def delete_go2rtc_stream(self, server_id: UUID, name: str) -> bool:
        client = self.get_client(server_id)
        resp = await client.delete(f"/api/go2rtc/streams/{name}")
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True

    # ---- Events ----

    async def get_events(self, server_id: UUID, **filters) -> list[dict]:
        client = self.get_client(server_id)
        params = {k: v for k, v in filters.items() if v is not None}
        resp = await client.get("/api/events", params=params)
        resp.raise_for_status()
        return resp.json()

    async def get_event_snapshot(
        self, server_id: UUID, event_id: str, bbox: bool = True
    ) -> bytes:
        client = self.get_client(server_id)
        resp = await client.get(
            f"/api/events/{event_id}/snapshot.jpg",
            params={"bbox": int(bbox)},
        )
        resp.raise_for_status()
        return resp.content

    async def stream_event_clip(
        self, server_id: UUID, event_id: str
    ) -> AsyncGenerator[bytes, None]:
        client = self.get_client(server_id)
        async with client._client.stream(
            "GET",
            f"{client.base_url}/api/events/{event_id}/clip.mp4",
            cookies=await client._get_cookies(),
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes(chunk_size=8192):
                yield chunk

    # ---- Snapshots ----

    async def get_latest_snapshot(
        self, server_id: UUID, camera_name: str, height: int | None = None
    ) -> bytes:
        client = self.get_client(server_id)
        params = {}
        if height:
            params["h"] = height
        resp = await client.get(f"/api/{camera_name}/latest.jpg", params=params)
        resp.raise_for_status()
        return resp.content

    # ---- Stats ----

    async def get_stats(self, server_id: UUID) -> dict:
        cache_key = f"frigate_stats:{server_id}"
        cached = await self.redis.get(cache_key)
        if cached:
            import json
            return json.loads(cached)
        client = self.get_client(server_id)
        resp = await client.get("/api/stats")
        resp.raise_for_status()
        await self.redis.setex(cache_key, CACHE_TTL_STATS, resp.text)
        return resp.json()

    # ---- PTZ ----

    async def ptz_move(
        self,
        server_id: UUID,
        camera_name: str,
        action: str,
        pan: float = 0.0,
        tilt: float = 0.0,
        zoom: float = 0.0,
        preset: str | None = None,
    ) -> dict:
        client = self.get_client(server_id)
        payload = {"action": action}
        if action == "move":
            payload.update({"pan": pan, "tilt": tilt, "zoom": zoom})
        elif action == "preset" and preset:
            payload["preset"] = preset
        resp = await client.post(f"/api/{camera_name}/ptz/move", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def close_all(self):
        for client in self._clients.values():
            await client.close()
        self._clients.clear()
```

---

## Errores comunes y soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `401 Unauthorized` en `/api/config` | Usando puerto 8971 sin token | Hacer login primero con `POST /api/login`, o usar puerto 5000 en red interna |
| `422 Unprocessable Entity` en `PUT /api/config/set` | Config JSON inválida | Revisar la respuesta JSON de error, contiene el campo exacto que falla |
| `Connection refused` en puerto 8971 | Frigate no expone 8971 por defecto en Docker | Agregar `- "8971:8971"` en ports del docker-compose de Frigate |
| `Connection refused` en puerto 5000 | Frigate en red diferente | Verificar que ambos contenedores están en la misma red Docker |
| Stream RTSP no aparece en go2rtc | `POST /api/go2rtc/streams` no fue llamado | go2rtc debe registrar el stream ANTES de que Frigate intente usarlo |
| Cámara agrega OK pero no detecta | ffmpeg.inputs usa URL de cámara directa en vez de go2rtc | Usar `rtsp://127.0.0.1:8554/{camera_name}` en los inputs, no la URL original |
| `config_set` OK pero config se pierde al reiniciar | No se llamó `config_save` | Llamar `POST /api/config/save` después de cada `PUT /api/config/set` |
| Snapshot retorna 404 | La cámara no tiene snapshots habilitados | Verificar `snapshots.enabled: true` en la config de la cámara |
| PTZ retorna 404 | Cámara no tiene PTZ configurado en Frigate | Verificar `onvif` config en la cámara y que `ptz/info` retorna features |
| MQTT no recibe eventos | Topic equivocado | Frigate publica en `frigate/events` (objeto completo) y `frigate/{cam}/events` |

---

## Tabla completa de endpoints confirmados

| Método | Path | Descripción | Auth requerida (8971) |
|--------|------|-------------|----------------------|
| `GET` | `/` | Health check | No |
| `GET` | `/api/version` | Versión (texto plano) | No |
| `GET` | `/api/stats` | Stats del sistema | Sí |
| `GET` | `/api/stats/history` | Historial de stats | Sí |
| `GET` | `/api/config` | Config completa (JSON) | Sí |
| `GET` | `/api/config/raw` | Config YAML en disco | Sí |
| `GET` | `/api/config/schema.json` | JSON Schema validación | Sí |
| `PUT` | `/api/config/set` | Aplicar config (en memoria) | Sí |
| `POST` | `/api/config/save` | Persistir config a disco | Sí |
| `GET` | `/api/go2rtc/streams` | Listar streams go2rtc | Sí |
| `GET` | `/api/go2rtc/streams/{name}` | Stream específico | Sí |
| `POST` | `/api/go2rtc/streams` | Agregar stream | Sí |
| `DELETE` | `/api/go2rtc/streams/{name}` | Eliminar stream | Sí |
| `GET` | `/api/events` | Listar eventos (filtrable) | Sí |
| `GET` | `/api/events/{id}` | Evento específico | Sí |
| `DELETE` | `/api/events/{id}` | Eliminar evento | Sí |
| `POST` | `/api/events/{id}/retain` | Retener indefinidamente | Sí |
| `DELETE` | `/api/events/{id}/retain` | Quitar retención | Sí |
| `POST` | `/api/events/{id}/sub_label` | Setear sub-etiqueta | Sí |
| `GET` | `/api/events/{id}/snapshot.jpg` | Snapshot del evento | Sí |
| `GET` | `/api/events/{id}/clip.mp4` | Clip del evento | Sí |
| `GET` | `/api/events/{id}/thumbnail.jpg` | Thumbnail | Sí |
| `GET` | `/{camera_name}` | MJPEG feed en vivo | Sí |
| `GET` | `/api/{camera_name}/latest.jpg` | Snapshot reciente | Sí |
| `GET` | `/api/{camera_name}/grid.jpg` | Grilla de frames | Sí |
| `GET` | `/api/{camera_name}/recordings` | Grabaciones (rango) | Sí |
| `GET` | `/api/{camera_name}/recordings/summary` | Resumen por hora | Sí |
| `GET` | `/api/{camera_name}/start/{s}/end/{e}/clip.mp4` | Clip por timestamp | Sí |
| `GET` | `/api/{camera_name}/ptz/info` | Info PTZ | Sí |
| `POST` | `/api/{camera_name}/ptz/move` | Mover PTZ | Sí |
| `GET` | `/api/timeline` | Timeline de objetos | Sí |
| `GET` | `/api/timeline/hourly` | Timeline por hora | Sí |
| `GET` | `/api/logs/{service}` | Logs (frigate/go2rtc/nginx) | Sí |
| `POST` | `/api/restart` | Reiniciar Frigate | Sí (admin) |
| `GET` | `/api/auth` | Verificar token | Sí |
| `POST` | `/api/login` | Login → cookie JWT | No |
| `GET` | `/api/logout` | Cerrar sesión | Sí |
| `GET` | `/api/profile` | Perfil usuario actual | Sí |
| `GET` | `/api/users` | Listar usuarios | Sí (admin) |
| `POST` | `/api/users` | Crear usuario | Sí (admin) |
| `PUT` | `/api/users/{user}/password` | Cambiar password | Sí |
| `PUT` | `/api/users/{user}/role` | Cambiar rol | Sí (admin) |
| `DELETE` | `/api/users/{user}` | Eliminar usuario | Sí (admin) |
| `GET` | `/api/labels` | Etiquetas disponibles | Sí |
| `GET` | `/api/sub_labels` | Sub-etiquetas | Sí |
| `GET` | `/api/recognized_license_plates` | Placas reconocidas | Sí |
| `GET` | `/api/ffprobe` | Info de stream vía ffprobe | Sí |

---

*Referencia verificada contra https://docs.frigate.video/integrations/api/frigate-http-api/ — Frigate 0.17+*
