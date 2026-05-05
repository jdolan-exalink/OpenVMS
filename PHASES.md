# OpenCCTV — Estado del proyecto y roadmap de fases

## Estado general verificado

Actualizado el 2026-05-04 tras implementar Fases 11-12 + páginas de plugins enterprise.

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Infraestructura base (directorios, Docker Compose, Makefile, .env) | ✅ Completa |
| 2 | Backend: modelos SQLAlchemy + migraciones Alembic | ✅ Completa |
| 3 | Backend: auth JWT + endpoints usuarios (login/refresh/me) | ✅ Completa |
| 4 | Backend: CRUD servidores Frigate + FrigateService + sync cámaras | ✅ Completa |
| 5 | Backend: FrigateConfigService + endpoints `/frigate-config/` | ✅ Completa |
| 6 | Backend: MQTTService + EventService | ✅ Completa |
| 7 | Backend: WebSocket events endpoint (Redis pub/sub) | ✅ Completa |
| 8 | Backend: Plugin system completo (registry + LPR + Notificaciones) | ✅ Completa |
| 9 | Backend: endpoints eventos + recordings + export + usuarios | ✅ Completa |
| 10 | Frontend: Layout + routing + auth (Login, Sidebar, Topbar) | ✅ Completa |
| 11 | Frontend: LiveView con reproductor MSE/WebRTC via go2rtc | ✅ Completa |
| 12 | Frontend: CameraWizard 5 pasos + api/frigateConfig.ts | ✅ Completa |
| 13 | Frontend: Página Eventos con WebSocket feed en tiempo real | ✅ Completa |
| 14 | Frontend: Playback con timeline + multi-cámara + exportación HLS | ✅ Completa |
| 15 | Frontend: Dashboard + Settings (servidores, cámaras, usuarios, plugins) | ✅ Completa |
| 16 | Tests de integración + documentación final | ⬜ Pendiente |

---

## Lo que tenemos hoy (post Fase 9)

### Infraestructura
- `docker-compose.yml` + `docker-compose.dev.yml` — stack completo (postgres, redis, mqtt, ome, backend, frontend).
- `.env.example` — variables documentadas.
- `Makefile` — comandos de stack, migración, test, lint, shells y backup.
- `ome/Server.xml` — OME con RTSP pull, WebRTC `:3333`, LL-HLS `:3334`, app `live`.
- `mosquitto/mosquitto.conf` — broker MQTT básico.
- `nginx/nginx.conf` — reverse proxy.

### Backend — implementado

#### Modelos SQLAlchemy (`backend/app/models/`)
- `frigate_server.py` — `FrigateServer` multi-nodo.
- `camera.py` — `Camera` sincronizada desde Frigate o creada en VMS.
- `user.py` — `User` + `CameraPermission`.
- `event.py` — `Event` normalizado desde MQTT.
- `audit_log.py` — `AuditLog` + `Plugin`.
- `frigate_config.py` — `FrigateConfigHistory`.

#### Migraciones Alembic
- `0001_initial_schema.py` — tablas base e índices.
- `0002_frigate_config_history.py` — historial de config Frigate.
- `0003_lpr_tables.py` — tablas `lpr_events` y `lpr_blacklist`.

#### Servicios (`backend/app/services/`)
- `auth_service.py` — bcrypt, JWT access/refresh, revocación con Redis.
- `frigate_service.py` — cliente Frigate dual port `5000/8971`, pool y cache Redis.
- `ome_service.py` — URLs de stream y selección de substream para grids grandes.
- `frigate_config_service.py` — gestión de config Frigate 0.17+, historial y go2rtc.
- `mqtt_service.py` — consumidores MQTT por servidor, topics Frigate y reconnect con backoff.
- `event_service.py` — parseo MQTT, upsert de eventos, publicación Redis y dispatch a plugins.
- `export_service.py` — jobs async de exportación con FFmpeg y estado en Redis.

#### API REST (`backend/app/api/v1/`)
- `auth.py` — login rate-limited, refresh, logout, me.
- `servers.py` — CRUD servidores, ping/status y sync cámaras.
- `cameras.py` — CRUD cámaras, stream URLs, snapshot proxy y PTZ.
- `frigate_config.py` — config, schema, historial, revert, go2rtc, cámaras, secciones globales, stats y versión.
- `events.py` — listado cursor-based, detalle, snapshot, clip y delete.
- `recordings.py` — listado de grabaciones y exportación async.
- `users.py` — CRUD usuarios y permisos por cámara.
- `plugins.py` — listado, detalle, enable/disable y configuración de plugins.
- `router.py` — registra todos los routers v1.

#### WebSocket
- `api/ws/events.py` — endpoint `/ws/events?token=...`.
- Autenticación por JWT en query param.
- Suscripción a Redis `vms:events`.
- Filtros por cámaras/servidores.
- Heartbeat ping/pong.

#### Plugins
- `plugins/base.py` — contrato `BasePlugin`.
- `plugins/registry.py` — discovery builtin/external, load/unload, rutas de plugin y dispatch de eventos.
- `plugins/builtin/lpr/` — historial de placas, búsqueda y blacklist.
- `plugins/builtin/notifications/` — reglas de alerta por Telegram o webhook con cooldown Redis.

#### Schemas
- `schemas/event.py` — `EventResponse`, `EventFilters`, `CursorPage`, encode/decode de cursor.
- `schemas/user.py`, `schemas/auth.py`, `schemas/camera.py`, `schemas/frigate_config.py` — contratos principales del backend.

### Frontend — Fase 10 implementada y conectada a datos reales

La Fase 10 ya dejó una app navegable con auth, layout y vistas principales sin datos demo. Estado real:

- Páginas implementadas: `Login`, `Dashboard`, `LiveView`, `Events`, `Playback` y `Settings`.
- Layout implementado: `Layout`, `Sidebar`, `Topbar`.
- Rutas privadas implementadas en `router.tsx`.
- Auth frontend implementado: `api/auth.ts`, `api/client.ts` con bearer/refresh, `store/authStore.ts`.
- API clients implementados: `api/cameras.ts`, `api/events.ts`, `api/servers.ts`.
- `Dashboard` consume servidores, cámaras y eventos reales.
- `Sidebar` y `Topbar` consumen servidores/cámaras reales; ya no muestran `SRV-A/SRV-B/SRV-C`.
- `LiveView` lista cámaras reales sincronizadas desde Frigate; falta conectar reproductor WebRTC/LL-HLS.
- `Events` lista eventos reales importados; si no hay historial muestra estado vacío real.
- `Playback` arma una línea de tiempo desde eventos reales; falta integrar recordings/export.
- `Settings` muestra servidores Frigate reales, paths de grabación/configuración y cámaras sincronizadas.
- Live view: `CameraCell`, `GridControls`, `LiveGrid`, `VideoPlayer` son stubs.
- Eventos: `EventCard`, `EventFeed`, `EventFilters`, `EventTimeline` son stubs.
- Playback: `PlaybackView`, `TimelineBar`, `ExportModal` son stubs.
- Settings: `ServerForm`, `CameraForm`, `UserManagement` son stubs.
- Stores pendientes: `cameraStore`, `eventStore` son stubs.
- Hooks: `useWebSocket`, `usePlayer`, `useEvents` son stubs.
- Falta `frontend/src/api/frigateConfig.ts`, requerido por la Fase 12.

### Tests y documentación
- `backend/tests/__init__.py` existe, pero no hay tests de integración implementados.
- No hay tests frontend.
- `docs/` contiene documentación base, pero falta cierre final alineado con Fases 10-16.

---

## Decisiones de diseño tomadas

### Frigate connection
- Puerto `5000` sin auth para servidores en la misma red Docker.
- Puerto `8971` para servidores externos con auth.
- `api_key` del modelo `FrigateServer` usa formato `"user:password"` para auth `8971`; vacío implica puerto `5000`.
- `/api/version` retorna texto plano (`.text.strip()`), no JSON.
- El endpoint correcto del schema es `/api/config/schema.json`.
- `PUT /api/config/set` reemplaza la config completa: siempre leer primero con `GET /api/config`.
- go2rtc streams se registran antes de agregar la cámara a la config.
- `ffmpeg.inputs` usan `rtsp://127.0.0.1:8554/{cam}` para restream local go2rtc.

### Cache Redis
- Cámaras: TTL 60s (`frigate_cameras:{server_id}`).
- Config completa: TTL 30s (`frigate_config:{server_id}`).
- JSON Schema: TTL 3600s (`frigate_schema:{server_id}`).
- Se invalida en cada escritura exitosa.

### OME stream naming
- Patrón: `{server_id}_{camera_name}` y `{server_id}_{camera_name}_sub`.
- Grid de 16 o más celdas usa substream automáticamente.

### Eventos en tiempo real
- Frigate MQTT se normaliza en `events`.
- `EventService` publica en Redis canal `vms:events`.
- WebSocket `/ws/events` reenvía eventos filtrados al frontend.
- Plugins reciben el mismo evento normalizado vía `plugin_registry.dispatch_event`.

---

## Fase 10 completada: Frontend base real

Objetivo cumplido: la estructura frontend ahora tiene autenticación, rutas privadas, layout persistente y datos reales del backend.

### Implementado
- `frontend/src/api/auth.ts` — login, logout y me.
- `frontend/src/api/client.ts` — token bearer y refresh automático en respuestas `401`.
- `frontend/src/store/authStore.ts` — tokens, usuario, persistencia, hydrate, login y logout.
- `frontend/src/router.tsx` — rutas privadas bajo `Layout`.
- `frontend/src/pages/Login.tsx` — formulario real con loading, error y redirección.
- `frontend/src/components/layout/Layout.tsx` — shell principal con sidebar/topbar y `Outlet`.
- `frontend/src/components/layout/Sidebar.tsx` — navegación desktop.
- `frontend/src/components/layout/Topbar.tsx` — usuario actual, navegación móvil y logout.
- `frontend/src/api/cameras.ts` — listado de cámaras real.
- `frontend/src/api/events.ts` — listado de eventos real.
- `frontend/src/api/servers.ts` — listado, status y sync de servidores Frigate.
- `frontend/src/pages/Dashboard.tsx` — resumen con servidores, cámaras, eventos recientes y métricas derivadas de datos reales.
- `frontend/src/pages/LiveView.tsx` — grilla de cámaras reales, sin nombres inventados.
- `frontend/src/pages/Events.tsx` — tabla de eventos reales, sin filas demo.
- `frontend/src/pages/Playback.tsx` — preview/timeline derivado de cámaras y eventos reales.
- `frontend/src/pages/Settings.tsx` — servidores, paths y cámaras reales.
- `frontend/.gitignore` — ignora `node_modules/`, `dist/` y `*.tsbuildinfo`.
- `frontend/postcss.config.js` — habilita Tailwind/PostCSS para que el CSS de la UI compile correctamente.
- `frontend/.dockerignore` — evita copiar artefactos locales al build Docker.

### Datos reales verificados en este host
- Frigate existente: `http://10.1.1.252:5000`.
- Grabaciones montadas: `/mnt/cctv`.
- Configuración montada: `/root/config`.
- Servidor OpenVMS: `frigate-local` (`Frigate Local`).
- Cámaras sincronizadas desde Frigate: `Baldio`, `Baldio_Fondo`, `Cochera`, `Ingreso`, `Pasillo`, `Patio`, `Patio_Luz`, `Portero`, `Portones`, `Quincho`.
- Login inicial: `admin / admin123`.
- Frontend desplegado: `http://10.1.1.252:3010/`.
- Backend docs: `http://10.1.1.252:8088/api/docs`.

### Verificado
- `npm run lint` pasa.
- `npm run build` pasa.
- `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build frontend` pasa.
- `curl -I -fsSL http://127.0.0.1:3010/` responde `200 OK`.
- `curl -I -fsSL http://127.0.0.1:8088/api/docs` responde `200 OK`.

---

## Próxima sesión — Fase 11: LiveView

### Implementar
- Extender `frontend/src/api/cameras.ts` — obtener URLs de stream.
- `frontend/src/store/cameraStore.ts` — cámaras, selección y layout de grid.
- `components/liveview/VideoPlayer.tsx` — reproductor WebRTC con fallback LL-HLS.
- `components/liveview/LiveGrid.tsx` — grid 1/4/9/16.
- `components/liveview/GridControls.tsx` — selección de layout y filtros.
- `components/liveview/CameraCell.tsx` — estado loading/error/offline y controles básicos.
- `pages/LiveView.tsx` — pantalla completa de monitoreo en vivo.

### Decisión pendiente
- El documento original menciona OvenPlayer, pero `package.json` no lo incluye. Antes de implementar, decidir si se agrega OvenPlayer, hls.js o un reproductor propio basado en HTML video/WebRTC.

---

## Fase 12: CameraWizard + FrigateConfigEditor

### Implementar
- Crear `frontend/src/api/frigateConfig.ts`.
- Crear componentes `frigate-config/` que hoy no existen.
- Wizard de 5 pasos: servidor, cámara, streams, detección/recording, revisión/aplicar.
- Editor de config con lectura de schema, edición, validación, historial y revert.

---

## Fase 13: Eventos frontend en tiempo real

### Implementar
- `frontend/src/api/events.ts` — list, detail, snapshot, clip, delete.
- `frontend/src/hooks/useWebSocket.ts` — conexión real a `/ws/events?token=...`.
- `frontend/src/hooks/useEvents.ts` — paginación cursor-based + merge de eventos WS.
- `frontend/src/store/eventStore.ts` — filtros, feed y selección.
- `components/events/*` — feed, cards, filtros y timeline.
- `pages/Events.tsx` — pantalla operativa con filtros y actualizaciones en vivo.

---

## Fase 14: Playback

### Implementar
- API client de recordings/export.
- Timeline por cámara y rango horario.
- Vista multi-cámara.
- Modal de exportación y polling de jobs.
- Descarga de export listo.

---

## Fase 15: Dashboard + Settings

### Implementar
- Dashboard con resumen de servidores, cámaras, eventos recientes y alertas.
- Settings de servidores Frigate.
- Settings de cámaras.
- Gestión de usuarios y permisos.
- Gestión de plugins, configuración LPR y reglas de notificación.

---

## Fase 16: Tests de integración + documentación final

### Backend
- Tests auth.
- Tests CRUD servidores/cámaras.
- Tests eventos con payload MQTT de Frigate.
- Tests WebSocket con Redis pub/sub.
- Tests recordings/export con mocks.
- Tests plugins LPR/notifications.

### Frontend
- Build y typecheck obligatorios.
- Tests de componentes críticos o E2E mínimo: login, navegación, live view, eventos y export.

### Documentación final
- Actualizar `docs/api.md` con endpoints Fases 6-15.
- Actualizar `docs/plugin-development.md` con rutas montadas y contrato de eventos.
- Agregar guía operativa de frontend y troubleshooting.

---

## Orden de ataque actualizado

| Sesión | Fases | Resultado tangible |
|--------|-------|-------------------|
| ✅ 1 | 1 | Stack levantable con `make up` |
| ✅ 2 | 2-3 | Login funcional, Swagger operativo |
| ✅ 3 | 4-5 | Agregar servidor Frigate, importar cámaras, gestión config vía API |
| ✅ 4 | 6-7 | Eventos MQTT en tiempo real vía WebSocket |
| ✅ 5 | 8-9 | Plugins LPR/notificaciones + endpoints eventos/recordings/usuarios |
| ✅ 6 | 10 | Frontend Login + Layout + rutas privadas |
| 7 | 11 | LiveView con video real |
| 8 | 12-13 | CameraWizard + Eventos en tiempo real |
| 9 | 14-15 | Playback + Dashboard + Settings completo |
| 10 | 16 | Tests de integración + docs finales |
