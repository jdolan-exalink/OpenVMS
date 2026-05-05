# OpenVMS — Plugins Enterprise
> Guía de desarrollo de módulos de análisis avanzado
> Versión 1.0 | Para Claude Code

---

## Índice

1. [Arquitectura del sistema de plugins](#1-arquitectura-del-sistema-de-plugins)
2. [Clase base y contratos](#2-clase-base-y-contratos)
3. [Pipeline de inferencia compartido](#3-pipeline-de-inferencia-compartido)
4. [Plugin: LPR Avanzado](#4-plugin-lpr-avanzado)
5. [Plugin: Reconocimiento Facial](#5-plugin-reconocimiento-facial)
6. [Plugin: Merodeo](#6-plugin-merodeo)
7. [Plugin: Cruce de Línea](#7-plugin-cruce-de-línea)
8. [Plugin: Conteo de Personas y Vehículos](#8-plugin-conteo-de-personas-y-vehículos)
9. [Plugin: Objeto Abandonado](#9-plugin-objeto-abandonado)
10. [Plugin: EPP — Casco y Chaleco](#10-plugin-epp--casco-y-chaleco)
11. [Plugin: Detección de Caídas](#11-plugin-detección-de-caídas)
12. [Plugin: Humo y Fuego](#12-plugin-humo-y-fuego)
13. [Plugin: Sabotaje de Cámara](#13-plugin-sabotaje-de-cámara)
14. [Plugin: OCR General](#14-plugin-ocr-general)
15. [Plugin: Búsqueda Semántica](#15-plugin-búsqueda-semántica)
16. [Plugin: Resumen IA de Eventos](#16-plugin-resumen-ia-de-eventos)
17. [Infraestructura compartida y Docker](#17-infraestructura-compartida-y-docker)
18. [Tabla de requerimientos de hardware](#18-tabla-de-requerimientos-de-hardware)
19. [Orden de implementación sugerido](#19-orden-de-implementación-sugerido)

---

## 1. Arquitectura del sistema de plugins

### Principio general

Cada plugin enterprise es un módulo Python independiente que:

- Hereda de `BasePlugin` (definido en el core de OpenCCTV)
- Recibe eventos normalizados de Frigate vía el `PluginRegistry`
- Puede registrar sus propias rutas FastAPI bajo `/api/v1/plugins/{name}/`
- Puede acceder a frames de video en crudo vía el `FrameBuffer` compartido
- Persiste sus datos en tablas PostgreSQL propias (migración Alembic propia por plugin)
- Expone configuración editable desde la UI mediante JSON Schema

### Dos modos de operación

```
Modo A — Event-driven (la mayoría de plugins)
  Frigate detecta objeto
      ↓
  MQTT evento → Backend VMS
      ↓
  PluginRegistry.dispatch_event(event)
      ↓
  Plugin recibe evento + snapshot
      ↓
  Plugin ejecuta inferencia adicional sobre el snapshot
      ↓
  Plugin escribe resultado en su tabla PostgreSQL
      ↓
  Plugin publica alerta vía WebSocket si corresponde

Modo B — Frame-driven (plugins que necesitan análisis continuo)
  go2rtc RTSP restream → FrameBuffer (Redis Streams)
      ↓
  Plugin suscribe al FrameBuffer de las cámaras configuradas
      ↓
  Plugin procesa frames a su propio FPS (independiente de Frigate)
      ↓
  Plugin emite eventos propios al sistema
      ↓
  WebSocket → Frontend
```

### Cuándo usar cada modo

| Modo | Usar cuando |
|------|-------------|
| Event-driven | El análisis puede hacerse sobre el snapshot del evento (LPR, facial, OCR, EPP) |
| Frame-driven | Se necesita análisis temporal o continuo (merodeo, cruce de línea, caídas, humo/fuego, sabotaje) |

### Estructura de directorios

```
backend/app/plugins/
├── base.py                    ← clase base (ya definida en el core)
├── registry.py               ← registry (ya definido en el core)
├── shared/
│   ├── frame_buffer.py       ← acceso a frames via Redis Streams
│   ├── inference_engine.py   ← abstracción YOLO / ONNX / OpenVINO
│   ├── tracker.py            ← ByteTrack compartido
│   ├── model_manager.py      ← descarga y caché de modelos
│   └── alert_service.py      ← envío de alertas unificado
│
└── enterprise/
    ├── lpr/
    │   ├── __init__.py
    │   ├── plugin.json
    │   ├── plugin.py
    │   ├── paddle_ocr_client.py
    │   ├── migrations/
    │   └── models/            ← modelos YOLO placa + PaddleOCR
    ├── face_recognition/
    ├── loitering/
    ├── line_crossing/
    ├── people_counting/
    ├── abandoned_object/
    ├── ppe_detection/
    ├── fall_detection/
    ├── fire_smoke/
    ├── camera_sabotage/
    ├── ocr_general/
    ├── semantic_search/
    └── ai_summary/
```

---

## 2. Clase base y contratos

### BasePlugin extendida para plugins enterprise

```python
# backend/app/plugins/base.py
# (ampliar la clase base existente del core con los nuevos hooks)

from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator
from fastapi import APIRouter
import asyncio

class BasePlugin(ABC):
    """
    Clase base para todos los plugins de OpenCCTV.
    Los plugins enterprise implementan además on_frame() para análisis continuo.
    """
    name: str
    version: str
    description: str
    author: str = "OpenCCTV Community"
    requires_gpu: bool = False          # documenta si necesita GPU
    supports_openvino: bool = False     # puede correr con OpenVINO (sin NVIDIA)
    min_ram_gb: int = 8                 # RAM mínima recomendada

    @abstractmethod
    async def on_load(self, config: dict) -> None:
        """
        Inicialización del plugin.
        Cargar modelos, conectar a servicios externos, crear tablas si no existen.
        """

    @abstractmethod
    async def on_event(self, event: dict) -> None:
        """
        Llamado por cada evento Frigate normalizado.

        event garantiza los siguientes campos:
        {
          "id": int,                      # ID en tabla events de VMS
          "frigate_event_id": str,
          "server_id": str,               # UUID del servidor Frigate
          "camera_id": str,               # UUID de la cámara en VMS
          "camera_name": str,             # nombre en Frigate (ej: "entrada_principal")
          "label": str,                   # "person", "car", etc.
          "sub_label": str | None,
          "score": float,
          "start_time": float,            # unix timestamp
          "end_time": float | None,
          "zones": list[str],
          "has_snapshot": bool,
          "snapshot_url": str | None,     # URL proxied por el backend VMS
          "snapshot_bytes": bytes | None, # bytes si el plugin pidió pre-fetch
          "metadata": dict
        }
        """

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,           # JPEG bytes
        timestamp: float,       # unix timestamp
        width: int,
        height: int,
    ) -> None:
        """
        Hook opcional para análisis frame a frame.
        Solo se llama si el plugin está suscrito al FrameBuffer de esa cámara.
        Default: no-op (la mayoría de plugins no lo necesita).
        """

    async def on_unload(self) -> None:
        """Limpieza al deshabilitar: cerrar modelos, conexiones, etc."""

    def get_routes(self) -> Optional[APIRouter]:
        """
        Rutas FastAPI adicionales del plugin.
        Se montan en /api/v1/plugins/{self.name}/
        """
        return None

    def get_config_schema(self) -> dict:
        """
        JSON Schema de la configuración del plugin.
        Se usa en la UI para renderizar el formulario de configuración.
        """
        return {}

    def get_frame_subscriptions(self) -> list[str]:
        """
        Lista de camera_name a los que el plugin quiere suscribirse para on_frame().
        Retornar ["*"] para todas las cámaras.
        Default: [] (no suscrito a ningún frame).
        """
        return []

    async def emit_alert(
        self,
        camera_id: str,
        alert_type: str,
        severity: str,          # "low" | "medium" | "high" | "critical"
        data: dict,
        snapshot_bytes: bytes | None = None,
    ) -> None:
        """
        Emite una alerta al sistema VMS.
        El AlertService la distribuye via WebSocket y canales configurados.
        Implementado por el registry — no sobreescribir.
        """
        # Implementado por PluginRegistry al cargar el plugin
        raise NotImplementedError("emit_alert es inyectado por el PluginRegistry")
```

### plugin.json (metadatos del plugin)

```json
{
  "name": "lpr",
  "display_name": "LPR Avanzado",
  "version": "1.0.0",
  "description": "Reconocimiento de placas con YOLO + PaddleOCR",
  "author": "OpenCCTV",
  "category": "analytics",
  "requires_gpu": false,
  "supports_openvino": true,
  "min_ram_gb": 16,
  "dependencies": [
    "paddlepaddle==2.6.1",
    "paddleocr==2.7.3",
    "ultralytics>=8.0.0"
  ],
  "config_schema": "plugin.py::LPRPlugin.get_config_schema"
}
```

---

## 3. Pipeline de inferencia compartido

Todos los plugins enterprise usan la misma abstracción de inferencia para evitar cargar múltiples copias de los mismos modelos en memoria.

### InferenceEngine

```python
# backend/app/plugins/shared/inference_engine.py
"""
Abstracción sobre YOLO / ONNX / OpenVINO.
Permite que los plugins sean agnósticos al backend de inferencia.

Backends soportados (en orden de preferencia):
  1. NVIDIA CUDA (TensorRT via Ultralytics)
  2. OpenVINO (Intel iGPU / CPU — sin NVIDIA)
  3. ONNX Runtime CPU
  4. PyTorch CPU (fallback final)

Detección automática de backend disponible al iniciar.
"""

from enum import Enum
from pathlib import Path
import numpy as np

class InferenceBackend(Enum):
    TENSORRT = "tensorrt"
    OPENVINO = "openvino"
    ONNX_CPU = "onnx_cpu"
    PYTORCH_CPU = "pytorch_cpu"


class InferenceEngine:
    """
    Motor de inferencia unificado.
    Implementar con detección automática de hardware disponible.
    """

    @staticmethod
    def detect_best_backend() -> InferenceBackend:
        """
        Detecta el mejor backend disponible en el hardware actual.

        Lógica:
          1. Intentar import torch y verificar cuda.is_available() → TENSORRT
          2. Intentar import openvino → OPENVINO
          3. Intentar import onnxruntime con providers=['CPUExecutionProvider'] → ONNX_CPU
          4. Fallback → PYTORCH_CPU
        """
        try:
            import torch
            if torch.cuda.is_available():
                return InferenceBackend.TENSORRT
        except ImportError:
            pass
        try:
            import openvino
            return InferenceBackend.OPENVINO
        except ImportError:
            pass
        try:
            import onnxruntime
            return InferenceBackend.ONNX_CPU
        except ImportError:
            pass
        return InferenceBackend.PYTORCH_CPU

    def __init__(self, model_path: str, backend: InferenceBackend | None = None):
        self.model_path = Path(model_path)
        self.backend = backend or self.detect_best_backend()
        self._model = None

    async def load(self) -> None:
        """Cargar modelo según el backend detectado."""
        if self.backend == InferenceBackend.TENSORRT:
            from ultralytics import YOLO
            self._model = YOLO(str(self.model_path))
            self._model.to("cuda")
        elif self.backend == InferenceBackend.OPENVINO:
            from ultralytics import YOLO
            # Exportar a OpenVINO si no existe el modelo .xml
            xml_path = self.model_path.with_suffix(".xml")
            if not xml_path.exists():
                base = YOLO(str(self.model_path))
                base.export(format="openvino")
            self._model = YOLO(str(xml_path))
        elif self.backend == InferenceBackend.ONNX_CPU:
            import onnxruntime as ort
            onnx_path = self.model_path.with_suffix(".onnx")
            if not onnx_path.exists():
                from ultralytics import YOLO
                base = YOLO(str(self.model_path))
                base.export(format="onnx", opset=17, simplify=True)
            self._session = ort.InferenceSession(
                str(onnx_path),
                providers=["CPUExecutionProvider"],
            )
        else:
            from ultralytics import YOLO
            self._model = YOLO(str(self.model_path))
            self._model.to("cpu")

    async def predict(
        self,
        image: np.ndarray | bytes,
        conf: float = 0.5,
        iou: float = 0.45,
    ) -> list[dict]:
        """
        Ejecuta inferencia y retorna detecciones normalizadas.

        Retorna lista de:
        {
          "class_id": int,
          "class_name": str,
          "confidence": float,
          "bbox": {"x1": int, "y1": int, "x2": int, "y2": int}
        }
        """
        ...
```

### ByteTrack compartido

```python
# backend/app/plugins/shared/tracker.py
"""
Wrapper sobre ByteTrack para tracking multi-objeto.
Un tracker por cámara, compartido entre plugins que lo necesiten.

ByteTrack asocia detecciones entre frames usando IoU + Kalman filter.
No requiere GPU — corre bien en CPU incluso con 10+ cámaras.

Uso:
    tracker = TrackerManager.get_tracker("entrada_principal")
    tracks = await tracker.update(detections, frame_timestamp)

Cada track retorna:
    {
      "track_id": int,          # ID persistente del objeto
      "class_name": str,
      "confidence": float,
      "bbox": {...},
      "age": int,               # frames desde que apareció
      "history": list[bbox],    # historial de posiciones
    }
"""

class TrackerManager:
    """Singleton que gestiona un ByteTrack por cámara."""
    _trackers: dict[str, "ByteTrackWrapper"] = {}

    @classmethod
    def get_tracker(cls, camera_name: str) -> "ByteTrackWrapper":
        if camera_name not in cls._trackers:
            cls._trackers[camera_name] = ByteTrackWrapper(camera_name)
        return cls._trackers[camera_name]

    @classmethod
    def reset_tracker(cls, camera_name: str):
        cls._trackers.pop(camera_name, None)
```

### FrameBuffer — acceso a frames en tiempo real

```python
# backend/app/plugins/shared/frame_buffer.py
"""
Acceso a frames en tiempo real vía go2rtc RTSP restream.

Estrategia:
  - go2rtc ya tiene el stream conectado (Frigate lo usa)
  - Los plugins Modo B leen desde el RTSP de go2rtc directamente
  - Se usa OpenCV VideoCapture en un thread separado
  - Los frames se publican en Redis Streams (key: frames:{camera_name})
  - TTL de 5s en Redis para no acumular frames viejos

Un único proceso capturador por cámara sirve a todos los plugins.
Los plugins suscritos reciben frames via asyncio.Queue.

Configuración por cámara:
  - fps_capture: cuántos FPS capturar (default: 1 FPS para análisis)
  - resolution: resolución de captura (default: usar substream 704x576)
"""

import asyncio
import cv2
import threading
from collections import defaultdict

class FrameBuffer:
    """
    Gestor de captura y distribución de frames.
    Un FrameBuffer global para todo el VMS.
    """
    def __init__(self, redis_client):
        self.redis = redis_client
        self._capture_threads: dict[str, threading.Thread] = {}
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def subscribe(
        self,
        camera_name: str,
        rtsp_url: str,
        fps: float = 1.0,
    ) -> asyncio.Queue:
        """
        Suscribirse a frames de una cámara.
        Si ya hay un capturador corriendo, reutiliza el mismo thread.
        Retorna una Queue donde llegan los frames: (timestamp, jpeg_bytes, width, height)
        """
        queue = asyncio.Queue(maxsize=30)
        self._queues[camera_name].append(queue)

        if camera_name not in self._capture_threads:
            self._start_capture_thread(camera_name, rtsp_url, fps)

        return queue

    def _start_capture_thread(self, camera_name: str, rtsp_url: str, fps: float):
        """Inicia thread de captura OpenCV para la cámara."""
        thread = threading.Thread(
            target=self._capture_loop,
            args=(camera_name, rtsp_url, fps),
            daemon=True,
            name=f"frame-capture-{camera_name}",
        )
        thread.start()
        self._capture_threads[camera_name] = thread

    def _capture_loop(self, camera_name: str, rtsp_url: str, fps: float):
        """
        Loop de captura en thread separado.
        Lee frames de RTSP y los distribuye a las queues suscritas.
        Reconexión automática si el stream cae.
        """
        import time
        interval = 1.0 / fps

        while True:
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                time.sleep(5)
                continue

            while cap.isOpened():
                start = time.monotonic()
                ret, frame = cap.read()
                if not ret:
                    break

                _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                h, w = frame.shape[:2]
                ts = time.time()

                for queue in self._queues[camera_name]:
                    try:
                        queue.put_nowait((ts, jpeg.tobytes(), w, h))
                    except asyncio.QueueFull:
                        pass  # Plugin no está procesando, descartar frame

                elapsed = time.monotonic() - start
                sleep_time = max(0.0, interval - elapsed)
                time.sleep(sleep_time)

            cap.release()
            time.sleep(2)  # Pausa antes de reconectar
```

---

## 4. Plugin: LPR Avanzado

**Proyecto base:** PaddleOCR + YOLO placa custom
**Ventaja sobre LPR básico de Frigate:** mayor precisión en placas argentinas/latam, soporte multilenguaje, extracción estructurada (provincia, tipo, dígitos).

### Tecnología

- **Detección de placa:** YOLOv8 entrenado en dataset de placas argentinas (Mercosur + viejas)
- **OCR de placa:** PaddleOCR con modelo `latin` optimizado para placas
- **Sin GPU:** PaddleOCR corre en CPU; OpenVINO acelera YOLO en Intel
- **Hardware mínimo:** i5 10ª gen, 16 GB RAM (procesa ~5 FPS en CPU)

### Flujo

```
on_event(event con label="car" o "motorcycle")
    ↓
Obtener snapshot del evento (bytes JPEG)
    ↓
YOLO placa → detectar región de placa en imagen
    ↓
Crop de la región detectada
    ↓
PaddleOCR → extraer texto de la placa
    ↓
Normalizar texto (quitar espacios, uppercase, formato Mercosur)
    ↓
Verificar contra lista negra (tabla lpr_blacklist)
    ↓
Guardar en lpr_events
    ↓
Si lista negra: emit_alert(severity="high")
```

### Implementación

```python
# backend/app/plugins/enterprise/lpr/plugin.py

from app.plugins.base import BasePlugin
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
import numpy as np
import cv2
import re

class LPRAdvancedPlugin(BasePlugin):
    name = "lpr_advanced"
    version = "1.0.0"
    description = "Reconocimiento de placas Mercosur con YOLO + PaddleOCR"
    supports_openvino = True
    min_ram_gb = 16

    # Labels de Frigate que disparan el análisis
    TRIGGER_LABELS = {"car", "motorcycle", "truck", "bus"}

    def __init__(self):
        self._yolo = None           # motor YOLO para detección de placa
        self._ocr = None            # PaddleOCR
        self._config = {}

    async def on_load(self, config: dict) -> None:
        from app.plugins.shared.inference_engine import InferenceEngine
        from paddleocr import PaddleOCR

        self._config = config
        model_path = config.get("plate_model_path", "/models/lpr/plate_detector.pt")

        # Cargar YOLO para detección de región de placa
        self._yolo = InferenceEngine(model_path)
        await self._yolo.load()

        # Cargar PaddleOCR (solo CPU requerido)
        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang="latin",
            use_gpu=False,       # CPU por defecto, suficiente para snapshots
            show_log=False,
        )

        # Crear tablas si no existen
        await self._run_migrations()

    async def on_event(self, event: dict) -> None:
        # Solo procesar eventos de vehículos
        if event.get("label") not in self.TRIGGER_LABELS:
            return
        if not event.get("has_snapshot"):
            return

        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        # Decodificar imagen
        img_array = np.frombuffer(snapshot_bytes, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        # Detectar región de placa con YOLO
        detections = await self._yolo.predict(img, conf=0.5)
        plate_dets = [d for d in detections if d["class_name"] == "plate"]

        if not plate_dets:
            return  # Sin placa detectable en el frame

        # Tomar la detección más confiable
        best = max(plate_dets, key=lambda d: d["confidence"])
        bbox = best["bbox"]

        # Crop de la placa con padding
        padding = 5
        x1 = max(0, bbox["x1"] - padding)
        y1 = max(0, bbox["y1"] - padding)
        x2 = min(img.shape[1], bbox["x2"] + padding)
        y2 = min(img.shape[0], bbox["y2"] + padding)
        plate_crop = img[y1:y2, x1:x2]

        # OCR con PaddleOCR
        ocr_result = self._ocr.ocr(plate_crop, cls=True)
        if not ocr_result or not ocr_result[0]:
            return

        # Extraer y normalizar texto
        raw_text = " ".join([line[1][0] for line in ocr_result[0]])
        plate_text = self._normalize_plate(raw_text)
        plate_score = float(np.mean([line[1][1] for line in ocr_result[0]]))

        if not plate_text or len(plate_text) < 5:
            return  # Texto muy corto, descartado

        # Guardar en base de datos
        await self._save_lpr_event(event, plate_text, plate_score, bbox)

        # Verificar lista negra
        if await self._is_blacklisted(plate_text):
            await self.emit_alert(
                camera_id=event["camera_id"],
                alert_type="lpr_blacklist",
                severity="high",
                data={
                    "plate": plate_text,
                    "score": plate_score,
                    "camera_name": event["camera_name"],
                    "event_id": event["id"],
                },
            )

    def _normalize_plate(self, raw: str) -> str:
        """
        Normaliza texto de placa al formato argentino.

        Mercosur nuevo: ABC123 o AB123CD
        Viejo: ABC 123

        Elimina espacios, convierte a uppercase, quita caracteres inválidos.
        """
        text = re.sub(r"[^A-Z0-9]", "", raw.upper().strip())
        # Formato Mercosur: 2 letras + 3 dígitos + 2 letras (AB123CD)
        # O viejo: 3 letras + 3 dígitos (ABC123)
        if re.match(r"^[A-Z]{2}\d{3}[A-Z]{2}$", text):
            return text
        if re.match(r"^[A-Z]{3}\d{3}$", text):
            return text
        # Retornar igual si no matchea exacto (mejor que nada)
        return text if len(text) >= 5 else ""

    async def _save_lpr_event(
        self, event: dict, plate: str, score: float, bbox: dict
    ):
        # INSERT en tabla lpr_events (ver schema SQL abajo)
        ...

    async def _is_blacklisted(self, plate: str) -> bool:
        # Consultar tabla lpr_blacklist con match exacto y parcial (LIKE)
        ...

    async def _run_migrations(self):
        # Crear tablas lpr_events y lpr_blacklist si no existen
        ...

    def get_routes(self) -> APIRouter:
        router = APIRouter(prefix="/lpr_advanced", tags=["LPR Avanzado"])

        @router.get("/plates")
        async def get_plates(
            camera_id: str | None = None,
            plate: str | None = Query(None, description="Búsqueda parcial de placa"),
            after: float | None = None,
            before: float | None = None,
            limit: int = 100,
        ):
            """Historial de placas detectadas con filtros."""
            ...

        @router.get("/search")
        async def search_plate(plate: str = Query(..., min_length=3)):
            """Búsqueda de placa por texto parcial o exacto."""
            ...

        @router.post("/blacklist")
        async def add_blacklist(plate: str, reason: str | None = None):
            """Agregar placa a lista negra."""
            ...

        @router.get("/blacklist")
        async def get_blacklist():
            """Listar placas en lista negra."""
            ...

        @router.delete("/blacklist/{plate}")
        async def remove_blacklist(plate: str):
            """Eliminar placa de lista negra."""
            ...

        return router

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "plate_model_path": {
                    "type": "string",
                    "default": "/models/lpr/plate_detector.pt",
                    "description": "Ruta al modelo YOLO de detección de placas",
                },
                "min_plate_confidence": {
                    "type": "number",
                    "minimum": 0.3,
                    "maximum": 1.0,
                    "default": 0.5,
                    "description": "Confianza mínima de detección de placa",
                },
                "min_ocr_confidence": {
                    "type": "number",
                    "minimum": 0.3,
                    "maximum": 1.0,
                    "default": 0.7,
                    "description": "Confianza mínima del OCR para guardar",
                },
                "trigger_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                    "description": "Cámaras a analizar (vacío = todas)",
                },
                "blacklist_enabled": {
                    "type": "boolean",
                    "default": True,
                    "description": "Activar verificación de lista negra",
                },
            },
        }
```

### Schema SQL

```sql
CREATE TABLE lpr_events (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id),
  camera_id UUID REFERENCES cameras(id),
  plate_text TEXT NOT NULL,
  plate_score NUMERIC(5,3),
  yolo_confidence NUMERIC(5,3),
  bbox JSONB,
  snapshot_crop_path TEXT,         -- path al crop de la placa
  normalized_text TEXT,
  plate_type TEXT,                 -- "mercosur_nuevo" | "mercosur_viejo" | "desconocido"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lpr_events_plate ON lpr_events (plate_text);
CREATE INDEX idx_lpr_events_camera_time ON lpr_events (camera_id, created_at DESC);

CREATE TABLE lpr_blacklist (
  id BIGSERIAL PRIMARY KEY,
  plate_text TEXT UNIQUE NOT NULL,
  reason TEXT,
  alert_count INTEGER DEFAULT 0,
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Plugin: Reconocimiento Facial

**Proyecto base:** InsightFace + CompreFace (self-hosted)
**Estrategia recomendada:** InsightFace para embeddings locales + pgvector para búsqueda por similitud. CompreFace como alternativa para instancias con UI de gestión de caras.

### Tecnología

- **Detección facial:** InsightFace `buffalo_l` (ONNX — sin NVIDIA requerido)
- **Embeddings:** ArcFace 512-d via InsightFace
- **Búsqueda por similitud:** pgvector (extensión PostgreSQL)
- **Alternativa sin pgvector:** cosine similarity en Python sobre embeddings cacheados en Redis
- **Hardware mínimo:** i5/i7, 16 GB RAM; con OpenVINO acelera en Intel

### Flujo

```
on_event(event con label="person")
    ↓
Obtener snapshot
    ↓
InsightFace.detect → lista de caras con bbox + embedding 512-d
    ↓
Para cada cara: buscar en pgvector (top-1 con threshold)
    ↓
Si coincidencia > umbral: cara conocida → enriquecer evento
Si no: cara desconocida → guardar para revisión manual
    ↓
Guardar en face_events
    ↓
Si cara está en watchlist: emit_alert
```

### Implementación

```python
# backend/app/plugins/enterprise/face_recognition/plugin.py

import numpy as np
import cv2
from app.plugins.base import BasePlugin
from fastapi import APIRouter, UploadFile, File

class FaceRecognitionPlugin(BasePlugin):
    name = "face_recognition"
    version = "1.0.0"
    description = "Reconocimiento facial con InsightFace + pgvector"
    supports_openvino = True
    min_ram_gb = 16

    TRIGGER_LABELS = {"person"}
    SIMILARITY_THRESHOLD = 0.5     # cosine distance máxima para match

    def __init__(self):
        self._app = None            # InsightFace app
        self._config = {}

    async def on_load(self, config: dict) -> None:
        import insightface
        self._config = config

        # Cargar InsightFace con modelo buffalo_l (ONNX, funciona sin CUDA)
        # providers: ["CUDAExecutionProvider", "CPUExecutionProvider"] con NVIDIA
        # providers: ["CPUExecutionProvider"] sin NVIDIA
        providers = self._detect_providers()
        self._app = insightface.app.FaceAnalysis(
            name="buffalo_l",
            providers=providers,
        )
        self._app.prepare(ctx_id=0, det_size=(640, 640))
        await self._run_migrations()

    def _detect_providers(self) -> list[str]:
        try:
            import torch
            if torch.cuda.is_available():
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        except ImportError:
            pass
        try:
            import openvino  # noqa
            return ["OpenVINOExecutionProvider", "CPUExecutionProvider"]
        except ImportError:
            pass
        return ["CPUExecutionProvider"]

    async def on_event(self, event: dict) -> None:
        if event.get("label") not in self.TRIGGER_LABELS:
            return
        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        img_array = np.frombuffer(snapshot_bytes, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        # InsightFace espera BGR (OpenCV default) — no convertir

        faces = self._app.get(img)
        if not faces:
            return

        for face in faces:
            embedding = face.embedding.tolist()   # vector 512-d
            bbox = {
                "x1": int(face.bbox[0]),
                "y1": int(face.bbox[1]),
                "x2": int(face.bbox[2]),
                "y2": int(face.bbox[3]),
            }
            det_score = float(face.det_score)

            # Buscar cara conocida en pgvector
            person = await self._search_by_embedding(embedding)
            person_id = person["id"] if person else None
            person_name = person["name"] if person else None
            similarity = person["similarity"] if person else None

            # Guardar en face_events
            await self._save_face_event(
                event, bbox, embedding, det_score, person_id, similarity
            )

            # Alerta si está en watchlist
            if person_id and await self._is_watchlisted(person_id):
                await self.emit_alert(
                    camera_id=event["camera_id"],
                    alert_type="face_watchlist",
                    severity="high",
                    data={
                        "person_id": person_id,
                        "person_name": person_name,
                        "similarity": similarity,
                        "camera_name": event["camera_name"],
                    },
                )

    async def _search_by_embedding(
        self, embedding: list[float]
    ) -> dict | None:
        """
        Buscar la persona más similar en pgvector.
        Usar operador <=> (cosine distance) de pgvector.

        SQL:
          SELECT id, name, 1 - (embedding <=> $1::vector) AS similarity
          FROM face_persons
          WHERE 1 - (embedding <=> $1::vector) > threshold
          ORDER BY embedding <=> $1::vector
          LIMIT 1
        """
        ...

    async def _save_face_event(self, *args): ...
    async def _run_migrations(self): ...
    async def _is_watchlisted(self, person_id: int) -> bool: ...

    def get_routes(self) -> APIRouter:
        router = APIRouter(prefix="/face_recognition", tags=["Reconocimiento Facial"])

        @router.get("/persons")
        async def list_persons():
            """Personas registradas."""
            ...

        @router.post("/persons")
        async def create_person(name: str, photo: UploadFile = File(...)):
            """
            Registrar nueva persona.
            Extrae embedding del foto y lo guarda en face_persons.
            """
            ...

        @router.post("/persons/{id}/photos")
        async def add_photo(id: int, photo: UploadFile = File(...)):
            """Agregar foto adicional para mejorar el embedding (promedia)."""
            ...

        @router.delete("/persons/{id}")
        async def delete_person(id: int):
            """Eliminar persona y sus embeddings."""
            ...

        @router.get("/events")
        async def get_face_events(
            person_id: int | None = None,
            camera_id: str | None = None,
            unknown_only: bool = False,
            limit: int = 100,
        ):
            """Historial de detecciones faciales."""
            ...

        @router.post("/persons/{id}/watchlist")
        async def add_to_watchlist(id: int, reason: str | None = None):
            """Agregar persona a watchlist para alertas."""
            ...

        return router
```

### Schema SQL (requiere extensión pgvector)

```sql
-- Habilitar pgvector (una vez en la DB)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE face_persons (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  embedding vector(512),           -- embedding promedio de todas las fotos
  photo_count INTEGER DEFAULT 0,
  in_watchlist BOOLEAN DEFAULT false,
  watchlist_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice HNSW para búsqueda aproximada eficiente
CREATE INDEX face_persons_embedding_idx
  ON face_persons USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE face_events (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id),
  camera_id UUID REFERENCES cameras(id),
  person_id BIGINT REFERENCES face_persons(id),   -- NULL si desconocido
  similarity NUMERIC(5,4),
  det_score NUMERIC(5,4),
  bbox JSONB,
  embedding vector(512),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_face_events_person ON face_events (person_id, created_at DESC);
CREATE INDEX idx_face_events_camera ON face_events (camera_id, created_at DESC);
```

---

## 6. Plugin: Merodeo

**Proyecto base:** ByteTrack + reglas temporales de zona
**Modo:** Frame-driven (requiere análisis continuo)

### Tecnología

- **Tracking:** ByteTrack (CPU, ~zero NVIDIA dependency)
- **Detección base:** reusar las detecciones de Frigate vía MQTT (no redetectar)
- **Lógica:** un objeto "merodea" si permanece en una zona > N segundos sin propósito aparente
- **Hardware mínimo:** i5, 8–16 GB RAM

### Flujo

```
on_event(evento Frigate — cualquier persona/vehículo)
    ↓
Actualizar TrackerManager con la detección
    ↓
Para cada track activo en zona configurada:
  ↓ tiempo_en_zona = now - track.enter_time
  ↓ Si tiempo_en_zona > umbral (ej: 60s):
      → emit_alert("loitering")
      → registrar en loitering_events
      → cooldown: no alertar otra vez por el mismo track hasta 5min
```

```python
# backend/app/plugins/enterprise/loitering/plugin.py

from app.plugins.base import BasePlugin
from app.plugins.shared.tracker import TrackerManager
import time
from typing import NamedTuple

class ZoneConfig(NamedTuple):
    name: str
    polygon: list[tuple[int, int]]   # puntos en píxeles o porcentajes
    threshold_seconds: int            # tiempo para disparar alerta
    labels: list[str]                 # labels a monitorear

class LoiteringPlugin(BasePlugin):
    name = "loitering"
    version = "1.0.0"
    description = "Detección de merodeo por permanencia prolongada en zona"
    supports_openvino = True
    min_ram_gb = 8

    def __init__(self):
        self._zones: dict[str, list[ZoneConfig]] = {}    # por camera_name
        self._track_entry_times: dict[str, dict[int, float]] = {}  # camera → track_id → ts
        self._alerted_tracks: dict[str, dict[int, float]] = {}     # cooldown
        self._config = {}

    async def on_load(self, config: dict) -> None:
        self._config = config
        # Parsear zonas de la config del plugin
        for cam_name, zones in config.get("zones", {}).items():
            self._zones[cam_name] = [
                ZoneConfig(
                    name=z["name"],
                    polygon=z["polygon"],
                    threshold_seconds=z.get("threshold_seconds", 60),
                    labels=z.get("labels", ["person"]),
                )
                for z in zones
            ]
        await self._run_migrations()

    async def on_event(self, event: dict) -> None:
        """
        Usa eventos de Frigate para actualizar el estado de tracking.
        No necesita on_frame porque ByteTrack puede operar con detecciones
        intermitentes de Frigate (no necesita frame continuo para merodeo).
        """
        camera_name = event["camera_name"]
        if camera_name not in self._zones:
            return

        label = event.get("label")
        bbox = event.get("metadata", {}).get("box")
        if not bbox:
            return

        track_id = event.get("metadata", {}).get("track_id")
        if not track_id:
            return

        now = time.time()
        zones_for_cam = self._zones[camera_name]

        for zone in zones_for_cam:
            if label not in zone.labels:
                continue

            # Verificar si el bbox está dentro del polígono de la zona
            center_x = (bbox.get("xmin", 0) + bbox.get("xmax", 0)) / 2
            center_y = (bbox.get("ymin", 0) + bbox.get("ymax", 0)) / 2

            if not self._point_in_polygon(center_x, center_y, zone.polygon):
                # Salió de la zona — resetear timer
                self._track_entry_times.setdefault(camera_name, {}).pop(track_id, None)
                continue

            # Está en la zona — registrar entry time si es la primera vez
            entry_times = self._track_entry_times.setdefault(camera_name, {})
            if track_id not in entry_times:
                entry_times[track_id] = now
                continue

            time_in_zone = now - entry_times[track_id]
            if time_in_zone < zone.threshold_seconds:
                continue

            # Verificar cooldown (no alertar dos veces por el mismo track en 5min)
            alerted = self._alerted_tracks.setdefault(camera_name, {})
            last_alert = alerted.get(track_id, 0)
            if now - last_alert < 300:  # 5 minutos cooldown
                continue

            alerted[track_id] = now
            await self.emit_alert(
                camera_id=event["camera_id"],
                alert_type="loitering",
                severity="medium",
                data={
                    "track_id": track_id,
                    "zone_name": zone.name,
                    "time_in_zone_seconds": int(time_in_zone),
                    "label": label,
                    "camera_name": camera_name,
                },
            )
            await self._save_loitering_event(event, zone.name, time_in_zone, track_id)

    def _point_in_polygon(
        self, x: float, y: float, polygon: list[tuple]
    ) -> bool:
        """Ray casting algorithm para punto en polígono."""
        import cv2
        import numpy as np
        pts = np.array(polygon, dtype=np.float32)
        result = cv2.pointPolygonTest(pts, (x, y), False)
        return result >= 0

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "zones": {
                    "type": "object",
                    "description": "Zonas por cámara. Key = camera_name",
                    "additionalProperties": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "polygon": {
                                    "type": "array",
                                    "items": {
                                        "type": "array",
                                        "items": {"type": "number"},
                                        "minItems": 2,
                                        "maxItems": 2,
                                    },
                                    "description": "Lista de [x, y] en píxeles",
                                },
                                "threshold_seconds": {
                                    "type": "integer",
                                    "default": 60,
                                    "description": "Segundos en zona para disparar alerta",
                                },
                                "labels": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "default": ["person"],
                                },
                            },
                        },
                    },
                }
            },
        }
```

---

## 7. Plugin: Cruce de Línea

**Proyecto base:** ByteTrack + OpenCV geometría
**Modo:** Event-driven (usa tracks de Frigate + historial de posiciones)

### Tecnología

- **Tracking:** ByteTrack compartido (mismo que Merodeo)
- **Lógica:** detectar cuando un track cruza un segmento de línea en una dirección
- **Sin GPU necesaria**

```python
# backend/app/plugins/enterprise/line_crossing/plugin.py

class LineCrossingPlugin(BasePlugin):
    name = "line_crossing"
    version = "1.0.0"
    description = "Detección de cruce de línea virtual con dirección"
    supports_openvino = True
    min_ram_gb = 8

    async def on_event(self, event: dict) -> None:
        """
        Detecta cruce usando historial de posiciones del track.
        Requiere que Frigate tenga track_id en metadata.
        """
        camera_name = event["camera_name"]
        lines = self._config.get("lines", {}).get(camera_name, [])
        if not lines:
            return

        track_id = event.get("metadata", {}).get("track_id")
        if not track_id:
            return

        # Obtener posición actual y anterior del track
        current_bbox = event.get("metadata", {}).get("box", {})
        cx = (current_bbox.get("xmin", 0) + current_bbox.get("xmax", 0)) / 2
        cy = (current_bbox.get("ymin", 0) + current_bbox.get("ymax", 0)) / 2

        # Recuperar posición anterior de Redis (cacheada)
        prev_pos = await self._get_prev_position(camera_name, track_id)
        await self._save_position(camera_name, track_id, (cx, cy))

        if prev_pos is None:
            return

        for line_cfg in lines:
            direction = self._check_line_crossing(
                prev_pos,
                (cx, cy),
                line_cfg["p1"],
                line_cfg["p2"],
            )
            if direction is None:
                continue

            # Solo alertar si la dirección coincide con la configurada
            # direction: "AB" (de p1→p2) o "BA" (de p2→p1)
            allowed = line_cfg.get("directions", ["AB", "BA"])
            if direction not in allowed:
                continue

            await self.emit_alert(
                camera_id=event["camera_id"],
                alert_type="line_crossing",
                severity=line_cfg.get("severity", "medium"),
                data={
                    "line_name": line_cfg["name"],
                    "direction": direction,
                    "track_id": track_id,
                    "label": event["label"],
                    "camera_name": camera_name,
                },
            )

    def _check_line_crossing(
        self,
        p_prev: tuple,
        p_curr: tuple,
        line_p1: tuple,
        line_p2: tuple,
    ) -> str | None:
        """
        Verifica si el segmento p_prev→p_curr cruza la línea line_p1→line_p2.
        Retorna "AB", "BA" o None.
        Usa producto cruzado (cross product) para detectar cruce de segmentos.
        """
        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

        d1 = cross(line_p1, line_p2, p_prev)
        d2 = cross(line_p1, line_p2, p_curr)

        if (d1 > 0 and d2 < 0):
            return "AB"
        if (d1 < 0 and d2 > 0):
            return "BA"
        return None
```

---

## 8. Plugin: Conteo de Personas y Vehículos

**Proyecto base:** Supervision + OpenCV zonas
**Modo:** Event-driven + acumuladores en Redis

```python
# backend/app/plugins/enterprise/people_counting/plugin.py

class PeopleCountingPlugin(BasePlugin):
    name = "people_counting"
    version = "1.0.0"
    description = "Conteo de personas y vehículos por zona y línea de cruce"
    supports_openvino = True
    min_ram_gb = 8

    async def on_load(self, config: dict) -> None:
        """
        Inicializa contadores en Redis.
        Estructura Redis:
          count:{camera_name}:{zone_name}:{label}:in   → int
          count:{camera_name}:{zone_name}:{label}:out  → int
          count:{camera_name}:{zone_name}:{label}:current → int (in - out)
        """
        ...

    async def on_event(self, event: dict) -> None:
        """
        Incrementa contadores cuando un track cruza una línea de conteo.
        Reutiliza lógica de line_crossing internamente.
        """
        ...

    def get_routes(self) -> APIRouter:
        router = APIRouter(prefix="/people_counting")

        @router.get("/counts")
        async def get_counts(camera_name: str | None = None):
            """Contadores actuales en tiempo real."""
            ...

        @router.get("/history")
        async def get_history(
            camera_name: str,
            zone_name: str | None = None,
            granularity: str = "hour",   # "minute" | "hour" | "day"
            after: float | None = None,
            before: float | None = None,
        ):
            """Serie temporal de conteos para gráficos."""
            ...

        @router.post("/reset")
        async def reset_counters(camera_name: str, zone_name: str | None = None):
            """Resetear contadores manualmente."""
            ...

        return router
```

---

## 9. Plugin: Objeto Abandonado

**Proyecto base:** OpenCV + YOLO + tracking temporal
**Modo:** Frame-driven (necesita comparar frames con y sin objeto)

```python
# backend/app/plugins/enterprise/abandoned_object/plugin.py

class AbandonedObjectPlugin(BasePlugin):
    name = "abandoned_object"
    version = "1.0.0"
    description = "Detección de objetos abandonados por ausencia de owner"
    supports_openvino = True
    min_ram_gb = 16

    # Un objeto es "abandonado" si:
    # 1. Se detecta (mochila, bolso, maleta, etc.)
    # 2. El owner (persona) que lo traía se aleja o desaparece
    # 3. El objeto permanece estático por más de N segundos sin owner cercano

    OBJECT_LABELS = {"backpack", "handbag", "suitcase", "bag"}
    OWNER_LABELS = {"person"}

    async def on_event(self, event: dict) -> None:
        """
        Lógica de asociación owner-objeto:
          1. Si label es objeto: registrar en tabla de objetos activos con timestamp
          2. Si label es persona: actualizar posición de personas activas
          3. Periódicamente (cada 10s): verificar objetos sin owner cercano
             → Si objeto presente > threshold sin persona a < distancia_max píxeles:
                emit_alert("abandoned_object")
        """
        ...

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "threshold_seconds": {
                    "type": "integer",
                    "default": 120,
                    "description": "Segundos sin owner para considerar objeto abandonado",
                },
                "owner_distance_px": {
                    "type": "integer",
                    "default": 200,
                    "description": "Distancia máxima en píxeles para considerar owner presente",
                },
                "monitored_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                },
            },
        }
```

---

## 10. Plugin: EPP — Casco y Chaleco

**Proyecto base:** Ultralytics YOLO con modelo custom de EPP
**Modo:** Event-driven (procesa snapshot cuando Frigate detecta persona)

```python
# backend/app/plugins/enterprise/ppe_detection/plugin.py

class PPEDetectionPlugin(BasePlugin):
    name = "ppe_detection"
    version = "1.0.0"
    description = "Verificación de EPP (casco y chaleco) en zonas de trabajo"
    supports_openvino = True
    min_ram_gb = 16

    # Clases del modelo EPP custom:
    # 0: hardhat, 1: no_hardhat, 2: vest, 3: no_vest, 4: person
    PPE_CLASSES = {
        0: "hardhat",
        1: "no_hardhat",
        2: "vest",
        3: "no_vest",
        4: "person",
    }

    async def on_load(self, config: dict) -> None:
        """
        Cargar modelo YOLO custom de EPP.
        Modelo recomendado: entrenado en dataset Safety-Helmet-Wearing-Dataset
        o similar. Disponible en Roboflow Universe como "ppe-detection".
        """
        from app.plugins.shared.inference_engine import InferenceEngine
        model_path = config.get("ppe_model_path", "/models/ppe/ppe_detector.pt")
        self._yolo = InferenceEngine(model_path)
        await self._yolo.load()

    async def on_event(self, event: dict) -> None:
        if event.get("label") != "person":
            return

        # Verificar si la cámara está en zona de EPP requerido
        camera_name = event["camera_name"]
        required_ppe = self._config.get("required_ppe", {}).get(camera_name)
        if not required_ppe:
            return

        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        import numpy as np
        import cv2
        img = cv2.imdecode(np.frombuffer(snapshot_bytes, np.uint8), cv2.IMREAD_COLOR)
        detections = await self._yolo.predict(img, conf=0.5)

        violations = []
        if "hardhat" in required_ppe:
            has_hardhat = any(d["class_name"] == "hardhat" for d in detections)
            no_hardhat = any(d["class_name"] == "no_hardhat" for d in detections)
            if no_hardhat or (not has_hardhat):
                violations.append("sin_casco")

        if "vest" in required_ppe:
            has_vest = any(d["class_name"] == "vest" for d in detections)
            no_vest = any(d["class_name"] == "no_vest" for d in detections)
            if no_vest or (not has_vest):
                violations.append("sin_chaleco")

        if violations:
            await self.emit_alert(
                camera_id=event["camera_id"],
                alert_type="ppe_violation",
                severity="high",
                data={
                    "violations": violations,
                    "camera_name": camera_name,
                    "event_id": event["id"],
                },
            )
```

---

## 11. Plugin: Detección de Caídas

**Proyecto base:** MediaPipe Pose (preferido, CPU-friendly) / OpenPose (más preciso, pesado)
**Modo:** Frame-driven (análisis de pose frame a frame)

```python
# backend/app/plugins/enterprise/fall_detection/plugin.py

class FallDetectionPlugin(BasePlugin):
    name = "fall_detection"
    version = "1.0.0"
    description = "Detección de caídas por estimación de pose (MediaPipe)"
    supports_openvino = False     # MediaPipe usa su propio runtime
    min_ram_gb = 16

    # MediaPipe es CPU-friendly y no requiere NVIDIA
    # OpenPose es más preciso pero requiere GPU o i7+ para velocidad aceptable

    KEYPOINTS = {
        # Índices de keypoints MediaPipe relevantes para caídas
        "nose": 0, "left_shoulder": 11, "right_shoulder": 12,
        "left_hip": 23, "right_hip": 24,
        "left_knee": 25, "right_knee": 26,
        "left_ankle": 27, "right_ankle": 28,
    }

    async def on_load(self, config: dict) -> None:
        import mediapipe as mp
        self._mp_pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=1,          # 0=ligero, 1=balanceado, 2=preciso
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._config = config
        self._pose_history: dict[str, list] = {}  # camera → historial de poses

    def get_frame_subscriptions(self) -> list[str]:
        """Suscribirse a cámaras configuradas para detección de caídas."""
        return self._config.get("monitored_cameras", ["*"])

    async def on_frame(
        self, camera_name: str, frame: bytes,
        timestamp: float, width: int, height: int,
    ) -> None:
        import cv2
        import numpy as np

        img_array = np.frombuffer(frame, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        results = self._mp_pose.process(img_rgb)
        if not results.pose_landmarks:
            return

        landmarks = results.pose_landmarks.landmark
        keypoints = {
            name: (landmarks[idx].x * width, landmarks[idx].y * height)
            for name, idx in self.KEYPOINTS.items()
        }

        # Guardar en historial de poses
        history = self._pose_history.setdefault(camera_name, [])
        history.append({"ts": timestamp, "keypoints": keypoints})
        if len(history) > 30:  # mantener últimos 30 frames
            history.pop(0)

        # Detectar caída
        if self._is_fall(keypoints, camera_name):
            await self.emit_alert(
                camera_id=await self._get_camera_id(camera_name),
                alert_type="fall_detected",
                severity="critical",
                data={
                    "camera_name": camera_name,
                    "timestamp": timestamp,
                    "keypoints": keypoints,
                },
            )

    def _is_fall(self, keypoints: dict, camera_name: str) -> bool:
        """
        Heurística de detección de caída basada en posición de keypoints.

        Indicadores de caída:
          1. Las caderas están más bajas que las rodillas (posición horizontal)
          2. La diferencia entre hombros y caderas en Y es pequeña (cuerpo horizontal)
          3. Cambio súbito de Y en los últimos N frames (velocidad de caída)

        Ajustar thresholds según tipo de cámara (cenital vs lateral).
        """
        try:
            left_hip_y = keypoints["left_hip"][1]
            right_hip_y = keypoints["right_hip"][1]
            left_knee_y = keypoints["left_knee"][1]
            right_knee_y = keypoints["right_knee"][1]
            left_shoulder_y = keypoints["left_shoulder"][1]
            right_shoulder_y = keypoints["right_shoulder"][1]

            avg_hip_y = (left_hip_y + right_hip_y) / 2
            avg_knee_y = (left_knee_y + right_knee_y) / 2
            avg_shoulder_y = (left_shoulder_y + right_shoulder_y) / 2

            # Indicador 1: caderas cerca o debajo de rodillas (en píxeles, Y aumenta hacia abajo)
            vertical_ratio = abs(avg_hip_y - avg_knee_y) / max(
                abs(avg_shoulder_y - avg_hip_y), 1
            )
            is_horizontal = vertical_ratio < 0.3

            # Indicador 2: velocidad de caída (cambio en Y entre frames)
            history = self._pose_history.get(camera_name, [])
            if len(history) >= 5:
                old_hip_y = history[-5]["keypoints"].get("left_hip", (0, 0))[1]
                delta_y = avg_hip_y - old_hip_y
                is_falling_fast = delta_y > 50  # más de 50px en 5 frames
            else:
                is_falling_fast = False

            return is_horizontal or is_falling_fast
        except (KeyError, ZeroDivisionError):
            return False
```

---

## 12. Plugin: Humo y Fuego

**Proyecto base:** YOLO entrenado en datasets de fuego/humo
**Modo:** Frame-driven (análisis continuo a baja frecuencia)

```python
# backend/app/plugins/enterprise/fire_smoke/plugin.py

class FireSmokePlugin(BasePlugin):
    name = "fire_smoke"
    version = "1.0.0"
    description = "Detección de fuego y humo con YOLO custom"
    supports_openvino = True
    min_ram_gb = 16

    # Datasets recomendados para entrenar/finetunar:
    # - D-Fire dataset (Roboflow Universe): fuego + humo con >21k imágenes
    # - Fire-and-Smoke-Detection (Ultralytics Hub)
    # - FASDD (Fire and Smoke Detection Dataset)

    CLASSES = {0: "fire", 1: "smoke"}

    async def on_load(self, config: dict) -> None:
        from app.plugins.shared.inference_engine import InferenceEngine
        model_path = config.get("model_path", "/models/fire_smoke/detector.pt")
        self._yolo = InferenceEngine(model_path)
        await self._yolo.load()
        self._fps_analyze = config.get("fps_analyze", 0.5)  # 1 frame cada 2 segundos

    def get_frame_subscriptions(self) -> list[str]:
        return self._config.get("monitored_cameras", ["*"])

    async def on_frame(
        self, camera_name: str, frame: bytes,
        timestamp: float, width: int, height: int,
    ) -> None:
        import numpy as np
        import cv2

        img = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
        detections = await self._yolo.predict(img, conf=0.6)

        fire_dets = [d for d in detections if d["class_name"] in ("fire", "smoke")]
        if not fire_dets:
            return

        # Agrupar por tipo para la alerta
        types = list({d["class_name"] for d in fire_dets})
        severity = "critical" if "fire" in types else "high"

        await self.emit_alert(
            camera_id=await self._get_camera_id(camera_name),
            alert_type="fire_smoke",
            severity=severity,
            data={
                "detected_types": types,
                "detections": [
                    {"class": d["class_name"], "confidence": d["confidence"]}
                    for d in fire_dets
                ],
                "camera_name": camera_name,
                "timestamp": timestamp,
            },
        )
```

---

## 13. Plugin: Sabotaje de Cámara

**Proyecto base:** cikit-image / OpenCV análisis de calidad de frame
**Modo:** Frame-driven a muy baja frecuencia (1 frame cada 10s es suficiente)
**Sin GPU:** 100% CPU, corre hasta en i3

```python
# backend/app/plugins/enterprise/camera_sabotage/plugin.py

class CameraSabotagePlugin(BasePlugin):
    name = "camera_sabotage"
    version = "1.0.0"
    description = "Detección de sabotaje: tapado, desenfoque, movimiento brusco"
    supports_openvino = True
    min_ram_gb = 8

    # Tipos de sabotaje detectados:
    # - "blur": cámara desenfocada (tapada con objeto, spray, etc.)
    # - "solid_color": pantalla completamente bloqueada (tapada)
    # - "scene_change": cambio brusco de escena (cámara movida)
    # - "loss_of_signal": frame negro (pérdida de señal)

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._reference_frames: dict[str, bytes] = {}  # frame de referencia por cámara
        self._consecutive_alerts: dict[str, int] = {}  # contador para reducir falsos positivos
        await self._run_migrations()

    def get_frame_subscriptions(self) -> list[str]:
        return ["*"]   # Monitorear todas las cámaras

    async def on_frame(
        self, camera_name: str, frame: bytes,
        timestamp: float, width: int, height: int,
    ) -> None:
        import cv2
        import numpy as np

        img = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_GRAYSCALE)

        sabotage_type = None

        # 1. Detección de pérdida de señal (frame negro)
        mean_brightness = np.mean(img)
        if mean_brightness < 5:
            sabotage_type = "loss_of_signal"

        # 2. Detección de pantalla sólida (tapado total)
        elif np.std(img) < 8:
            sabotage_type = "solid_color"

        # 3. Detección de desenfoque con Laplacian variance
        elif self._detect_blur(img):
            sabotage_type = "blur"

        # 4. Detección de cambio brusco de escena con SSIM
        elif camera_name in self._reference_frames:
            ref = cv2.imdecode(
                np.frombuffer(self._reference_frames[camera_name], np.uint8),
                cv2.IMREAD_GRAYSCALE,
            )
            ssim_score = self._compute_ssim(img, ref)
            if ssim_score < self._config.get("ssim_threshold", 0.4):
                sabotage_type = "scene_change"

        # Actualizar frame de referencia cada 60s
        # (usar un timer simple con timestamp)
        self._update_reference_frame(camera_name, frame, timestamp)

        if sabotage_type:
            # Requerir N frames consecutivos antes de alertar (reducir falsos positivos)
            count = self._consecutive_alerts.get(camera_name, 0) + 1
            self._consecutive_alerts[camera_name] = count
            required = self._config.get("consecutive_frames_required", 3)
            if count >= required:
                self._consecutive_alerts[camera_name] = 0
                await self.emit_alert(
                    camera_id=await self._get_camera_id(camera_name),
                    alert_type="camera_sabotage",
                    severity="critical",
                    data={
                        "sabotage_type": sabotage_type,
                        "camera_name": camera_name,
                        "timestamp": timestamp,
                    },
                )
        else:
            self._consecutive_alerts[camera_name] = 0

    def _detect_blur(self, gray_img) -> bool:
        """Laplacian variance < threshold indica desenfoque."""
        import cv2
        laplacian_var = cv2.Laplacian(gray_img, cv2.CV_64F).var()
        return laplacian_var < self._config.get("blur_threshold", 50)

    def _compute_ssim(self, img1, img2) -> float:
        """SSIM entre frame actual y referencia. 1.0 = idénticos, 0.0 = completamente distintos."""
        from skimage.metrics import structural_similarity as ssim
        if img1.shape != img2.shape:
            import cv2
            img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))
        score, _ = ssim(img1, img2, full=True)
        return float(score)
```

---

## 14. Plugin: OCR General

**Proyecto base:** PaddleOCR
**Modo:** Event-driven (analiza snapshot de evento cuando se solicita o por regla)

```python
# backend/app/plugins/enterprise/ocr_general/plugin.py

class OCRGeneralPlugin(BasePlugin):
    name = "ocr_general"
    version = "1.0.0"
    description = "Extracción de texto de imágenes con PaddleOCR"
    supports_openvino = False      # PaddleOCR usa su propio runtime
    min_ram_gb = 16

    # Casos de uso:
    # - Leer patentes (combinado con LPR avanzado)
    # - Leer carteles de precios, productos
    # - Leer números de contenedores
    # - Extraer texto de pizarras o pantallas

    async def on_load(self, config: dict) -> None:
        from paddleocr import PaddleOCR
        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang=config.get("language", "es"),  # "es", "en", "ch", "latin"
            use_gpu=False,
            show_log=False,
        )
        self._config = config

    async def on_event(self, event: dict) -> None:
        """
        Solo procesar si la cámara está configurada para OCR automático
        o si el evento fue manualmente marcado para OCR.
        """
        camera_name = event["camera_name"]
        auto_cameras = self._config.get("auto_ocr_cameras", [])
        if camera_name not in auto_cameras:
            return

        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        result = await self._run_ocr(snapshot_bytes)
        if result["texts"]:
            await self._save_ocr_result(event, result)

    async def _run_ocr(self, image_bytes: bytes) -> dict:
        """
        Ejecuta OCR sobre la imagen completa o una región.
        Retorna lista de textos con posición y confianza.
        """
        import numpy as np
        import cv2

        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        ocr_result = self._ocr.ocr(img, cls=True)

        texts = []
        if ocr_result and ocr_result[0]:
            for line in ocr_result[0]:
                bbox_points, (text, confidence) = line
                texts.append({
                    "text": text,
                    "confidence": float(confidence),
                    "bbox": {
                        "x1": int(min(p[0] for p in bbox_points)),
                        "y1": int(min(p[1] for p in bbox_points)),
                        "x2": int(max(p[0] for p in bbox_points)),
                        "y2": int(max(p[1] for p in bbox_points)),
                    },
                })
        return {"texts": texts, "full_text": " ".join(t["text"] for t in texts)}

    def get_routes(self) -> APIRouter:
        router = APIRouter(prefix="/ocr_general")

        @router.post("/analyze")
        async def analyze_snapshot(event_id: int):
            """OCR manual sobre el snapshot de un evento específico."""
            ...

        @router.get("/results")
        async def get_ocr_results(
            camera_id: str | None = None,
            text_contains: str | None = None,
            limit: int = 100,
        ):
            """Resultados de OCR con búsqueda por texto."""
            ...

        return router
```

---

## 15. Plugin: Búsqueda Semántica

**Proyecto base:** CLIP/SigLIP + pgvector
**Modo:** Event-driven (genera embeddings de cada snapshot)

### Tecnología

- **Modelo:** `openai/clip-vit-base-patch32` (libre, ONNX disponible) o `google/siglip-base-patch16-224` (mejor accuracy)
- **Almacenamiento:** pgvector — misma extensión que el plugin facial
- **Hardware mínimo:** i7, 32 GB RAM (los embeddings CLIP son costosos en CPU, ~1s/imagen)
- **Sin NVIDIA:** funcional pero lento; con GPU cae a ~50ms/imagen

```python
# backend/app/plugins/enterprise/semantic_search/plugin.py

class SemanticSearchPlugin(BasePlugin):
    name = "semantic_search"
    version = "1.0.0"
    description = "Búsqueda semántica de eventos por descripción en lenguaje natural"
    supports_openvino = True
    min_ram_gb = 32

    async def on_load(self, config: dict) -> None:
        """
        Cargar modelo CLIP vía transformers o ONNX.
        Usar caché LRU para no recargar en cada evento.
        """
        from transformers import CLIPProcessor, CLIPModel
        model_name = config.get("model", "openai/clip-vit-base-patch32")
        self._model = CLIPModel.from_pretrained(model_name)
        self._processor = CLIPProcessor.from_pretrained(model_name)
        self._config = config
        await self._run_migrations()

    async def on_event(self, event: dict) -> None:
        """
        Generar embedding visual del snapshot y guardarlo en event_embeddings.
        No se genera alerta — este plugin es solo para búsqueda.
        """
        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        embedding = await self._get_image_embedding(snapshot_bytes)
        if embedding is None:
            return

        await self._save_embedding(event["id"], embedding)

    async def _get_image_embedding(self, image_bytes: bytes) -> list[float] | None:
        """
        Genera embedding visual de 512-d con CLIP.
        Ejecutar en threadpool para no bloquear el event loop.
        """
        import asyncio
        from PIL import Image
        import io
        import torch

        def _run():
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            inputs = self._processor(images=img, return_tensors="pt")
            with torch.no_grad():
                features = self._model.get_image_features(**inputs)
                # Normalizar para búsqueda por cosine similarity
                features = features / features.norm(dim=-1, keepdim=True)
            return features[0].tolist()

        return await asyncio.get_event_loop().run_in_executor(None, _run)

    async def _search_by_text(
        self, text_query: str, limit: int = 20
    ) -> list[dict]:
        """
        Buscar eventos por descripción en lenguaje natural.
        Genera embedding del texto y busca por similitud en pgvector.

        SQL:
          SELECT ee.event_id, 1-(ee.embedding <=> $1::vector) AS similarity, e.*
          FROM event_embeddings ee JOIN events e ON ee.event_id = e.id
          ORDER BY ee.embedding <=> $1::vector
          LIMIT $2
        """
        import torch

        inputs = self._processor(text=[text_query], return_tensors="pt", padding=True)
        with torch.no_grad():
            text_features = self._model.get_text_features(**inputs)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        text_embedding = text_features[0].tolist()
        # Ejecutar query pgvector
        ...

    def get_routes(self) -> APIRouter:
        router = APIRouter(prefix="/semantic_search")

        @router.get("/search")
        async def search(
            query: str,
            camera_id: str | None = None,
            after: float | None = None,
            before: float | None = None,
            limit: int = 20,
        ):
            """
            Búsqueda semántica.
            Ejemplos de query:
              "persona con ropa roja"
              "auto estacionado en la entrada"
              "grupo de personas caminando"
            """
            results = await self._search_by_text(query, limit)
            return results

        return router
```

### Schema SQL

```sql
CREATE TABLE event_embeddings (
  event_id BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  embedding vector(512),
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX event_embeddings_idx
  ON event_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 16. Plugin: Resumen IA de Eventos

**Proyecto base:** Qwen-VL / LLaVA local via Ollama
**Modo:** Event-driven (post-procesamiento asíncrono)

### Tecnología

- **Modelo preferido:** `Qwen/Qwen2-VL-7B-Instruct` via Ollama (buena relación calidad/RAM)
- **Alternativa liviana:** `llava:7b` via Ollama (7B parámetros, Q4_K_M ~4.5 GB)
- **Alternativa cloud:** GLM-4V-Flash (gratuito, API compatible OpenAI)
- **Hardware mínimo:** 32–64 GB RAM para modelos VLM locales de 7B
- **Sin NVIDIA:** posible con CPU pero muy lento (~60s por imagen en i7)
- **Integración con Jarvis:** puede delegar al nodo RTX 3090 vía Ollama

```python
# backend/app/plugins/enterprise/ai_summary/plugin.py

import httpx
import base64

class AISummaryPlugin(BasePlugin):
    name = "ai_summary"
    version = "1.0.0"
    description = "Resumen en lenguaje natural de eventos con VLM local o cloud"
    requires_gpu = True
    supports_openvino = False
    min_ram_gb = 32

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._ollama_url = config.get("ollama_url", "http://localhost:11434")
        self._model = config.get("model", "llava:7b")
        # Procesar en cola para no saturar el VLM
        import asyncio
        self._queue = asyncio.Queue(maxsize=50)
        asyncio.create_task(self._process_queue())

    async def on_event(self, event: dict) -> None:
        """
        Encolar evento para generación de resumen asíncrono.
        No bloquear el pipeline de eventos principal.
        Solo procesar eventos con snapshot y según filtros configurados.
        """
        if not event.get("has_snapshot"):
            return

        # Filtrar por label si está configurado
        monitored_labels = self._config.get("monitored_labels", [])
        if monitored_labels and event.get("label") not in monitored_labels:
            return

        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            pass  # Descartar si la cola está llena

    async def _process_queue(self):
        """Worker que procesa eventos de la cola uno por uno."""
        while True:
            event = await self._queue.get()
            try:
                await self._generate_summary(event)
            except Exception as e:
                pass  # Loggear pero no crashear
            finally:
                self._queue.task_done()

    async def _generate_summary(self, event: dict):
        snapshot_bytes = event.get("snapshot_bytes")
        if not snapshot_bytes:
            return

        # Construir prompt según el tipo de evento
        label = event.get("label", "objeto")
        camera = event.get("camera_name", "cámara")
        zones = ", ".join(event.get("zones", [])) or "sin zona específica"

        prompt = (
            f"Analiza esta imagen de cámara de seguridad. "
            f"Se detectó: {label} en {camera} (zona: {zones}). "
            f"Describe brevemente qué está ocurriendo en la imagen en 1-2 oraciones. "
            f"Sé específico y objetivo. Responde en español."
        )

        # Llamar a Ollama (compatible con LLaVA, Qwen-VL, etc.)
        image_b64 = base64.b64encode(snapshot_bytes).decode()
        summary = await self._call_ollama(prompt, image_b64)

        if summary:
            await self._save_summary(event["id"], summary)
            # Actualizar metadata del evento con el resumen
            await self._update_event_metadata(event["id"], {"ai_summary": summary})

    async def _call_ollama(self, prompt: str, image_b64: str) -> str | None:
        """
        Llamar a Ollama API con imagen.
        Compatible con llava, llava-phi3, qwen2-vl, bakllava.
        """
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(
                    f"{self._ollama_url}/api/generate",
                    json={
                        "model": self._model,
                        "prompt": prompt,
                        "images": [image_b64],
                        "stream": False,
                        "options": {
                            "temperature": 0.3,
                            "num_predict": 200,
                        },
                    },
                )
                resp.raise_for_status()
                return resp.json().get("response", "").strip()
            except Exception:
                return None

    async def _call_glm_cloud(self, prompt: str, image_b64: str) -> str | None:
        """
        Fallback a GLM-4V-Flash (cloud gratuito) si Ollama no está disponible.
        API compatible con OpenAI messages format.
        Requiere ZHIPU_API_KEY en config.
        """
        api_key = self._config.get("zhipu_api_key")
        if not api_key:
            return None

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "glm-4v-flash",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                                {"type": "text", "text": prompt},
                            ],
                        }
                    ],
                    "max_tokens": 200,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "ollama_url": {
                    "type": "string",
                    "default": "http://localhost:11434",
                    "description": "URL del servidor Ollama",
                },
                "model": {
                    "type": "string",
                    "default": "llava:7b",
                    "description": "Modelo VLM a usar (llava:7b, qwen2-vl:7b, llava-phi3)",
                },
                "zhipu_api_key": {
                    "type": "string",
                    "default": "",
                    "description": "API key de ZhipuAI para GLM-4V-Flash (fallback cloud gratuito)",
                },
                "monitored_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                    "description": "Labels a resumir (vacío = todos)",
                },
                "max_queue_size": {
                    "type": "integer",
                    "default": 50,
                    "description": "Tamaño máximo de cola de eventos pendientes",
                },
            },
        }
```

---

## 17. Infraestructura compartida y Docker

### docker-compose.enterprise.yml

Override del compose principal para agregar los servicios de los plugins enterprise.

```yaml
# docker-compose.enterprise.yml
# Usar con: docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up

services:

  # ── PaddleOCR / LPR / OCR General ──────────────────────────────
  # PaddleOCR se instala como dependencia Python en el backend.
  # No requiere servicio separado.
  # Agregar en backend/pyproject.toml:
  #   paddlepaddle == 2.6.1 (CPU)
  #   paddleocr == 2.7.3

  # ── InsightFace / Reconocimiento Facial ─────────────────────────
  # InsightFace se instala como dependencia Python.
  # Requiere pgvector en PostgreSQL.

  # ── pgvector (reemplaza postgres del compose base) ───────────────
  postgres:
    image: pgvector/pgvector:pg16
    # Reemplaza la imagen base. pgvector/pgvector incluye PostgreSQL 16
    # con la extensión vector ya compilada.
    # IMPORTANTE: cambiar la imagen en docker-compose.yml o usar este override.

  # ── Ollama (para plugin AI Summary) ─────────────────────────────
  ollama:
    image: ollama/ollama:latest
    container_name: opencctv-ollama
    restart: unless-stopped
    volumes:
      - ollama_models:/root/.ollama
    ports:
      - "11434:11434"
    # Con NVIDIA:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    # Sin NVIDIA: quitar el bloque deploy. Ollama corre en CPU (lento para VLM).
    environment:
      OLLAMA_HOST: "0.0.0.0"

  # ── Modelo Ollama (init container) ───────────────────────────────
  ollama-init:
    image: ollama/ollama:latest
    container_name: opencctv-ollama-init
    restart: no
    depends_on:
      - ollama
    entrypoint: >
      sh -c "sleep 5 && ollama pull llava:7b"
    environment:
      OLLAMA_HOST: ollama:11434

  backend:
    environment:
      # Agregar al backend del compose base:
      OLLAMA_URL: http://ollama:11434
      ENTERPRISE_PLUGINS_ENABLED: "true"
    volumes:
      # Directorio de modelos montado para persistencia
      - ./models:/models

volumes:
  ollama_models:
```

### Directorio de modelos

```
models/
├── lpr/
│   ├── plate_detector.pt         ← YOLO placa (descargar de HuggingFace)
│   └── plate_detector.onnx       ← exportado automáticamente en on_load
├── ppe/
│   ├── ppe_detector.pt
│   └── ppe_detector.onnx
├── fire_smoke/
│   ├── detector.pt
│   └── detector.onnx
└── .gitkeep
```

### Script de descarga de modelos (`scripts/download_models.sh`)

```bash
#!/bin/bash
# Descarga modelos pre-entrenados para los plugins enterprise
# Ejecutar una vez antes del primer deploy: ./scripts/download_models.sh

set -e
MODELS_DIR="./models"
mkdir -p "$MODELS_DIR/lpr" "$MODELS_DIR/ppe" "$MODELS_DIR/fire_smoke"

echo "Descargando modelo LPR (YOLO placa)..."
# Ejemplo con yolov8 de Ultralytics (reemplazar con modelo propio entrenado)
python3 -c "
from ultralytics import YOLO
# Modelo base — reemplazar con fine-tuned en placas argentinas
model = YOLO('yolov8n.pt')
model.save('$MODELS_DIR/lpr/plate_detector.pt')
print('LPR base guardado')
"

echo "Descargando modelo Fire/Smoke..."
python3 -c "
from ultralytics import YOLO
# Usar modelo D-Fire de Roboflow Universe o similar
model = YOLO('yolov8s.pt')
model.save('$MODELS_DIR/fire_smoke/detector.pt')
print('Fire/Smoke base guardado')
"

echo "Listo. Reemplazar modelos base con versiones fine-tuned para producción."
echo "Ver docs/enterprise-models.md para guía de entrenamiento."
```

---

## 18. Tabla de requerimientos de hardware

| Plugin | Hardware mínimo | Sin NVIDIA | Backend inferencia | FPS análisis | RAM modelo |
|--------|----------------|------------|-------------------|--------------|------------|
| LPR Avanzado | i5 10ª gen, 16 GB | ✅ PaddleOCR CPU + OpenVINO | YOLO ONNX + PaddleOCR | 5 fps snapshots | ~800 MB |
| Reconocimiento Facial | i5/i7, 16 GB | ✅ ONNX CPU / OpenVINO | InsightFace ONNX | 5 fps snapshots | ~1.2 GB |
| Merodeo | i5, 8–16 GB | ✅ 100% CPU | ByteTrack (no modelo) | event-driven | ~0 MB |
| Cruce de Línea | i5, 8 GB | ✅ 100% CPU | OpenCV geometría | event-driven | ~0 MB |
| Conteo | i5, 8–16 GB | ✅ 100% CPU | ByteTrack | event-driven | ~0 MB |
| Objeto Abandonado | i7, 16 GB | ✅ OpenVINO | YOLO ONNX | 1 fps | ~400 MB |
| EPP Casco/Chaleco | i7, 16 GB | ✅ OpenVINO | YOLO custom ONNX | 5 fps snapshots | ~400 MB |
| Detección de Caídas | i7, 16–32 GB | ✅ MediaPipe CPU | MediaPipe Pose | 5 fps | ~30 MB |
| Humo y Fuego | i5/i7, 16 GB | ✅ OpenVINO | YOLO custom ONNX | 0.5 fps | ~400 MB |
| Sabotaje de Cámara | i3/i5, 8 GB | ✅ 100% CPU | OpenCV / scikit-image | 0.1 fps | ~0 MB |
| OCR General | i7, 16 GB | ✅ PaddleOCR CPU | PaddleOCR | event-driven | ~600 MB |
| Búsqueda Semántica | i7, 32 GB | ✅ lento en CPU | CLIP ONNX | event-driven | ~600 MB |
| Resumen IA | 32–64 GB | ⚠️ Posible (lento) | Ollama VLM | event-driven | 4–14 GB |

**Notas:**
- "Sin NVIDIA" significa que el plugin funciona correctamente aunque con menor velocidad
- Para instalaciones con Intel Arc o iGPU: usar OpenVINO como backend universal
- El plugin Resumen IA en CPU toma ~60s por imagen en i7 — usar solo en instalaciones con GPU o delegar a Ollama externo
- MediaPipe para caídas no soporta OpenVINO nativamente pero su runtime propio es eficiente en CPU

---

## 19. Orden de implementación sugerido

```
FASE 1 — Infraestructura shared (base para todos)
  1. shared/inference_engine.py — abstracción YOLO/ONNX/OpenVINO
  2. shared/tracker.py — ByteTrack wrapper
  3. shared/frame_buffer.py — captura RTSP + Redis Streams
  4. shared/alert_service.py — emisión de alertas unificada
  5. Migrar PostgreSQL a imagen pgvector/pgvector:pg16

FASE 2 — Plugins event-driven sin modelo propio (rápidos de implementar)
  6. loitering — merodeo (solo lógica, ByteTrack ya disponible)
  7. line_crossing — cruce de línea (geometría pura)
  8. people_counting — conteo (extiende line_crossing)
  9. camera_sabotage — sabotaje (OpenCV, sin modelo)

FASE 3 — Plugins event-driven con modelo YOLO
  10. ppe_detection — EPP (modelo YOLO custom)
  11. fire_smoke — fuego/humo (modelo YOLO custom)
  12. abandoned_object — objeto abandonado

FASE 4 — Plugins de reconocimiento
  13. lpr_advanced — LPR con PaddleOCR
  14. ocr_general — OCR general
  15. face_recognition — facial con InsightFace + pgvector

FASE 5 — Plugins de IA avanzada
  16. semantic_search — CLIP + pgvector
  17. fall_detection — MediaPipe Pose
  18. ai_summary — Ollama VLM

FASE 6 — Integración con UI de OpenCCTV
  19. Agregar tab "Alertas Enterprise" en LiveView sidebar
  20. Página /enterprise-analytics con dashboards por plugin
  21. Configuración de plugins enterprise en /frigate-config
  22. Wizard de zonas (dibujar polígonos sobre snapshot para merodeo/cruce)
```

---

*Documento generado para el proyecto OpenCCTV VMS — Versión Enterprise*
*Stack validado: Python 3.12 · FastAPI · PostgreSQL 16 + pgvector · ByteTrack · PaddleOCR 2.7 · InsightFace · MediaPipe · Ultralytics YOLOv8 · Ollama*
