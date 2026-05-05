import json
import logging
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.database import AsyncSessionLocal
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


class SearchResult(BaseModel):
    id: int
    camera_id: Optional[str]
    event_time: Optional[str]
    description: Optional[str]
    similarity: float
    metadata: dict


class SearchResponse(BaseModel):
    results: list[SearchResult]
    query: str
    total: int


class SemanticSearchPlugin(BasePlugin):
    name = "semantic_search"
    version = "1.0.0"
    description = "Búsqueda semántica mediante CLIP y pgvector"
    display_name = "Búsqueda Semántica"
    requires_gpu = True
    supports_openvino = False
    min_ram_gb = 8
    category = "ai"
    has_sidebar_page = True
    sidebar_icon = "🔍"
    sidebar_label = "Búsqueda Semántica"
    sidebar_route = "semantic_search"

    def __init__(self):
        self._config: dict = {}
        self._clip_model = None
        self._clip_preprocess = None
        self._device = "cuda"
        self._initialized = False

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._device = "cuda" if config.get("use_gpu", True) else "cpu"

        if not await self._ensure_pgvector_tables():
            log.warning("semantic_search: pgvector not available — plugin disabled until the database provides vector")
            self._initialized = False
            return

        try:
            import os
            import torch
            from PIL import Image
            import clip

            clip_cache = os.path.join(
                os.environ.get("MODELS_DIR", "/models"), ".cache", "clip"
            )
            self._clip_model, self._clip_preprocess = clip.load(
                config.get("clip_model", "ViT-B/32"),
                device=self._device,
                download_root=clip_cache,
            )
            self._initialized = True
            log.info("CLIP model loaded from %s", clip_cache)
        except Exception as exc:
            log.error("Failed to load CLIP model: %s", exc)
            self._initialized = False

    async def _ensure_pgvector_tables(self) -> bool:
        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import text
                await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                await db.execute(text("""
                    CREATE TABLE IF NOT EXISTS semantic_events (
                        id SERIAL PRIMARY KEY,
                        camera_id TEXT,
                        event_time TIMESTAMPTZ,
                        description TEXT,
                        image_embedding vector(512),
                        text_embedding vector(512),
                        thumbnail_bytes BYTEA,
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """))
                await db.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_semantic_events_image
                    ON semantic_events USING ivfflat (image_embedding vector_cosine_ops)
                """))
                await db.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_semantic_events_text
                    ON semantic_events USING ivfflat (text_embedding vector_cosine_ops)
                """))
                await db.commit()
                return True
        except Exception as exc:
            log.warning("pgvector tables setup failed: %s", exc)
            return False

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        # Semantic indexing is expensive and writes embeddings to Postgres.
        # Keep the plugin active, but only process explicitly configured cameras.
        return self._config.get("enabled_cameras") or []

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        if not self._initialized:
            return

        interval = self._config.get("embedding_interval", 30)
        if hasattr(self, "_last_embedding_time"):
            if timestamp - self._last_embedding_time.get(camera_name, 0) < interval:
                return

        self._last_embedding_time = getattr(self, "_last_embedding_time", {})
        self._last_embedding_time[camera_name] = timestamp

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        try:
            import torch
            from PIL import Image
            pil_image = Image.fromarray(rgb_image)

            image_input = self._clip_preprocess(pil_image).unsqueeze(0).to(self._device)

            with torch.no_grad():
                image_embedding = self._clip_model.encode_image(image_input)

            embedding_list = image_embedding.cpu().numpy().flatten().tolist()

            await self._store_embedding(
                camera_name=camera_name,
                timestamp=timestamp,
                image_embedding=embedding_list,
                thumbnail_bytes=frame,
            )

        except Exception as exc:
            log.warning("Embedding generation failed: %s", exc)

    async def _store_embedding(
        self,
        camera_name: str,
        timestamp: float,
        image_embedding: list,
        thumbnail_bytes: bytes,
        description: Optional[str] = None,
    ) -> None:
        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import text
                embedding_str = "[" + ",".join(map(str, image_embedding)) + "]"
                await db.execute(text("""
                    INSERT INTO semantic_events
                    (camera_id, event_time, image_embedding, thumbnail_bytes, description, extra_data)
                    VALUES (:camera_id, :event_time, :embedding, :thumbnail, :description, :extra_data)
                """), {
                    "camera_id": camera_name,
                    "event_time": datetime.fromtimestamp(timestamp, tz=timezone.utc),
                    "embedding": embedding_str,
                    "thumbnail": thumbnail_bytes,
                    "description": description,
                    "extra_data": json.dumps({"source": "semantic_search_plugin"}),
                })
                await db.commit()
        except Exception as exc:
            log.warning("Failed to store embedding: %s", exc)

    async def search_by_text(
        self,
        query: str,
        camera_id: Optional[str] = None,
        limit: int = 10,
        threshold: float = 0.25,
    ) -> list[dict]:
        if not self._initialized:
            return []

        try:
            import torch
            import clip

            text_input = clip.tokenize([query]).to(self._device)
            with torch.no_grad():
                text_embedding = self._clip_model.encode_text(text_input)
            embedding_list = text_embedding.cpu().numpy().flatten().tolist()

            async with AsyncSessionLocal() as db:
                from sqlalchemy import select, text
                embedding_str = "[" + ",".join(map(str, embedding_list)) + "]"
                sql = f"""
                    SELECT id, camera_id, event_time, description,
                           1 - (image_embedding <=> '{embedding_str}'::vector) AS similarity,
                           extra_data
                    FROM semantic_events
                    WHERE image_embedding IS NOT NULL
                      AND 1 - (image_embedding <=> '{embedding_str}'::vector) > :threshold
                """
                params = {"threshold": threshold, "limit": limit}
                if camera_id:
                    sql += " AND camera_id = :camera_id"
                    params["camera_id"] = camera_id
                sql += f" ORDER BY image_embedding <=> '{embedding_str}'::vector LIMIT :limit"

                result = await db.execute(text(sql), params)
                rows = result.fetchall()

                return [
                    {
                        "id": row[0],
                        "camera_id": row[1],
                        "event_time": row[2].isoformat() if row[2] else None,
                        "description": row[3],
                        "similarity": float(row[4]),
                        "metadata": row[5] if isinstance(row[5], dict) else {},
                    }
                    for row in rows
                ]
        except Exception as exc:
            log.error("Text search failed: %s", exc)
            return []

    async def search_by_image(
        self,
        image_bytes: bytes,
        camera_id: Optional[str] = None,
        limit: int = 10,
        threshold: float = 0.25,
    ) -> list[dict]:
        if not self._initialized:
            return []

        try:
            import torch
            from PIL import Image

            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                return []

            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_image)

            image_input = self._clip_preprocess(pil_image).unsqueeze(0).to(self._device)
            with torch.no_grad():
                image_embedding = self._clip_model.encode_image(image_input)
            embedding_list = image_embedding.cpu().numpy().flatten().tolist()

            async with AsyncSessionLocal() as db:
                from sqlalchemy import text
                embedding_str = "[" + ",".join(map(str, embedding_list)) + "]"
                sql = f"""
                    SELECT id, camera_id, event_time, description,
                           1 - (image_embedding <=> '{embedding_str}'::vector) AS similarity,
                           extra_data
                    FROM semantic_events
                    WHERE 1 - (image_embedding <=> '{embedding_str}'::vector) > :threshold
                """
                params = {"threshold": threshold, "limit": limit}
                if camera_id:
                    sql += " AND camera_id = :camera_id"
                    params["camera_id"] = camera_id
                sql += f" ORDER BY image_embedding <=> '{embedding_str}'::vector LIMIT :limit"

                result = await db.execute(text(sql), params)
                rows = result.fetchall()

                return [
                    {
                        "id": row[0],
                        "camera_id": row[1],
                        "event_time": row[2].isoformat() if row[2] else None,
                        "description": row[3],
                        "similarity": float(row[4]),
                        "metadata": row[5] if isinstance(row[5], dict) else {},
                    }
                    for row in rows
                ]
        except Exception as exc:
            log.error("Image search failed: %s", exc)
            return []

    def get_routes(self) -> APIRouter:
        router = APIRouter()
        plugin_self = self

        @router.get("/search", response_model=SearchResponse)
        async def text_search(
            q: str = Query(..., description="Descripción textual a buscar"),
            camera_id: Optional[str] = Query(None),
            limit: int = Query(10, ge=1, le=50),
            threshold: float = Query(0.25, ge=0.0, le=1.0),
        ):
            results = await plugin_self.search_by_text(
                query=q, camera_id=camera_id, limit=limit, threshold=threshold
            )
            return SearchResponse(
                results=[SearchResult(**r) for r in results],
                query=q,
                total=len(results),
            )

        @router.get("/stats")
        async def semantic_stats():
            try:
                async with AsyncSessionLocal() as db:
                    from sqlalchemy import text
                    result = await db.execute(text(
                        "SELECT COUNT(*), MIN(event_time), MAX(event_time) FROM semantic_events"
                    ))
                    row = result.fetchone()
                    return {
                        "total_embeddings": int(row[0]) if row else 0,
                        "oldest": row[1].isoformat() if row and row[1] else None,
                        "newest": row[2].isoformat() if row and row[2] else None,
                        "initialized": plugin_self._initialized,
                    }
            except Exception:
                return {"total_embeddings": 0, "oldest": None, "newest": None, "initialized": False}

        return router

    async def on_unload(self) -> None:
        self._clip_model = None
        self._clip_preprocess = None

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "clip_model": {
                    "type": "string",
                    "default": "ViT-B/32",
                    "description": "Modelo CLIP (ViT-B/32, ViT-B/16, ViT-L/14)",
                },
                "use_gpu": {
                    "type": "boolean",
                    "default": True,
                },
                "embedding_interval": {
                    "type": "number",
                    "default": 30,
                    "description": "Intervalo entre embeddings (segundos)",
                },
                "similarity_threshold": {
                    "type": "number",
                    "default": 0.25,
                    "minimum": 0,
                    "maximum": 1,
                },
                "max_results": {
                    "type": "integer",
                    "default": 10,
                },
                "enabled_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cámaras a procesar (vacío = todas)",
                },
            },
        }
