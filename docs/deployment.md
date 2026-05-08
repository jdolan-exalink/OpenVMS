# Guía de Despliegue — OpenCCTV

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Configuración base (sin GPU)](#2-configuración-base-sin-gpu)
3. [Con GPU NVIDIA](#3-con-gpu-nvidia)
4. [Con Coral TPU](#4-con-coral-tpu)
5. [Con NVIDIA + Coral juntos](#5-con-nvidia--coral-juntos)
6. [Configurar go2rtc / nginx para tu IP](#6-configurar-go2rtc--nginx-para-tu-ip)
7. [Integración con Frigate local](#7-integración-con-frigate-local)
8. [Integración con Frigate remoto](#8-integración-con-frigate-remoto)
9. [Multi-servidor (varios Frigates)](#9-multi-servidor-varios-frigates)
10. [Variables de entorno — referencia completa](#10-variables-de-entorno--referencia-completa)
11. [Comandos de operación](#11-comandos-de-operación)
12. [Primer arranque paso a paso](#12-primer-arranque-paso-a-paso)
13. [Resolución de problemas comunes](#13-resolución-de-problemas-comunes)

---

## 1. Requisitos previos

### Mínimos (CPU-only)

| Componente | Versión mínima |
|---|---|
| Docker Engine | 24+ |
| Docker Compose Plugin | 2.20+ |
| RAM | 8 GB |
| Disco (modelos ML + datos) | 20 GB |

### Con NVIDIA GPU

Además de lo anterior:

```bash
# Verificar driver NVIDIA instalado
nvidia-smi

# Instalar nvidia-container-toolkit
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### Con Google Coral PCIe/M.2

```bash
# Verificar que el dispositivo es visible
ls /dev/apex_0   # PCIe
ls /dev/apex_1   # segundo Coral (si aplica)

# Instalar runtime EdgeTPU
echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" \
  | sudo tee /etc/apt/sources.list.d/coral-edgetpu.list
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
sudo apt-get update && sudo apt-get install -y libedgetpu1-std
```

> **Coral USB** no requiere `/dev/apex_0` — se pasa como `/dev/bus/usb`.

---

## 2. Configuración base (sin GPU)

Este es el punto de partida. Funciona en cualquier servidor con CPU moderna.

### Paso 1 — Comentar dispositivos GPU y Coral en docker-compose.yml

```yaml
# docker-compose.yml — sección model-init y backend
# Comentar o eliminar los bloques deploy y devices:

  model-init:
    # deploy:           ← COMENTAR TODO EL BLOQUE
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
    # devices:          ← COMENTAR
    #   - /dev/apex_0:/dev/apex_0
    ...

  backend:
    # deploy:           ← IGUAL
    # devices:          ← IGUAL
    ...
```

O usar el override `docker-compose.cpu.yml` (crear si no existe):

```yaml
# docker-compose.cpu.yml
services:
  model-init:
    deploy: {}
    devices: []
  backend:
    deploy: {}
    devices: []
```

Arrancar con:
```bash
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d
```

### Paso 2 — .env mínimo

```env
POSTGRES_PASSWORD=una_clave_segura
SECRET_KEY=genera_con_python_secrets_token_hex_32
OME_WEBRTC_BASE=ws://IP_DEL_SERVIDOR:3333
OME_LLHLS_BASE=http://IP_DEL_SERVIDOR:3334
```

Generar SECRET_KEY:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## 3. Con GPU NVIDIA

El backend y el inicializador de modelos reciben la GPU automáticamente si `nvidia-container-toolkit` está instalado y los bloques `deploy` están presentes en `docker-compose.yml`.

**El `docker-compose.yml` base ya incluye los bloques GPU.** Solo necesitas asegurarte de:

1. `nvidia-container-toolkit` instalado (ver sección 1)
2. Los bloques `deploy` **no** están comentados

Verificación:
```bash
docker compose run --rm backend nvidia-smi
```

### Variables relevantes para plugins con GPU

```env
# En .env — los plugins las leen automáticamente
# No se requiere configuración extra para NVIDIA.
# Los plugins que usan GPU (face_recognition, lpr_advanced, etc.)
# tienen la opción use_gpu: true en su configuración JSON.
```

### docker-compose.local.yml — producción con NVIDIA

El archivo `docker-compose.local.yml` ya tiene los tres nodos de dispositivo NVIDIA:

```yaml
devices:
  - /dev/nvidia0:/dev/nvidia0
  - /dev/nvidiactl:/dev/nvidiactl
  - /dev/nvidia-uvm:/dev/nvidia-uvm
```

Arrancar con:
```bash
make up-local
# equivale a:
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

---

## 4. Con Coral TPU

El `docker-compose.yml` base mapea `/dev/apex_0` para ambos servicios (`model-init` y `backend`).

### Si tienes Coral (no hacer nada)

El bloque ya está activo:
```yaml
devices:
  - /dev/apex_0:/dev/apex_0
```

### Si NO tienes Coral

Comentar o eliminar las líneas `devices` en `model-init` y `backend`:

```yaml
# devices:
#   - /dev/apex_0:/dev/apex_0
```

O usar `docker-compose.cpu.yml` como se explicó arriba.

### Coral USB

```yaml
devices:
  - /dev/bus/usb:/dev/bus/usb
```

Requiere además `privileged: true` o reglas udev adecuadas.

---

## 5. Con NVIDIA + Coral juntos

Mantener ambos bloques activos en `docker-compose.yml` o en tu override:

```yaml
services:
  backend:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    devices:
      - /dev/apex_0:/dev/apex_0
      - /dev/nvidia0:/dev/nvidia0
      - /dev/nvidiactl:/dev/nvidiactl
      - /dev/nvidia-uvm:/dev/nvidia-uvm
```

Los plugins eligen el acelerador vía su configuración JSON. Ejemplo para LPR avanzado:

```json
{
  "use_gpu": true,
  "use_coral": false,
  "ocr_use_gpu": true
}
```

---

## 6. Configurar go2rtc / nginx para tu IP

> **IMPORTANTE:** El archivo `frontend/nginx.conf` tiene hardcodeada la IP `10.1.1.252:1984`
> que corresponde al servidor go2rtc de una instalación específica.
> **Debes cambiarla** por la IP o hostname donde corre go2rtc en tu entorno.

### ¿Qué es go2rtc en este contexto?

Frigate 0.13+ incluye go2rtc internamente. Expone:
- Puerto `1984` — interfaz web y API WebSocket/WebRTC
- Página `/stream.html?src=<nombre>` — reproductor embebible (iframe)

El frontend de OpenCCTV embebe esa página como `<iframe>` para mostrar cada cámara.

### Encontrar la IP de tu go2rtc

```bash
# Si Frigate corre en la misma máquina
hostname -I | awk '{print $1}'

# Si Frigate corre en otro servidor
# Usa la IP LAN o dominio de ese servidor
```

### Editar nginx.conf

```bash
# frontend/nginx.conf — reemplazar 10.1.1.252 por tu IP
sed -i 's/10.1.1.252/<TU_IP>/g' frontend/nginx.conf
```

O editarlo manualmente:

```nginx
# Antes:
location /stream.html {
    proxy_pass http://10.1.1.252:1984;
    ...
}
location /api/ws {
    proxy_pass http://10.1.1.252:1984/api/ws;
    ...
}
location /api/webrtc {
    proxy_pass http://10.1.1.252:1984;
    ...
}
location /go2rtc/ {
    proxy_pass http://10.1.1.252:5000/;
    ...
}

# Después (ejemplo):
location /stream.html {
    proxy_pass http://192.168.1.100:1984;
    ...
}
# etc.
```

### Hacer la IP configurable vía variable de entorno (recomendado para multi-entorno)

Crear `frontend/nginx.conf.template`:

```nginx
location /stream.html {
    proxy_pass http://${GO2RTC_HOST}:${GO2RTC_PORT};
    ...
}
```

Y en el Dockerfile del frontend usar `envsubst`. Por ahora, la forma más simple es editar el archivo antes del `docker compose build`.

### Si go2rtc corre en Docker en la misma red

Si tienes Frigate como servicio en el mismo `docker-compose.yml`:

```yaml
services:
  frigate:
    image: ghcr.io/blakeblackshear/frigate:stable
    ...
```

Puedes usar el nombre del servicio:

```nginx
location /stream.html {
    proxy_pass http://frigate:1984;
    ...
}
```

Y agregar Frigate a la misma red Docker:

```yaml
networks:
  default:
    name: opencctv_net
```

---

## 7. Integración con Frigate local

"Local" significa que Frigate está en la misma red Docker o en el mismo host físico.

### Frigate en Docker en el mismo host

```yaml
# docker-compose.yml — agregar servicio Frigate
services:
  frigate:
    image: ghcr.io/blakeblackshear/frigate:stable
    container_name: frigate
    privileged: true
    volumes:
      - /path/to/frigate/config:/config
      - /mnt/cctv:/media/frigate
      - /dev/shm:/dev/shm
    ports:
      - "5000:5000"   # API sin auth (interna)
      - "8971:8971"   # API con auth (externa)
      - "1984:1984"   # go2rtc
      - "8554:8554"   # RTSP
      - "8555:8555/tcp"
      - "8555:8555/udp"
    environment:
      FRIGATE_RTSP_PASSWORD: "tu_password"
    networks:
      - default
```

### Registrar el servidor Frigate en OpenCCTV

Vía API (después de que el backend está corriendo):

```bash
curl -X POST http://localhost:8080/api/v1/servers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Servidor Principal",
    "url": "http://frigate:5000",
    "rtsp_base": "rtsp://frigate:8554",
    "mqtt_host": "mqtt",
    "mqtt_port": 1883
  }'
```

O desde la interfaz web en **Settings → Servers → Add Server**.

### Campos clave al registrar un servidor

| Campo | Descripción | Ejemplo local |
|---|---|---|
| `url` | URL de la API de Frigate | `http://frigate:5000` |
| `rtsp_base` | Base RTSP para streams | `rtsp://frigate:8554` |
| `mqtt_host` | Broker MQTT | `mqtt` (nombre servicio Docker) |
| `mqtt_port` | Puerto MQTT | `1883` |
| `api_key` | Vacío para puerto 5000 (sin auth) | `` |

### Sincronización automática de cámaras

Una vez registrado el servidor, OpenCCTV llama a `GET /api/cameras` de Frigate y sincroniza todas las cámaras automáticamente. También puede hacerse manualmente:

```bash
curl -X POST http://localhost:8080/api/v1/servers/{server_id}/sync \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 8. Integración con Frigate remoto

"Remoto" significa un Frigate en otro servidor (otra máquina, otra red LAN, VPN, etc.).

### Diferencias respecto a local

| | Local (puerto 5000) | Remoto (puerto 8971) |
|---|---|---|
| Autenticación | Sin auth | JWT via cookie `frigate_token` |
| Campo `api_key` | Vacío | `username:password` |
| URL | `http://host:5000` | `http://host:8971` |
| Seguridad | Solo red interna | Recomendado HTTPS |

### Registrar servidor remoto

```bash
curl -X POST http://localhost:8080/api/v1/servers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Sucursal Norte",
    "url": "http://192.168.50.10:8971",
    "rtsp_base": "rtsp://192.168.50.10:8554",
    "mqtt_host": "192.168.50.10",
    "mqtt_port": 1883,
    "api_key": "admin:mi_password_frigate"
  }'
```

El backend detecta que el puerto es 8971 (o que `api_key` está definido) y usa autenticación JWT automáticamente.

### MQTT remoto

Para que los eventos lleguen, el broker MQTT del Frigate remoto debe ser accesible. Opciones:

**Opción A — Usar el broker de Frigate**
```json
{
  "mqtt_host": "192.168.50.10",
  "mqtt_port": 1883
}
```

**Opción B — Frigate publica al broker central de OpenCCTV**

En la configuración de Frigate remoto (`config.yml`):
```yaml
mqtt:
  host: IP_SERVIDOR_OPENCCTV
  port: 1883
  topic_prefix: frigate/sucursal-norte
```

Y en el servidor registrado en OpenCCTV:
```json
{
  "mqtt_host": "mqtt",
  "mqtt_port": 1883,
  "mqtt_topic_prefix": "frigate/sucursal-norte"
}
```

### go2rtc remoto

Para LiveView con un Frigate remoto, el nginx del frontend también necesita apuntar al go2rtc de ese servidor. Si tienes múltiples Frigates remotos, necesitas una entrada nginx por cada uno o usar un proxy dinámico.

Solución simple con un Frigate remoto:
```nginx
# En nginx.conf — apuntar go2rtc al servidor remoto
location /stream.html {
    proxy_pass http://192.168.50.10:1984;
}
location /api/ws {
    proxy_pass http://192.168.50.10:1984/api/ws;
    ...
}
```

---

## 9. Multi-servidor (varios Frigates)

OpenCCTV admite múltiples servidores Frigate simultáneamente. Cada servidor tiene su propio cliente HTTP, consumidor MQTT y conjunto de cámaras.

### Limitación actual de go2rtc

El nginx del frontend actualmente tiene una única entrada para go2rtc. Si tienes cámaras de múltiples servidores Frigate, los streams de todos deben ser accesibles desde el mismo endpoint go2rtc, o debes usar un go2rtc centralizado.

### go2rtc centralizado (solución multi-servidor)

Opción: correr un go2rtc independiente que agregue todos los streams:

```yaml
# docker-compose.yml
services:
  go2rtc:
    image: alexxit/go2rtc:latest
    ports:
      - "1984:1984"
    volumes:
      - ./go2rtc.yaml:/config/go2rtc.yaml
    network_mode: host
```

Archivo `go2rtc.yaml`:
```yaml
streams:
  # Servidor 1 — local
  camara_entrada_main:
    - rtsp://frigate-local:8554/camara_entrada
  camara_entrada_sub:
    - rtsp://frigate-local:8554/camara_entrada_sub
  # Servidor 2 — remoto
  camara_almacen_main:
    - rtsp://192.168.50.10:8554/camara_almacen
  camara_almacen_sub:
    - rtsp://192.168.50.10:8554/camara_almacen_sub
```

### Nomenclatura de streams

OpenCCTV nombra cada stream como `{frigate_name}_{main|sub}`. El valor `frigate_name` es exactamente como Frigate llama a la cámara (el key en `cameras:` de la config de Frigate).

Por lo tanto en go2rtc, los streams deben tener esos mismos nombres.

### Registrar múltiples servidores

```bash
# Servidor 1
curl -X POST .../api/v1/servers -d '{"display_name":"Central","url":"http://frigate-1:5000",...}'

# Servidor 2
curl -X POST .../api/v1/servers -d '{"display_name":"Sucursal","url":"http://192.168.2.10:8971","api_key":"admin:pass",...}'
```

Cada servidor se sincroniza independientemente. En LiveView, cada cámara muestra un chip de color según su servidor de origen.

---

## 10. Variables de entorno — referencia completa

Copiar `.env.example` a `.env` y ajustar:

```env
# ── PostgreSQL ────────────────────────────────────────────────────────────────
POSTGRES_DB=opencctv
POSTGRES_USER=opencctv
POSTGRES_PASSWORD=<OBLIGATORIO — clave fuerte>

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generar: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=<OBLIGATORIO>

# ── OvenMediaEngine ───────────────────────────────────────────────────────────
# Reemplazar con la IP pública o LAN del servidor donde corre OME.
# OME usa network_mode: host, por lo que escucha en la IP del host.
OME_WEBRTC_BASE=ws://<IP_SERVIDOR>:3333
OME_LLHLS_BASE=http://<IP_SERVIDOR>:3334

# ── CORS ─────────────────────────────────────────────────────────────────────
# Agregar todos los orígenes desde los que se accede al frontend.
CORS_ORIGINS=["http://localhost:3000","http://<IP_SERVIDOR>:3000"]

# ── Admin por defecto ─────────────────────────────────────────────────────────
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<cambiar antes del primer arranque>

# ── Modelos ML ────────────────────────────────────────────────────────────────
SKIP_MODEL_DOWNLOAD=0    # 1 = saltar descarga (si ya están en /models)
FORCE_MODEL_DOWNLOAD=0   # 1 = forzar re-descarga aunque existan

# ── Puertos opcionales ────────────────────────────────────────────────────────
# BACKEND_PORT=8080
# FRONTEND_PORT=3000
# MQTT_PORT=1883
```

---

## 11. Comandos de operación

```bash
# Arranque
make up              # Producción estándar
make up-local        # Producción con GPU NVIDIA + rutas locales
make dev             # Desarrollo con hot-reload

# Estado
make logs            # Todos los logs en tiempo real
make logs-backend    # Solo backend (200 últimas líneas)

# Mantenimiento
make build           # Reconstruir imágenes (después de cambios en código)
make migrate         # Ejecutar migraciones Alembic
make seed            # Insertar datos de prueba

# Modelos ML
make models          # Descargar modelos (si no existen)
make models-force    # Forzar re-descarga de modelos

# Acceso a contenedores
make shell-backend   # Shell en el contenedor backend
make shell-db        # psql en PostgreSQL

# Pruebas y calidad
make test            # pytest
make lint            # ruff check

# Parar
make down            # Parar y eliminar contenedores (datos persisten en volúmenes)
```

---

## 12. Primer arranque paso a paso

```bash
# 1. Clonar repositorio
git clone <repo> OpenVMS
cd OpenVMS

# 2. Configurar entorno
cp .env.example .env
# Editar .env: cambiar POSTGRES_PASSWORD, SECRET_KEY, OME_WEBRTC_BASE, etc.

# 3. Ajustar nginx.conf con la IP de go2rtc
# Ver sección 6 — CRÍTICO para que LiveView funcione
nano frontend/nginx.conf
# Reemplazar 10.1.1.252 por la IP de tu servidor go2rtc

# 4. Comentar GPU/Coral si no tienes esos dispositivos
# Ver secciones 2, 3, 4 según tu hardware

# 5. Arrancar
make up

# 6. Esperar que model-init termine (puede tardar 5-15 min en primera descarga)
make logs  # Seguir el progreso

# 7. Acceder
# Frontend:  http://localhost:3000  (o la IP del servidor)
# API docs:  http://localhost:8080/api/docs
# Login: admin / admin123 (cambiar en .env antes de producción)

# 8. Registrar un servidor Frigate
# Ir a Settings → Servers → Add Server
# O usar la API como se documenta en la sección 7/8

# 9. Sincronizar cámaras
# Automático al registrar el servidor
# O: Settings → Servers → Sync
```

---

## 13. Resolución de problemas comunes

### Las cámaras no aparecen en LiveView

1. Verificar que el servidor Frigate está registrado y activo: `GET /api/v1/servers`
2. Verificar sincronización de cámaras: `GET /api/v1/cameras`
3. Revisar logs del backend: `make logs-backend` — buscar errores de conexión a Frigate

### LiveView muestra "offline" o pantalla de barras de color

Ver documento [`liveview.md`](liveview.md) — sección Diagnóstico.

Pasos rápidos:
1. Abrir `http://<IP>:1984/stream.html?src=<nombre_camara>_sub` directamente en el navegador
2. Si carga: el problema es en el proxy nginx → revisar `frontend/nginx.conf`
3. Si no carga: el problema es en go2rtc → verificar que la cámara existe en go2rtc

### Backend no arranca (error de migración)

```bash
make shell-backend
alembic upgrade head
```

### model-init falla con error de dispositivo

```
Error: no such device /dev/apex_0
```

Comentar el bloque `devices` en `docker-compose.yml` (ver sección 2).

### MQTT no recibe eventos

1. Verificar que el broker MQTT es accesible: `mqtt_host` y `mqtt_port` del servidor registrado
2. Confirmar que Frigate publica al broker: los topics esperados son `frigate/events` o `frigate/{camera}/events`
3. Revisar logs: `make logs-backend` — buscar `MQTTService`

### OvenMediaEngine no transmite

OME usa `network_mode: host`. En algunos sistemas Docker esto requiere configuración adicional:
1. Verificar que los puertos 3333, 3334 y 10000-10009 UDP están abiertos en el firewall del host
2. Revisar que `OME_WEBRTC_BASE` en `.env` usa la IP real del host (no `localhost` si el frontend está en otro host)
