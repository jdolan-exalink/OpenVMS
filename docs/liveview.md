# LiveView — Cómo funciona y cómo configurarlo

## Índice

1. [Arquitectura del streaming en LiveView](#1-arquitectura-del-streaming-en-liveview)
2. [Flujo completo de un stream](#2-flujo-completo-de-un-stream)
3. [Nomenclatura de streams](#3-nomenclatura-de-streams)
4. [Cómo funciona el iframe de go2rtc](#4-cómo-funciona-el-iframe-de-go2rtc)
5. [Estado de conexión y auto-reconexión](#5-estado-de-conexión-y-auto-reconexión)
6. [Layouts disponibles](#6-layouts-disponibles)
7. [Substream vs main stream](#7-substream-vs-main-stream)
8. [Audio](#8-audio)
9. [Zoom y pan](#9-zoom-y-pan)
10. [Overlays en tiempo real](#10-overlays-en-tiempo-real)
11. [Arrastar y soltar cámaras](#11-arrastar-y-soltar-cámaras)
12. [Maximizar cámara](#12-maximizar-cámara)
13. [Requisitos en Frigate para ver cámaras](#13-requisitos-en-frigate-para-ver-cámaras)
14. [Diagnóstico](#14-diagnóstico)

---

## 1. Arquitectura del streaming en LiveView

```
Cámara IP (RTSP)
      │
      ▼
┌──────────────────┐
│  Frigate         │  ← Graba, detecta objetos
│  ┌────────────┐  │
│  │  go2rtc    │  │  ← Expone streams RTSP/WebRTC/MSE en :1984
│  └────────────┘  │
└──────────────────┘
      │ :1984/stream.html?src=<nombre>
      ▼
┌──────────────────┐
│  nginx (frontend)│  ← Proxy inverso: /stream.html → go2rtc:1984
│  puerto 3000     │     /api/ws → go2rtc:1984/api/ws  (MSE WebSocket)
└──────────────────┘     /api/webrtc → go2rtc:1984      (WebRTC signaling)
      │
      ▼
┌──────────────────┐
│  React LiveView  │  ← <iframe src="/stream.html?src=...&mode=mse">
│  frontend        │
└──────────────────┘
      │
      ▼
    Navegador — reproduce video vía MSE (Media Source Extensions)
```

**Protocolo principal: MSE (Media Source Extensions)**
- Baja latencia (~1-3 segundos)
- Compatible con todos los navegadores modernos
- Transmitido sobre WebSocket desde go2rtc

**Fallback: HLS (HTTP Live Streaming)**
- Mayor latencia (~5-10 segundos)
- Activado automáticamente por go2rtc si MSE no está disponible

---

## 2. Flujo completo de un stream

### Paso 1 — Frigate detecta la cámara

En tu `config.yml` de Frigate defines cada cámara:
```yaml
cameras:
  entrada_principal:           # ← este es el frigate_name
    ffmpeg:
      inputs:
        - path: rtsp://admin:pass@192.168.1.50/stream1
          roles:
            - detect
            - record
        - path: rtsp://admin:pass@192.168.1.50/stream2  # substream
          roles:
            - detect
```

### Paso 2 — go2rtc (dentro de Frigate) expone los streams

go2rtc toma el RTSP de la cámara y lo sirve como:
- `http://frigate-host:1984/stream.html?src=entrada_principal` — página web con player
- `ws://frigate-host:1984/api/ws?src=entrada_principal` — WebSocket MSE
- `http://frigate-host:1984/webrtc?src=entrada_principal` — WebRTC

### Paso 3 — nginx proxy

El nginx del frontend de OpenCCTV hace proxy de esas rutas:

```nginx
location /stream.html {
    proxy_pass http://<GO2RTC_HOST>:1984;
}
location /api/ws {
    proxy_pass http://<GO2RTC_HOST>:1984/api/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Esto permite que el navegador acceda a go2rtc a través del mismo dominio/puerto que el frontend (evita CORS).

### Paso 4 — React construye la URL del iframe

```typescript
// frontend/src/pages/LiveView.tsx
const streamUrl = `/stream.html?${new URLSearchParams({
  src: activeStream,    // ej: "entrada_principal_sub"
  mode: "mse",
  media: mediaMode,     // "video" o "video,audio"
}).toString()}`;

// Resultado: /stream.html?src=entrada_principal_sub&mode=mse&media=video
```

### Paso 5 — El iframe carga el player de go2rtc

El componente `<LiveStream>` renderiza:
```html
<iframe src="/stream.html?src=entrada_principal_sub&mode=mse&media=video" />
```

OpenCCTV inyecta CSS dentro del iframe para ocultar los controles nativos de go2rtc y hacer el video `100vw × 100vh`.

---

## 3. Nomenclatura de streams

El nombre del stream que usa OpenCCTV es **exactamente el `frigate_name` de la cámara** (como está en la base de datos, sincronizado desde Frigate).

| Modo | Nombre del stream |
|---|---|
| Maximizado (pantalla completa) | `{frigate_name}_main` |
| Preview en grid | `{frigate_name}_sub` |

**go2rtc debe tener streams con esos mismos nombres.**

Ejemplo:
- Frigate tiene cámara `entrada_principal`
- go2rtc debe tener stream `entrada_principal_main` y `entrada_principal_sub`

Frigate crea automáticamente estos streams si defines múltiples inputs en la config de la cámara. Si tu cámara solo tiene un stream, `_main` y `_sub` apuntan al mismo.

### Verificar streams disponibles en go2rtc

```bash
# Listar todos los streams registrados
curl http://<FRIGATE_HOST>:1984/api/streams

# Ver detalle de un stream
curl http://<FRIGATE_HOST>:1984/api/streams?src=entrada_principal_sub
```

---

## 4. Cómo funciona el iframe de go2rtc

### Por qué un iframe

go2rtc incluye un player web completo en `/stream.html`. Usar un iframe permite:
1. Reutilizar el player ya optimizado de go2rtc
2. No necesitar una librería de video adicional en el frontend
3. El estado del stream (conexión, buffer) es gestionado por go2rtc

### Patch de Chrome (limpieza visual)

OpenCCTV inyecta CSS dentro del iframe para eliminar la UI de go2rtc y adaptar el video:

```typescript
// LiveView.tsx — patchGo2rtcPlayerChrome()
style.textContent = `
  html, body { margin: 0 !important; overflow: hidden !important; background: #000 !important; }
  video, canvas { 
    display: block !important; 
    width: 100vw !important; 
    height: 100vh !important; 
    object-fit: cover !important; 
    pointer-events: none !important; 
  }
  /* Ocultar todos los controles nativos */
  [class*="control"], [class*="toolbar"], [class*="button"], button, 
  label, select { display: none !important; }
`;
```

### Detección del estado del player

```typescript
function getGo2rtcPlayerState(iframe) {
  const doc = iframe.contentDocument;
  const video = doc.querySelector("video");
  const mode = doc.querySelector(".mode")?.textContent;  // "MSE", "RTC", "HLS", etc.
  const error = doc.querySelector(".status")?.textContent;
  return { video, mode, error };
}
```

El componente lee estos valores cada 250ms durante la fase "connecting" para detectar cuándo el stream está activo.

---

## 5. Estado de conexión y auto-reconexión

Cada tile de cámara tiene una máquina de estados:

```
           ┌──────────────┐
  inicio → │  connecting  │ ← re-intento automático (30s)
           └──────┬───────┘
                  │ stream activo (video.readyState≥2, currentTime avanza)
                  ▼
           ┌──────────────┐
           │    online    │ ← monitor cada 3s (detecta pérdida de stream)
           └──────┬───────┘
                  │ video parado o sin dims
                  ▼
           ┌──────────────┐
           │   offline    │ → espera 30s → vuelve a connecting
           └──────────────┘
```

### Lógica de detección

**Fase connecting** (chequeando cada 250ms hasta 160 checks ≈ 40s):
1. Busca `<video>` en el iframe
2. Verifica `video.readyState >= 2` (tiene datos)
3. Verifica que `video.currentTime` avanza (stream vivo)
4. Si detecta modo MSE/RTC/HLS en `.mode` → online inmediatamente
5. Si llega a 160 checks sin éxito → offline

**Fase online** (monitor cada 3s):
1. Lee `video.readyState` y `video.videoWidth`
2. Si video no tiene dimensiones o está parado → vuelve a connecting

**Fase offline**:
1. Espera 30 segundos
2. Incrementa el counter `attempt` (fuerza re-mount del iframe con `key` nuevo)
3. Vuelve a connecting

---

## 6. Layouts disponibles

| ID | Label | Cámaras máx | Descripción |
|---|---|---|---|
| `g1` | 1×1 | 1 | Una sola cámara a pantalla completa |
| `g2x2` | 2×2 | 4 | Grid uniforme 4 cámaras |
| `g3x3` | 3×3 | 9 | Grid uniforme 9 cámaras (default) |
| `g4x4` | 4×4 | 16 | Grid uniforme 16 cámaras |
| `g5x5` | 5×5 | 25 | Grid uniforme 25 cámaras |
| `g6x6` | 6×6 | 36 | Grid uniforme 36 cámaras |
| `f1p3` | 1+3 | 4 | 1 cámara grande (izq.) + 3 pequeñas (der.) |
| `f1p5` | 1+5 | 6 | 1 cámara grande (sup. izq.) + 5 pequeñas |
| `f2p4` | 2+4 | 6 | 2 cámaras medianas (arriba) + 4 pequeñas (abajo) |
| `f1p9` | 1+9 | 10 | 1 cámara grande + 9 pequeñas |

El layout activo se persiste en `localStorage` con la clave `openvms.live.layout.v1`.

---

## 7. Substream vs main stream

OpenCCTV usa automáticamente streams diferentes según el contexto:

| Contexto | Stream usado | Lógica en código |
|---|---|---|
| Tiles en el grid | `{frigate_name}_sub` | `streamNameForMode(camera, "preview")` |
| Cámara maximizada | `{frigate_name}_main` | `streamNameForMode(camera, "maximized")` |

El substream (`_sub`) está pensado para ser de menor resolución (ej. 640×360) para reducir carga de CPU/GPU cuando se muestran muchas cámaras.

### Configurar substream en Frigate

```yaml
cameras:
  entrada_principal:
    ffmpeg:
      inputs:
        - path: rtsp://admin:pass@192.168.1.50/ch01/main    # main
          roles: [record, detect]
        - path: rtsp://admin:pass@192.168.1.50/ch01/sub     # substream
          roles: [detect]
      output_args:
        record: preset-record-generic-audio-copy
```

go2rtc dentro de Frigate expondrá automáticamente:
- `entrada_principal` — stream principal
- `entrada_principal_sub` — substream

Si la cámara IP no tiene substream nativo, go2rtc puede crear uno con transcodificación:

```yaml
# go2rtc.yaml o sección go2rtc en frigate config
streams:
  entrada_principal:
    - rtsp://admin:pass@192.168.1.50/ch01/main
  entrada_principal_sub:
    - "ffmpeg:entrada_principal#video=h264#hardware#width=640#height=360#fps=15"
```

---

## 8. Audio

El audio está desactivado por defecto para todas las cámaras en el grid.

### Activar audio

1. Click en el tile de la cámara (seleccionar)
2. Aparece el control de volumen en la esquina inferior izquierda
3. El slider controla el volumen (0-100%)

**Condición:** La cámara debe tener `has_audio: true` en la base de datos. Esto se sincroniza automáticamente desde la config de Frigate si la cámara tiene audio habilitado.

### Cómo funciona

```typescript
// LiveView.tsx
const mediaMode = camera.has_audio && audioPrimed ? "video,audio" : "video";
const streamUrl = `/stream.html?src=${activeStream}&mode=mse&media=${mediaMode}`;
```

- `audioPrimed` se activa la primera vez que el usuario hace click en la cámara
- El parámetro `media=video,audio` en la URL del stream le indica a go2rtc incluir audio
- El volumen se aplica directamente al `<video>` dentro del iframe

### Volumen persistido

El volumen de cada cámara se guarda en `localStorage` con la clave `openvms.live.cameraVolumes.v1`.

---

## 9. Zoom y pan

### Activar zoom

1. Click en el tile (seleccionar la cámara)
2. Scroll con la rueda del mouse dentro del tile
3. Rango: 1× (normal) a 5×

### Pan (mover la imagen)

Con zoom activo (>1×):
1. Click y arrastrar dentro del tile

### Comportamiento técnico

```typescript
// Zoom con rueda — clamped entre 1 y 5
const next = clamp(v.scale + dir * 0.2, 1, 5);

// Pan — limitado para no salir del tile
const mx = (rect.width * (view.scale - 1)) / 2;
const my = (rect.height * (view.scale - 1)) / 2;
```

El transform se aplica sobre el div contenedor del iframe:
```html
<div style="transform: translate(Xpx, Ypx) scale(S)">
  <iframe ... />
</div>
```

**Nota:** El drag & drop de reordenamiento está desactivado cuando el zoom es >1×.

---

## 10. Overlays en tiempo real

### Detección activa

Icono en la esquina superior derecha del tile cuando hay una detección reciente:
- Tipo de objeto (persona, vehículo, etc.)
- Color específico por tipo
- Datos desde el EventStore (WebSocket)

### Indicador de grabación

Chip rojo "●" cuando la cámara tiene `enabled: true` (grabando en Frigate).

### Chip de servidor

Esquina superior izquierda: chip de color identifica el servidor Frigate de origen.
- Servidor 0 → color A (azul)
- Servidor 1 → color B (verde)
- Servidor 2 → color C (naranja)

### Overlay de objeto abandonado

Cuando el plugin `abandoned_object` emite una alerta para esa cámara (en los últimos 2 minutos):
- Bounding box sobre el objeto
- Cuadro de estado en la esquina inferior derecha
- Color según severidad: rojo (confirmado), naranja (pendiente), amarillo (sospechoso), verde (resuelto)

---

## 11. Arrastar y soltar cámaras

Las cámaras en el grid pueden reorganizarse con drag & drop HTML5.

### Cómo hacerlo

1. Click y arrastrar un tile hacia otro
2. Los tiles se intercambian al soltar

### Persistencia

El orden se guarda en `localStorage` con la clave `openvms.live.cameraOrder.v1`.

Al agregar nuevas cámaras (sincronización con Frigate), se añaden al final del orden existente.

---

## 12. Maximizar cámara

- Doble click en cualquier tile → abre la cámara en pantalla completa (overlay)
- Tecla `Escape` o doble click en la cámara maximizada → cierra
- La cámara maximizada usa el stream `_main` (mayor resolución)
- Zoom y pan también disponibles en modo maximizado

---

## 13. Requisitos en Frigate para ver cámaras

Para que una cámara aparezca en LiveView de OpenCCTV:

### 1. Cámara definida en Frigate config

```yaml
cameras:
  mi_camara:                    # ← este nombre es el frigate_name
    ffmpeg:
      inputs:
        - path: rtsp://...
          roles: [detect, record]
```

### 2. Servidor Frigate registrado en OpenCCTV

Ir a Settings → Servers → Add Server (ver [`deployment.md`](deployment.md) secciones 7 y 8).

### 3. Cámaras sincronizadas

La sincronización ocurre automáticamente al registrar el servidor. También manual:
```bash
# Via API
curl -X POST http://localhost:8080/api/v1/servers/{id}/sync \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Streams accesibles en go2rtc

El nginx del frontend debe poder alcanzar go2rtc:
```bash
# Test desde el contenedor frontend
docker compose exec frontend curl http://<GO2RTC_HOST>:1984/api/streams
```

### 5. nginx apuntando al go2rtc correcto

Verificar `frontend/nginx.conf` — la IP en las rutas `/stream.html`, `/api/ws`, `/api/webrtc`.

**Esta es la causa más común de que las cámaras no carguen.**

---

## 14. Diagnóstico

### Cámara muestra barras de color (estado: connecting)

La pantalla de barras de color indica que el stream aún no está activo. Pasos:

**1. Verificar que go2rtc tiene el stream**
```bash
# Abrir directamente en el navegador
http://<GO2RTC_HOST>:1984/stream.html?src=<frigate_name>_sub
```

Si carga → go2rtc funciona, el problema está en el proxy nginx.
Si no carga → el problema está en go2rtc o en Frigate.

**2. Verificar el proxy nginx**
```bash
# Desde el navegador donde usas OpenCCTV
http://<OPENCCTV_HOST>:3000/stream.html?src=<frigate_name>_sub
```

**3. Ver logs del contenedor frontend (nginx)**
```bash
docker compose logs frontend -f
```

Buscar errores 502 (bad gateway) al cargar `/stream.html`.

**4. Listar streams disponibles en go2rtc**
```bash
curl http://<GO2RTC_HOST>:1984/api/streams
```

La respuesta muestra todos los streams activos. El `frigate_name` de la cámara debe aparecer en la lista.

**5. Verificar nombre del stream**

El nombre que usa OpenCCTV es:
```
{frigate_name}_sub    → para tiles en el grid
{frigate_name}_main   → para cámara maximizada
```

Donde `frigate_name` es el nombre de la cámara en Frigate. Verificar:
```bash
curl http://localhost:8080/api/v1/cameras \
  -H "Authorization: Bearer <TOKEN>"
```
Ver el campo `frigate_name` de cada cámara.

### Cámara muestra "offline — reintento automático"

El stream fue detectado como muerto. Se reintenta en 30 segundos automáticamente.

Si persiste:
1. Verificar que la cámara IP está accesible desde el servidor de Frigate
2. Verificar el stream RTSP: `ffplay rtsp://...` desde el servidor Frigate
3. Revisar logs de Frigate

### Audio no funciona

1. Verificar que la cámara tiene `has_audio: true`:
   ```bash
   curl http://localhost:8080/api/v1/cameras/<id>
   ```
2. Si es `false`, habilitar audio en Frigate config y re-sincronizar
3. Verificar que el navegador permite autoplay de audio (puede requerir interacción del usuario)

### Zoom no funciona

El zoom requiere que la cámara esté **seleccionada** (click previo en el tile).

### Drag & drop no funciona

El drag está desactivado cuando el zoom es >1×. Resetear zoom a 1× primero (scroll hacia abajo).
