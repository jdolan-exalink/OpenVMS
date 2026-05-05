# OpenVMS — Video Management System Opensource con IA

> **OpenVMS** (Open Computer Vision Video Management System) es un sistema VMS opensource, equivalente a Nx Witness / Avigilon, construido para instalaciones CCTV profesionales con inteligencia artificial.

[![Python 3.12](https://img.shields.io/badge/Python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-green.svg)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/React-18-cyan.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Tabla de Contenidos

- [Funcionalidades](#funcionalidades)
- [Stack Tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
- [Plugins](#plugins)
- [Quick Start](#quick-start)
- [API REST](#api-rest)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

---

## Funcionalidades

### Vigilancia en Tiempo Real
- **Vista en vivo** con grilla configurable (1×1 hasta 6×6)
- **WebRTC y LL-HLS** a través de OvenMediaEngine
- **Multi-servidor Frigate** — conecta múltiples nodos Frigate simultáneamente
- **WebSocket** para eventos en tiempo real sin polling

### Inteligencia Artificial
- **Detección de objetos** — YOLO (personas, vehículos, rostros, placas, humo, fuego)
- **Búsqueda semántica** — CLIP + pgvector para buscar eventos por descripción textual o imagen
- **Reconocimiento facial** — InsightFace con embeddings vectoriales
- **OCR** — lectura de texto en escenas (PaddleOCR)
- **Resumen IA** — generación automática de resúmenes de eventos via Ollama VLM
- **Análisis de pose** — MediaPipe para detección de caídas

### Plugins Modulares
15 plugins de IA integrados, cada uno con su propia página en el sidebar y APIs REST propias. Sistema de plugins basado en `BasePlugin` abstracto con registro dinámico.

### Event Pipeline
- **MQTT multi-broker** — consume eventos desde múltiples servidores Frigate
- **Base de datos** — PostgreSQL con índices de rendimiento para eventos
- **Búsqueda** — filtrado por cámara, label, severidad, rango de tiempo
- **Exportación** — clips de video via FFmpeg

### Seguridad y Gestión
- **Autenticación JWT** con refresh tokens
- **Control de acceso** por roles (admin, operator, viewer)
- **Auditoría** — logs de todas las acciones de usuarios
- **Rate limiting** en endpoints de autenticación

---

## Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| **Backend API** | FastAPI (Python 3.12) + SQLAlchemy async + asyncpg |
| **Base de datos** | PostgreSQL 16 |
| **Caché / PubSub** | Redis 7 |
| **Mensajería** | Mosquitto MQTT |
| **Streaming** | OvenMediaEngine (WebRTC + LL-HLS), go2rtc (Frigate) |
| **Frontend** | React 18 + Vite, TypeScript strict, TailwindCSS |
| **Estado global** | Zustand + React Query |
| **Tiempo real** | Socket.io (backend), Socket.io-client (frontend) |
| **Orquestación** | Docker Compose + Traefik |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cliente React                             │
│   LiveGrid · Events · Playback · Dashboard · Settings · Plugins  │
└──────────────┬──────────────────────┬────────────────────────────┘
               │ HTTPS/WSS            │ HTTP REST
               ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Traefik (Reverse Proxy)                      │
│                  SSL Termination + Routing                       │
└──────┬──────────────────────┬──────────────────────┬────────────┘
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐
│   Backend    │    │   Frontend   │    │    OvenMediaEngine        │
│   FastAPI    │    │   React/Vite │    │  WebRTC + LL-HLS streams  │
│  (port 8000) │    │  (port 3000) │    │   (port 3333/3334)       │
└──────┬───────┘    └──────────────┘    └──────────────────────────┘
       │                                             ▲
       │                                             │ RTSP pull
       ▼                                             │
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────┐
│ PostgreSQL   │    │    Redis     │    │   Frigate    │───▶│Camera│
│  (port 5432) │    │ (port 6379) │    │  + go2rtc    │    └──────┘
└──────────────┘    └──────┬───────┘    │  (MQTT push) │
                           │            └──────────────┘
                           ▼
                   ┌──────────────┐
                   │  Mosquitto   │
                   │    MQTT      │
                   │ (port 1883)  │
                   └──────────────┘
```

### Flujo de Datos

1. **Video**: Cámara IP → Frigate (detección + grabación) → go2rtc restream → OvenMediaEngine → Frontend (WebRTC/LL-HLS via OvenPlayer)
2. **Eventos**: Frigate MQTT → `MQTTService` (consumidor multi-broker) → `EventService` (normalización + PostgreSQL) → WebSocket → Frontend Socket.io-client
3. **Plugins**: Cada plugin recibe eventos vía `on_event()` y puede emitir alertas vía `_emit_alert()`

---

## Plugins

OpenVMS incluye **15 plugins** organizados en dos categorías: **builtin** (2) y **enterprise** (13). Todos tienen página de sidebar y APIs REST propias.

### Plugins de Reconocimiento (`recognition`)

| Plugin | Descripción | Algoritmo | API Endpoints |
|--------|-------------|-----------|---------------|
| **LPR** (`lpr`) | Reconocimiento básico de matrículas desde sub_labels de Frigate. Gestiona blacklist de vehículos. | Regex + blacklist DB | `GET /plates`, `GET /search`, `POST /blacklist`, `GET /blacklist`, `DELETE /blacklist/{id}` |
| **LPR Avanzado** (`lpr_advanced`) | OCR de matrículas con YOLO + PaddleOCR. Detecta y lee placas en tiempo real. | YOLO + PaddleOCR | `GET /stats`, `POST /reset/{camera_name}` |
| **Reconocimiento Facial** (`face_recognition`) | Identifica rostros con InsightFace + búsqueda vectorial pgvector. Galería de rostros conocidos. | InsightFace Buffalo L (512-dim) + pgvector cosine similarity | `GET /faces`, `GET /unknowns`, `POST /faces/register`, `POST /faces/{id}/identify`, `PUT /faces/{id}/name`, `DELETE /faces/{id}` |
| **OCR General** (`ocr_general`) | Lectura de texto arbitrario en escenas. Detecta texto en ROI configurables. | PaddleOCR + regex pattern matching | `GET /stats`, `POST /reset-cooldown` |

### Plugins de Analítica (`analytics`)

| Plugin | Descripción | Algoritmo | API Endpoints |
|--------|-------------|-----------|---------------|
| **Conteo de Personas** (`people_counting`) | Cuenta personas y vehículos que cruzan líneas virtuales. Reportes horarios en PostgreSQL. | Producto cruz vectorial, líneas bidireccionales | `GET /counts`, `DELETE /counts`, `GET /history`, `DELETE /history` |
| **Cruce de Línea** (`line_crossing`) | Detecta cruces de línea virtual con dirección (AB/BA/BOTH). Persiste eventos en DB. | Producto cruz vectorial | `GET /lines`, `GET /stats`, `DELETE /tracks/{track_id}` |
| **Merodeo** (`loitering`) | Detecta permanencia prolongada en zonas poligonales. | cv2.pointPolygonTest (punto-en-polígono) | `GET /zones`, `GET /stats`, `DELETE /tracks/{track_id}` |
| **Objeto Abandonado** (`abandoned_object`) | Detecta objetos que permanecen estáticos en escena más allá de un umbral. | YOLO + tracking de posición | `GET /stats`, `DELETE /objects/{id}` |
| **Cumplimiento EPP** (`epp`) | Detecta uso de EPP (casco, chaleco reflectivo) en zonas configuradas. | YOLO + detección color HSV | `GET /stats`, `DELETE /tracks/{person_id}` |

### Plugins de Seguridad (`safety` / `security`)

| Plugin | Descripción | Algoritmo | API Endpoints |
|--------|-------------|-----------|---------------|
| **Caídas** (`fall_detection`) | Detecta caídas de personas mediante análisis de pose esquelética. | MediaPipe Pose (33 keypoints) + ángulo de pose | `GET /stats`, `DELETE /tracks/{person_id}` |
| **Humo y Fuego** (`smoke_fire`) | Detecta humo y fuego en tiempo real con confirmación por frames consecutivos. | YOLO especializado (smoke_fire_yolo) | `GET /stats`, `DELETE /reset/{camera_name}` |
| **Sabotaje de Cámara** (`camera_sabotage`) | Detecta tapado, color sólido, desenfoque y cambio de escena. | Análisis de brillo + Laplacian (blur) + SSIM | `GET /stats`, `DELETE /reset/{camera_name}` |

### Plugins de IA (`ai`)

| Plugin | Descripción | Algoritmo | API Endpoints |
|--------|-------------|-----------|---------------|
| **Resumen IA** (`ai_summary`) | Genera resúmenes automáticos de eventos via Ollama VLM. Cola asíncrona de procesamiento. | Ollama VLM (llava) + asyncio Queue | `GET /queue-status`, `GET /summaries`, `POST /summaries/generate` |
| **Búsqueda Semántica** (`semantic_search`) | Busca eventos por descripción textual o imagen usando embeddings CLIP. | OpenAI CLIP + pgvector (IVFFlat index) | `GET /search`, `GET /stats` |

### Plugins de Notificaciones (`notifications`)

| Plugin | Descripción | Algoritmo | API Endpoints |
|--------|-------------|-----------|---------------|
| **Alertas Multicanal** (`notifications`) | Envía alertas por Telegram o Webhook según reglas configurables. | Motor de reglas multicondición | Ninguno (event-driven) |

---

## Quick Start

### Requisitos
- Docker Compose
- 8GB+ RAM (GPU recomendada para plugins de IA)

### 1. Clonar el repositorio
```bash
git clone https://github.com/jdolan-exalink/OpenVMS.git
cd OpenVMS
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env y configurar:
# - SECRET_KEY (JWT signing key)
# - POSTGRES_PASSWORD
# - OME_WEBRTC_BASE, OME_LLHLS_BASE
```

### 3. Iniciar el stack
```bash
make up          # Producción
# o
make dev         # Desarrollo con hot-reload
```

### 4. Aplicar migraciones
```bash
make migrate
```

### 5. Crear usuario admin
```bash
make seed
```

Accede a `http://localhost:3000` con credentials del seed.

### Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `make up` | Iniciar stack producción |
| `make down` | Detener stack |
| `make dev` | Desarrollo con hot-reload |
| `make migrate` | Correr Alembic migrations |
| `make seed` | Poblar datos de prueba |
| `make logs` | Tail de todos los logs |
| `make shell-backend` | Exec en container backend |
| `make shell-db` | Conectar a PostgreSQL |
| `make test` | Correr tests pytest |
| `make lint` | Correr ruff lint |

---

## API REST

La API REST está versionada en `/api/v1/`. Ver documentación completa en `docs/api.md`.

### Autenticación
```
POST /api/v1/auth/login          → JWT access + refresh tokens
POST /api/v1/auth/refresh       → Refrescar access token
POST /api/v1/auth/logout        → Invalidar refresh token
```

### Recursos principales
```
GET  /api/v1/cameras            → Listado de cámaras
GET  /api/v1/servers            → Listado de servidores Frigate
GET  /api/v1/events             → Eventos (cursor-based pagination)
GET  /api/v1/recordings         → Listado de clips
GET  /api/v1/users              → Usuarios
GET  /api/v1/plugins           → Estado de plugins
```

### Plugins (ejemplos)
```
GET  /api/v1/plugins/ai_summary/queue-status
GET  /api/v1/plugins/semantic_search/search?q=persona%20sospechosa
GET  /api/v1/plugins/loitering/zones
GET  /api/v1/plugins/face_recognition/faces
POST /api/v1/plugins/lpr/blacklist
```

### WebSocket
```
WS /api/v1/ws/events?token=<jwt>  → Stream de eventos en tiempo real
```

---

## Desarrollo

### Estructura del proyecto
```
OpenVMS/
├── backend/app/
│   ├── main.py              # FastAPI entrypoint
│   ├── api/v1/              # Routers REST
│   ├── models/              # SQLAlchemy ORM
│   ├── schemas/             # Pydantic schemas
│   ├── services/            # Lógica de negocio
│   └── plugins/              # Sistema de plugins
│       ├── base.py          # BasePlugin abstracto
│       ├── registry.py      # Registro dinámico
│       ├── builtin/         # Pluginsbuiltin (lpr, notifications)
│       └── enterprise/      # Plugins enterprise (13 plugins IA)
├── frontend/src/
│   ├── pages/               # Páginas React
│   ├── api/                 # Cliente Axios
│   ├── store/               # Zustand stores
│   └── hooks/               # React hooks
├── docker-compose.yml       # Stack producción
└── Makefile                 # Comandos
```

### Tests
```bash
make test                          # Todos los tests
docker compose exec backend pytest tests/test_plugins_analytics.py -v
docker compose exec backend pytest tests/test_plugins_ai.py -v
docker compose exec backend pytest tests/test_plugins_lpr.py -v
```

### Lint
```bash
make lint                         # ruff check
```

---

## Licencia

MIT License — ver [LICENSE](LICENSE)

---

**OpenVMS** es desarrollado y mantenido por el equipo de **OpenCCTV Community**. Para contribuir, ver [CONTRIBUTING.md](CONTRIBUTING.md).
