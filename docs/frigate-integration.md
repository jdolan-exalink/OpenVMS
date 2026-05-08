# Integración con Frigate

## Índice

1. [Cómo OpenCCTV se conecta a Frigate](#1-cómo-opencctv-se-conecta-a-frigate)
2. [Modos de conexión: local vs remoto](#2-modos-de-conexión-local-vs-remoto)
3. [Flujo de eventos MQTT](#3-flujo-de-eventos-mqtt)
4. [Sincronización de cámaras](#4-sincronización-de-cámaras)
5. [Config de Frigate para OpenCCTV](#5-config-de-frigate-para-opencctv)
6. [Grabaciones y clips](#6-grabaciones-y-clips)
7. [PTZ](#7-ptz)
8. [Caché y rendimiento](#8-caché-y-rendimiento)

---

## 1. Cómo OpenCCTV se conecta a Frigate

OpenCCTV mantiene un pool de clientes HTTP hacia cada servidor Frigate registrado. La clase `FrigateClient` (`backend/app/services/frigate_service.py`) gestiona:

- Autenticación JWT (con cookie `frigate_token`)
- Reintentos automáticos en 401 (re-login transparente)
- Timeout de 10 segundos por petición
- Cache en Redis para respuestas frecuentes

---

## 2. Modos de conexión: local vs remoto

### Modo sin auth (puerto 5000)

Frigate expone una API sin autenticación en el puerto 5000. Usar cuando:
- Frigate está en la misma red Docker (mismo `docker-compose.yml` o misma red)
- Entorno de desarrollo

```json
{
  "url": "http://frigate:5000",
  "api_key": ""
}
```

### Modo con auth (puerto 8971)

Frigate expone una API con autenticación JWT en el puerto 8971. Usar cuando:
- Frigate está en otro servidor (red LAN, VPN, internet)
- Se requiere seguridad en la conexión

```json
{
  "url": "http://192.168.1.100:8971",
  "api_key": "admin:mi_password"
}
```

El campo `api_key` tiene el formato `username:password`. El backend hace login automáticamente y renueva el token cuando expira.

### Detección automática del modo

El `FrigateClient` activa auth si `api_key` contiene `:` (formato user:pass). No hay necesidad de especificar el puerto — se infiere de la URL.

---

## 3. Flujo de eventos MQTT

```
Cámara detecta objeto
      │
      ▼
Frigate publica en MQTT
  topics: frigate/events, frigate/{camera}/events
      │
      ▼
MQTTService (OpenCCTV)
  - Un consumer por servidor Frigate
  - Exponential backoff en reconexión (1s → 60s)
      │
      ▼
EventService.process_event()
  - Normaliza payload Frigate → modelo interno
  - Resuelve camera_id (frigate_name → UUID)
  - Guarda en PostgreSQL (tabla events)
      │
      ├──► WebSocket endpoint → Frontend EventStore → overlays en LiveView
      │
      └──► PluginRegistry.dispatch_event() → plugins activos
```

### Topics MQTT escuchados

```
frigate/events              # Eventos de todas las cámaras
frigate/+/events            # Alternativo: frigate/{camera}/events
frigate/stats               # Heartbeat de estadísticas del servidor
```

### Payload de un evento Frigate

```json
{
  "type": "new",            // "new", "update", "end"
  "before": { ... },        // Estado anterior del evento
  "after": {
    "id": "1234567890.123456-entrada",
    "camera": "entrada_principal",
    "label": "person",
    "sub_label": null,
    "score": 0.87,
    "top_score": 0.91,
    "start_time": 1714500000.0,
    "end_time": null,
    "has_snapshot": true,
    "has_clip": false,
    "zones": ["zona_entrada"],
    "thumbnail": "<base64>",
    "current_zones": ["zona_entrada"],
    "entered_zones": ["zona_entrada"],
    "attributes": {},
    "box": [100, 200, 300, 400]
  }
}
```

---

## 4. Sincronización de cámaras

### Proceso de sincronización

1. OpenCCTV llama `GET /api/cameras` en la API de Frigate
2. Compara con las cámaras existentes en la DB de OpenCCTV
3. Inserta cámaras nuevas, actualiza las existentes
4. Calcula URLs de stream: `{server_id}_{camera_name}` (ver [`liveview.md`](liveview.md))

### Activar sincronización

**Automática:** Ocurre al crear o actualizar un servidor Frigate en OpenCCTV.

**Manual:**
```bash
# API
curl -X POST http://localhost:8080/api/v1/servers/{server_id}/sync \
  -H "Authorization: Bearer <TOKEN>"

# UI: Settings → Servers → icono de sync
```

### Campos sincronizados desde Frigate

| Campo Frigate | Campo OpenCCTV | Descripción |
|---|---|---|
| `name` | `frigate_name` | Identificador único en Frigate |
| `name` | `name` (display) | Nombre legible (editable en OpenCCTV) |
| `enabled` | `enabled` | Si está grabando |
| `detect.enabled` | — | Si la detección está activa |
| configuración MQTT | — | Derivado del servidor |
| RTSP URL | `rtsp_url` | Construida desde `rtsp_base + camera_name` |

---

## 5. Config de Frigate para OpenCCTV

### Configuración mínima de Frigate

```yaml
# /config/config.yml en Frigate

mqtt:
  host: mqtt              # Usar broker de OpenCCTV (si está en la misma red)
  # host: 192.168.1.X    # O IP del servidor OpenCCTV (si es remoto)
  port: 1883
  topic_prefix: frigate

cameras:
  entrada_principal:      # nombre → frigate_name en OpenCCTV
    ffmpeg:
      inputs:
        - path: rtsp://usuario:pass@192.168.1.50/stream1
          roles:
            - detect
            - record
    detect:
      enabled: true
      width: 1280
      height: 720
      fps: 5
    record:
      enabled: true
      retain:
        days: 7
    snapshots:
      enabled: true
      retain:
        default: 10

# Opcional: substream para LiveView
# go2rtc se configura dentro de Frigate o en go2rtc.yaml separado
go2rtc:
  streams:
    entrada_principal:
      - rtsp://usuario:pass@192.168.1.50/stream1
    entrada_principal_sub:
      - rtsp://usuario:pass@192.168.1.50/stream2   # o usar transcodificación
```

### MQTT: Frigate publicando al broker de OpenCCTV

Si Frigate está en la misma red Docker:
```yaml
mqtt:
  host: mqtt    # nombre del servicio Docker de OpenCCTV
  port: 1883
```

Si Frigate está en otro servidor:
```yaml
mqtt:
  host: 192.168.1.200    # IP del servidor OpenCCTV
  port: 1883
```

El broker MQTT de OpenCCTV (`eclipse-mosquitto:2`) está configurado sin autenticación por defecto. Ver `mosquitto/mosquitto.conf` para añadir auth si se necesita.

### Múltiples cámaras con nombres únicos

Los `frigate_name` deben ser únicos **globalmente** en OpenCCTV (no solo por servidor). Si tienes dos Frigates con una cámara llamada `entrada`, deberás renombrarlas en Frigate:

```yaml
# Frigate 1 (central)
cameras:
  central_entrada:
    ...

# Frigate 2 (sucursal)
cameras:
  sucursal_entrada:
    ...
```

---

## 6. Grabaciones y clips

### Acceder a grabaciones

OpenCCTV consume la API de grabaciones de Frigate:

```
GET /api/v1/recordings?camera_id=<id>&start=<ts>&end=<ts>
```

Internamente llama a Frigate:
```
GET http://frigate:5000/api/events?camera=<frigate_name>&after=<ts>&before=<ts>
```

### Exportar clips

El `ExportService` usa FFmpeg para recortar clips:

```bash
# Frigate guarda en /media/frigate/recordings/
# OpenCCTV necesita acceso de lectura a esa ruta

# En docker-compose.local.yml:
volumes:
  - /mnt/cctv:/mnt/cctv:ro
```

La ruta de grabaciones se configura en el servidor:
```json
{
  "recordings_path": "/mnt/cctv"
}
```

### Thumbnails y snapshots

Los snapshots de Frigate están disponibles via:
```
GET http://frigate:5000/api/{event_id}/snapshot.jpg
```

OpenCCTV los proxea a través de su API:
```
GET /api/v1/events/{id}/snapshot
```

---

## 7. PTZ

Para cámaras con soporte PTZ en Frigate:

### Mover cámara

```bash
curl -X POST http://localhost:8080/api/v1/cameras/{camera_id}/ptz \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action": "move", "direction": "left", "speed": 1}'
```

Acciones disponibles: `move` (con `direction`: left, right, up, down), `zoom_in`, `zoom_out`, `stop`, `preset`.

### Presets PTZ

```bash
# Mover a preset
curl -X POST .../ptz -d '{"action": "preset", "preset": "1"}'
```

OpenCCTV delega directamente a la API PTZ de Frigate.

---

## 8. Caché y rendimiento

`FrigateService` cachea en Redis:

| Endpoint | TTL | Descripción |
|---|---|---|
| `GET /api/cameras` | 60 s | Lista de cámaras |
| `GET /api/config` | 30 s | Config completa de Frigate |
| `GET /api/config/schema` | 1 h | Esquema JSON de la config |

El caché se invalida automáticamente al realizar operaciones de escritura (actualizar config, sync).

### Múltiples servidores

Cada servidor tiene su propio `FrigateClient` con caché independiente. La clave de Redis incluye el `server_id`:

```
frigate:{server_id}:cameras
frigate:{server_id}:config
```
