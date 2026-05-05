import asyncio
import logging
from asyncio import QueueEmpty
from datetime import UTC, datetime

from app.database import AsyncSessionLocal
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


class AISummaryPlugin(BasePlugin):
    name = "ai_summary"
    version = "1.0.0"
    description = "Generación de resúmenes IA de eventos mediante Ollama VLM"
    requires_gpu = False
    supports_openvino = False
    min_ram_gb = 6
    category = "ai"
    has_sidebar_page = True
    sidebar_icon = "🤖"
    sidebar_label = "Resumen IA"
    sidebar_route = "ai_summary"

    def __init__(self):
        self._config: dict = {}
        self._ollama_url: str = ""
        self._model: str = "llava"
        self._event_queue: asyncio.Queue = asyncio.Queue()
        self._processing = False
        self._summary_cache: dict = {}

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._ollama_url = config.get("ollama_url", "http://localhost:11434")
        self._model = config.get("model", "llava")

        asyncio.create_task(self._process_event_queue())
        log.info("AI Summary plugin loaded with model: %s", self._model)

    async def _process_event_queue(self) -> None:
        self._processing = True
        while self._processing:
            try:
                event_data = await asyncio.wait_for(
                    self._event_queue.get(),
                    timeout=5.0
                )
                await self._generate_summary(event_data)
            except TimeoutError:
                continue
            except Exception as exc:
                log.error("Error processing event queue: %s", exc)

    async def on_event(self, event: dict) -> None:
        label = event.get("label", "")
        camera_id = event.get("camera_id", "")

        if not self._should_summarize(event):
            return

        event_data = {
            "event_id": event.get("id"),
            "camera_id": camera_id,
            "camera_name": event.get("camera_name", ""),
            "label": label,
            "sub_label": event.get("sub_label"),
            "severity": event.get("severity"),
            "start_time": event.get("start_time"),
            "score": event.get("score"),
            "has_snapshot": event.get("has_snapshot", False),
            "metadata": event.get("metadata", {}),
        }

        try:
            await asyncio.wait_for(
                self._event_queue.put(event_data),
                timeout=1.0
            )
        except TimeoutError:
            log.warning("Event queue full, skipping summary generation")

    def _should_summarize(self, event: dict) -> bool:
        severity = event.get("severity", "low")
        severity_priority = {"critical": 3, "high": 2, "medium": 1, "low": 0}

        min_severity = self._config.get("min_severity", "medium")
        if severity_priority.get(severity, 0) < severity_priority.get(min_severity, 1):
            return False

        label = event.get("label", "")
        excluded_labels = self._config.get("excluded_labels", [])
        if label in excluded_labels:
            return False

        return True

    async def _generate_summary(self, event_data: dict) -> None:
        cache_key = f"{event_data['camera_id']}_{event_data['event_id']}"
        if cache_key in self._summary_cache:
            return

        prompt = self._build_prompt(event_data)

        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import select

                from app.models.event import Event as EventModel

                result = await db.execute(
                    select(EventModel).where(EventModel.id == event_data["event_id"])
                )
                db_event = result.scalar_one_or_none()
                if db_event:
                    snapshot_bytes = None
                    if db_event.snapshot_path:
                        try:
                            import httpx
                            async with httpx.AsyncClient() as client:
                                snapshot_url = f"{self._ollama_url.replace('/api/generate', '')}/{db_event.snapshot_path}"
                                resp = await client.get(snapshot_url, timeout=10.0)
                                if resp.status_code == 200:
                                    snapshot_bytes = resp.content
                        except Exception:
                            pass

                    summary = await self._call_ollama_vision(prompt, snapshot_bytes)

                    if summary:
                        self._summary_cache[cache_key] = summary
                        await self._save_summary(
                            event_data["event_id"],
                            summary,
                            event_data["camera_id"],
                        )
        except Exception as exc:
            log.error("Failed to generate summary: %s", exc)

    def _build_prompt(self, event_data: dict) -> str:
        label = event_data.get("label", "unknown")
        severity = event_data.get("severity", "unknown")
        camera_name = event_data.get("camera_name", "unknown camera")
        sub_label = event_data.get("sub_label", "")
        score = event_data.get("score", 0)

        base_prompt = f"""Analiza el siguiente evento de videovigilancia y genera un resumen ejecutivo:

Tipo de evento: {label}
Severidad: {severity}
Cámara: {camera_name}
{sub_label and f'Información adicional: {sub_label}'}
Confianza: {score}
"""

        custom_prompt = self._config.get(
            "prompt_template",
            "Proporciona un resumen breve (2-3 oraciones) del evento y recomienda acciones de seguimiento si es necesario."
        )

        return f"{base_prompt}\n\n{custom_prompt}"

    async def _call_ollama_vision(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
    ) -> str | None:
        try:
            import httpx

            payload = {
                "model": self._model,
                "prompt": prompt,
                "stream": False,
            }

            if image_bytes:
                import base64
                image_b64 = base64.b64encode(image_bytes).decode()
                payload["images"] = [image_b64]

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self._ollama_url}/api/generate",
                    json=payload,
                )

                if response.status_code == 200:
                    result = response.json()
                    return result.get("response", "").strip()

        except Exception as exc:
            log.error("Ollama API call failed: %s", exc)

        return None

    async def _save_summary(
        self,
        event_id: int,
        summary: str,
        camera_id: str,
    ) -> None:
        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import select, update

                from app.models.event import Event as EventModel

                result = await db.execute(
                    select(EventModel).where(EventModel.id == event_id)
                )
                event = result.scalar_one_or_none()

                if event:
                    metadata = event.extra_metadata or {}
                    metadata["ai_summary"] = summary
                    metadata["ai_summary_generated_at"] = datetime.now(UTC).isoformat()

                    await db.execute(
                        update(EventModel)
                        .where(EventModel.id == event_id)
                        .values(extra_metadata=metadata)
                    )
                    await db.commit()

        except Exception as exc:
            log.error("Failed to save summary: %s", exc)

    async def generate_live_summary(
        self,
        camera_id: str,
        frame_bytes: bytes,
        event_context: str = "",
    ) -> str | None:
        prompt = f"""Analiza la escena actual de videovigilancia y proporciona un resumen de lo que está sucediendo:

{event_context}

Describe brevemente (1-2 oraciones) la situación actual."""

        return await self._call_ollama_vision(prompt, frame_bytes)

    async def generate_batch_summary(
        self,
        event_ids: list[int],
    ) -> dict[int, str]:
        results = {}

        for event_id in event_ids:
            cache_key = f"batch_{event_id}"
            if cache_key in self._summary_cache:
                results[event_id] = self._summary_cache[cache_key]
                continue

            async with AsyncSessionLocal() as db:
                from sqlalchemy import select

                from app.models.event import Event as EventModel

                result = await db.execute(
                    select(EventModel).where(EventModel.id == event_id)
                )
                event = result.scalar_one_or_none()

                if event:
                    event_data = {
                        "event_id": event.id,
                        "camera_id": event.camera_id,
                        "camera_name": "",
                        "label": event.label,
                        "sub_label": event.sub_label,
                        "severity": event.severity,
                        "start_time": event.start_time.isoformat() if event.start_time else None,
                        "score": float(event.score) if event.score else 0,
                        "metadata": event.metadata or {},
                    }
                    prompt = self._build_prompt(event_data)
                    summary = await self._call_ollama_vision(prompt)
                    if summary:
                        results[event_id] = summary
                        self._summary_cache[cache_key] = summary

        return results

    async def on_unload(self) -> None:
        self._processing = False
        try:
            while not self._event_queue.empty():
                try:
                    self._event_queue.get_nowait()
                except QueueEmpty:
                    break
        except Exception:
            pass
        self._summary_cache.clear()
        log.info("AI Summary plugin unloaded")

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
                    "default": "llava",
                    "description": "Modelo VLM a usar (llava, llava-llama3, etc.)",
                },
                "min_severity": {
                    "type": "string",
                    "default": "medium",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": "Severidad mínima de evento para resumir",
                },
                "excluded_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                    "description": "Etiquetas de eventos a excluir",
                },
                "prompt_template": {
                    "type": "string",
                    "default": "Proporciona un resumen breve (2-3 oraciones) del evento y recomienda acciones de seguimiento si es necesario.",
                    "description": "Plantilla de prompt personalizada",
                },
                "queue_size": {
                    "type": "integer",
                    "default": 100,
                    "description": "Tamaño máximo de la cola de procesamiento",
                },
            },
        }

    def get_routes(self) -> "APIRouter":
        from fastapi import APIRouter, Depends, Query
        from pydantic import BaseModel

        from app.deps import get_current_user

        router = APIRouter()
        plugin_self = self

        class QueueStatus(BaseModel):
            size: int
            processing: bool
            cache_entries: int

        class SummaryOut(BaseModel):
            event_id: int
            camera_id: str | None
            summary: str | None
            generated_at: str | None

        @router.get("/queue-status", response_model=QueueStatus)
        async def queue_status(_=Depends(get_current_user)):
            return {
                "size": plugin_self._event_queue.qsize(),
                "processing": plugin_self._processing,
                "cache_entries": len(plugin_self._summary_cache),
            }

        @router.get("/summaries", response_model=list[SummaryOut])
        async def get_summaries(
            camera_id: str | None = Query(None),
            limit: int = Query(50, ge=1, le=200),
            _=Depends(get_current_user),
        ):
            from sqlalchemy import select

            from app.models.event import Event as EventModel

            async with AsyncSessionLocal() as db:
                q = select(EventModel).where(
                    EventModel.extra_metadata.has_key("ai_summary")
                )
                if camera_id:
                    q = q.where(EventModel.camera_id == camera_id)
                q = q.order_by(EventModel.start_time.desc()).limit(limit)
                result = await db.execute(q)
                events = result.scalars().all()

            return [
                {
                    "event_id": e.id,
                    "camera_id": e.camera_id,
                    "summary": e.extra_metadata.get("ai_summary"),
                    "generated_at": e.extra_metadata.get("ai_summary_generated_at"),
                }
                for e in events
            ]

        @router.post("/summaries/generate", status_code=202)
        async def trigger_summary(
            event_ids: list[int],
            _=Depends(get_current_user),
        ):
            count = 0
            for eid in event_ids:
                event_data = {
                    "event_id": eid,
                    "camera_id": "",
                    "camera_name": "",
                    "label": "",
                    "severity": "medium",
                }
                try:
                    plugin_self._event_queue.put_nowait(event_data)
                    count += 1
                except Exception:
                    break
            return {"queued": count, "total": len(event_ids)}

        return router
