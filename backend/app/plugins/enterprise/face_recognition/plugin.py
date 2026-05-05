import ast
import json
import logging
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from app.database import AsyncSessionLocal
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


@dataclass
class FaceInfo:
    face_id: int
    bbox: list
    embedding: np.ndarray
    embedding_bytes: bytes
    confidence: float


class FaceRecognitionPlugin(BasePlugin):
    name = "face_recognition"
    display_name = "Reconocimiento Facial"
    version = "1.0.0"
    description = "Identifica rostros registrados en galería usando InsightFace + búsqueda vectorial con pgvector"
    requires_gpu = True
    supports_openvino = False
    min_ram_gb = 8
    category = "recognition"
    has_sidebar_page = True
    sidebar_icon = "👤"
    sidebar_label = "Rostros"
    sidebar_route = "face_recognition"

    def __init__(self):
        self._config: dict = {}
        self._app = None
        self._model = None
        self._last_detection_time: dict[str, float] = {}
        self._embedding_cache: dict[str, list] = {}
        self._pgvector_available: bool = False

    async def on_load(self, config: dict) -> None:
        self._config = config

        if config.get("preload_model", False):
            self._ensure_model_loaded()

        await self._ensure_pgvector_extension()

    def _ensure_model_loaded(self) -> bool:
        if self._app is not None:
            return True
        try:
            import os
            from insightface.app import FaceAnalysis
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if self._config.get("use_gpu") is False:
                providers = ["CPUExecutionProvider"]
            # Prefer config root, then env-based cache dir, then insightface default
            model_root = self._config.get(
                "model_root",
                os.path.join(os.environ.get("MODELS_DIR", "/models"), ".cache", "insightface"),
            )
            self._app = FaceAnalysis(
                name=self._config.get("model_name", "buffalo_l"),
                root=model_root,
                providers=providers,
            )
            ctx_id = 0 if self._config.get("use_gpu", True) else -1
            self._app.prepare(ctx_id=ctx_id, det_size=(640, 640))
            log.info("InsightFace loaded from %s", model_root)
            return True
        except Exception as exc:
            log.error("Failed to initialize InsightFace: %s", exc)
            self._app = None
            return False

    async def _ensure_pgvector_extension(self) -> None:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            # Try to enable pgvector; falls back to TEXT embedding if unavailable
            try:
                await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                await db.execute(text("""
                    CREATE TABLE IF NOT EXISTS face_embeddings (
                        id SERIAL PRIMARY KEY,
                        person_name TEXT NOT NULL,
                        person_id TEXT,
                        embedding vector(512),
                        image_bytes BYTEA,
                        camera_id TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        metadata JSONB DEFAULT '{}'
                    )
                """))
                await db.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_face_embeddings_cosine
                    ON face_embeddings USING ivfflat (embedding vector_cosine_ops)
                    WITH (lists = 100)
                """))
                await db.commit()
                self._pgvector_available = True
                log.info("face_recognition: pgvector tables ready")
                return
            except Exception:
                await db.rollback()

            # Fallback: create table without vector column (similarity search disabled)
            try:
                await db.execute(text("""
                    CREATE TABLE IF NOT EXISTS face_embeddings (
                        id SERIAL PRIMARY KEY,
                        person_name TEXT NOT NULL,
                        person_id TEXT,
                        embedding TEXT,
                        image_bytes BYTEA,
                        camera_id TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        metadata JSONB DEFAULT '{}'
                    )
                """))
                await db.commit()
                self._pgvector_available = False
                log.warning("face_recognition: pgvector not available — similarity search disabled, using TEXT fallback")
            except Exception as exc:
                await db.rollback()
                log.error("face_recognition: table setup failed: %s", exc)

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        return self._config.get("enabled_cameras") or []

    @staticmethod
    def _registered_where_clause(alias: str = "") -> str:
        prefix = f"{alias}." if alias else ""
        return (
            f"{prefix}person_name != 'unknown' "
            f"AND {prefix}person_name NOT LIKE 'face\\_%' ESCAPE '\\' "
            f"AND {prefix}person_name NOT LIKE 'frigate\\_%' ESCAPE '\\'"
        )

    @staticmethod
    def _unknown_where_clause(alias: str = "") -> str:
        prefix = f"{alias}." if alias else ""
        return (
            f"{prefix}person_name = 'unknown' "
            f"OR {prefix}person_name LIKE 'face\\_%' ESCAPE '\\' "
            f"OR {prefix}person_name LIKE 'frigate\\_%' ESCAPE '\\'"
        )

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        if not self._ensure_model_loaded():
            return

        cooldown = self._config.get("detection_cooldown", 5)
        if camera_name in self._last_detection_time:
            if timestamp - self._last_detection_time[camera_name] < cooldown:
                return

        self._last_detection_time[camera_name] = timestamp

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        try:
            faces = self._app.get(image)
        except Exception as exc:
            log.warning("Face detection failed: %s", exc)
            return

        if not faces:
            return

        _, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])

        for face in faces:
            det_score = float(face.det_score) if hasattr(face, "det_score") else 0.5
            if det_score < self._config.get("min_face_confidence", 0.5):
                continue

            embedding = face.embedding
            if embedding is None or len(embedding) == 0:
                continue

            embedding_list = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)

            match_result = await self._search_similar_faces(
                embedding_list,
                threshold=self._config.get("similarity_threshold", 0.5),
            )

            if match_result:
                person_name, similarity, db_id = match_result
                await self.emit_alert(
                    camera_id=camera_name,
                    alert_type="face_recognized",
                    severity=self._config.get("alert_severity", "medium"),
                    data={
                        "person_name": person_name,
                        "similarity": float(similarity),
                        "camera_name": camera_name,
                        "bbox": face.bbox.tolist() if hasattr(face.bbox, 'tolist') else list(face.bbox),
                        "confidence": det_score,
                        "db_id": db_id,
                    },
                    snapshot_bytes=jpeg.tobytes(),
                )
            else:
                await self._store_unknown_face(
                    embedding_list, camera_name, face, jpeg.tobytes()
                )

    async def _search_similar_faces(
        self,
        embedding: list,
        threshold: float = 0.5,
        limit: int = 1,
    ) -> Optional[tuple]:
        if not self._pgvector_available:
            return await self._search_similar_faces_python(embedding, threshold, limit)

        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import select, text
                embedding_str = "[" + ",".join(map(str, embedding)) + "]"
                result = await db.execute(text(f"""
                    SELECT person_name, 1 - (embedding <=> '{embedding_str}'::vector) AS similarity, id
                    FROM face_embeddings
                    WHERE 1 - (embedding <=> '{embedding_str}'::vector) > :threshold
                    ORDER BY embedding <=> '{embedding_str}'::vector
                    LIMIT :limit
                """), {"threshold": threshold, "limit": limit})
                row = result.fetchone()
                if row:
                    return (row[0], row[1], row[2])
        except Exception as exc:
            log.warning("pgvector search failed: %s", exc)
        return None

    async def _search_similar_faces_python(
        self,
        embedding: list,
        threshold: float = 0.5,
        limit: int = 1,
    ) -> Optional[tuple]:
        query = np.asarray(embedding, dtype=np.float32)
        query_norm = np.linalg.norm(query)
        if query_norm == 0:
            return None

        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import text

                result = await db.execute(text("""
                    SELECT id, person_name, embedding
                    FROM face_embeddings
                    WHERE person_name != 'unknown'
                      AND person_name NOT LIKE 'face\\_%' ESCAPE '\\'
                      AND person_name NOT LIKE 'frigate\\_%' ESCAPE '\\'
                    ORDER BY created_at DESC
                    LIMIT 500
                """))
                best: tuple[str, float, int] | None = None
                for row in result.fetchall():
                    stored = self._parse_embedding(row[2])
                    if not stored:
                        continue
                    candidate = np.asarray(stored, dtype=np.float32)
                    candidate_norm = np.linalg.norm(candidate)
                    if candidate_norm == 0 or candidate.shape != query.shape:
                        continue
                    similarity = float(np.dot(query, candidate) / (query_norm * candidate_norm))
                    if similarity >= threshold and (best is None or similarity > best[1]):
                        best = (row[1], similarity, row[0])
                return best
        except Exception as exc:
            log.warning("fallback face search failed: %s", exc)
            return None

    @staticmethod
    def _parse_embedding(value) -> list[float]:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                try:
                    parsed = ast.literal_eval(value)
                except (ValueError, SyntaxError):
                    return []
            return parsed if isinstance(parsed, list) else []
        return []

    async def _store_unknown_face(
        self,
        embedding: list,
        camera_name: str,
        face,
        image_bytes: bytes,
    ) -> None:
        if not self._config.get("store_unknown_faces", True):
            return

        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import text
                embedding_str = "[" + ",".join(map(str, embedding)) + "]"
                await db.execute(text("""
                    INSERT INTO face_embeddings (person_name, embedding, camera_id, image_bytes, extra_data)
                    VALUES ('unknown', :embedding, :camera_id, :image_bytes, :extra_data)
                """), {
                    "embedding": embedding_str,
                    "camera_id": camera_name,
                    "image_bytes": image_bytes,
                    "extra_data": json.dumps({
                        "det_score": float(face.det_score) if hasattr(face, 'det_score') else 0,
                        "bbox": face.bbox.tolist() if hasattr(face.bbox, 'tolist') else [],
                    }),
                })
                await db.commit()
        except Exception as exc:
            log.warning("Failed to store unknown face: %s", exc)

    async def register_face(
        self,
        person_name: str,
        person_id: Optional[str],
        image_bytes: bytes,
        metadata: dict,
    ) -> bool:
        if not self._ensure_model_loaded():
            return False

        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return False

        try:
            faces = self._app.get(image)
            if not faces:
                return False

            face = faces[0]
            embedding = face.embedding
            embedding_list = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)
            detected_metadata = {
                **metadata,
                "det_score": float(face.det_score) if hasattr(face, "det_score") else 0,
                "bbox": face.bbox.tolist() if hasattr(face.bbox, "tolist") else list(face.bbox),
            }

            async with AsyncSessionLocal() as db:
                from sqlalchemy import text
                embedding_str = "[" + ",".join(map(str, embedding_list)) + "]"
                await db.execute(text("""
                    INSERT INTO face_embeddings (person_name, person_id, embedding, image_bytes, extra_data)
                    VALUES (:name, :person_id, :embedding, :image_bytes, :extra_data)
                """), {
                    "name": person_name,
                    "person_id": person_id,
                    "embedding": embedding_str,
                    "image_bytes": image_bytes,
                    "extra_data": json.dumps(detected_metadata),
                })
                await db.commit()
            return True

        except Exception as exc:
            log.error("Failed to register face: %s", exc)
            return False

    async def search_face(
        self,
        image_bytes: bytes,
        threshold: float = 0.5,
    ) -> Optional[dict]:
        if not self._ensure_model_loaded():
            return None

        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return None

        try:
            faces = self._app.get(image)
            if not faces:
                return None

            face = faces[0]
            embedding = face.embedding
            embedding_list = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)

            result = await self._search_similar_faces(embedding_list, threshold)
            if result:
                return {
                    "person_name": result[0],
                    "similarity": float(result[1]),
                    "db_id": result[2],
                }
        except Exception as exc:
            log.warning("Face search failed: %s", exc)
        return None

    async def on_unload(self) -> None:
        self._app = None
        self._embedding_cache.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "title": "Configuración Reconocimiento Facial",
            "properties": {
                "model_name": {
                    "type": "string",
                    "title": "Modelo InsightFace",
                    "description": "buffalo_l (mejor precisión), buffalo_m (balance), buffalo_s (rápido)",
                    "enum": ["buffalo_l", "buffalo_m", "buffalo_s"],
                    "default": "buffalo_l",
                },
                "detection_cooldown": {
                    "type": "number",
                    "title": "Cooldown detección (s)",
                    "description": "Segundos entre detecciones por cámara",
                    "default": 5.0,
                    "minimum": 0.5,
                    "maximum": 60.0,
                },
                "similarity_threshold": {
                    "type": "number",
                    "title": "Umbral de similitud",
                    "description": "0.5 = 50% mínimo de similitud para reconocer",
                    "default": 0.5,
                    "minimum": 0.1,
                    "maximum": 1.0,
                },
                "min_face_confidence": {
                    "type": "number",
                    "title": "Confianza mínima de rostro",
                    "description": "Filtra detecciones faciales débiles antes de buscar coincidencias",
                    "default": 0.5,
                    "minimum": 0.1,
                    "maximum": 1.0,
                },
                "use_gpu": {
                    "type": "boolean",
                    "title": "Usar GPU",
                    "description": "Usa CUDA si está disponible; si se desactiva, InsightFace corre en CPU",
                    "default": True,
                },
                "alert_severity": {
                    "type": "string",
                    "title": "Severidad de alerta",
                    "enum": ["low", "medium", "high", "critical"],
                    "default": "medium",
                },
                "store_unknown_faces": {
                    "type": "boolean",
                    "title": "Almacenar rostros desconocidos",
                    "description": "Guarda rostros no reconocidos para revisión manual posterior",
                    "default": True,
                },
                "enabled_cameras": {
                    "type": "array",
                    "title": "Cámaras habilitadas",
                    "description": "Dejar vacío para monitorear todas las cámaras",
                    "items": {"type": "string"},
                    "default": [],
                },
            },
        }

    def get_routes(self):
        from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException, status
        from fastapi.responses import Response
        from app.deps import get_current_user, require_operator
        from app.database import AsyncSessionLocal

        plugin_self = self
        router = APIRouter()

        @router.get("/faces")
        async def list_faces(
            person_name: str | None = None,
            limit: int = 50,
            _=Depends(get_current_user),
        ):
            from sqlalchemy import text
            try:
                async with AsyncSessionLocal() as db:
                    params: dict = {"limit": limit}
                    where = f"WHERE {plugin_self._registered_where_clause()}"
                    if person_name:
                        where += " AND person_name ILIKE :name"
                        params["name"] = f"%{person_name}%"
                    result = await db.execute(text(f"""
                        SELECT id, person_name, person_id, camera_id, created_at, metadata
                        FROM face_embeddings {where}
                        ORDER BY created_at DESC LIMIT :limit
                    """), params)
                    rows = result.fetchall()
                return [
                    {
                        "id": r[0], "person_name": r[1], "person_id": r[2],
                        "camera_id": r[3],
                        "created_at": r[4].isoformat() if r[4] else None,
                        "metadata": r[5] or {},
                    }
                    for r in rows
                ]
            except Exception:
                return []

        @router.get("/unknowns")
        async def list_unknowns(
            limit: int = 30,
            _=Depends(get_current_user),
        ):
            from sqlalchemy import text
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(text(f"""
                        SELECT id, camera_id, created_at, metadata
                        FROM face_embeddings
                        WHERE {plugin_self._unknown_where_clause()}
                        ORDER BY created_at DESC LIMIT :limit
                    """), {"limit": limit})
                    rows = result.fetchall()
                return [
                    {
                        "id": r[0], "camera_id": r[1],
                        "created_at": r[2].isoformat() if r[2] else None,
                        "metadata": r[3] or {},
                    }
                    for r in rows
                ]
            except Exception:
                return []

        @router.get("/faces/{face_id}/image")
        async def get_face_image(
            face_id: int,
            crop: bool = True,
            _=Depends(get_current_user),
        ):
            from sqlalchemy import text
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    SELECT image_bytes, metadata
                    FROM face_embeddings
                    WHERE id = :id
                """), {"id": face_id})
                row = result.fetchone()

            if not row or not row[0]:
                raise HTTPException(status_code=404, detail="Face image not found")

            image_bytes = bytes(row[0])
            metadata = row[1] or {}
            if crop:
                cropped = plugin_self._crop_face_image(image_bytes, metadata.get("bbox") or [])
                if cropped:
                    image_bytes = cropped

            return Response(content=image_bytes, media_type="image/jpeg")

        @router.get("/faces/appearances")
        async def list_appearances(
            person_name: str,
            limit: int = 100,
            _=Depends(get_current_user),
        ):
            from sqlalchemy import text

            name = person_name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="person_name required")

            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    SELECT
                        fe.id,
                        COALESCE(fe.camera_id, c.name, c.frigate_name, e.metadata->>'camera_name') AS camera_name,
                        fe.created_at,
                        'registro' AS source,
                        NULL::float AS similarity
                    FROM face_embeddings fe
                    LEFT JOIN events e ON e.metadata->>'db_id' = fe.id::text
                    LEFT JOIN cameras c ON c.id = e.camera_id
                    WHERE fe.person_name = :name

                    UNION ALL

                    SELECT
                        NULL::integer AS id,
                        COALESCE(c.name, c.frigate_name, e.metadata->>'camera_name') AS camera_name,
                        e.start_time AS created_at,
                        'reconocimiento' AS source,
                        NULLIF(e.metadata->>'similarity', '')::float AS similarity
                    FROM events e
                    LEFT JOIN cameras c ON c.id = e.camera_id
                    WHERE e.label = 'face_recognized'
                      AND e.metadata->>'person_name' = :name

                    ORDER BY created_at DESC
                    LIMIT :limit
                """), {"name": name, "limit": limit})
                rows = result.fetchall()

            return [
                {
                    "face_id": r[0],
                    "camera_name": r[1] or "Sin camara",
                    "created_at": r[2].isoformat() if r[2] else None,
                    "source": r[3],
                    "similarity": float(r[4]) if r[4] is not None else None,
                }
                for r in rows
            ]

        @router.post("/faces/register", status_code=201)
        async def register_face(
            person_name: str | None = Form(None),
            face_name: str | None = Form(None),
            person_id: str | None = Form(None),
            image: UploadFile = File(...),
            _=Depends(require_operator),
        ):
            registered_name = (face_name or person_name or "").strip()
            if not registered_name:
                raise HTTPException(status_code=400, detail="face_name required")

            image_bytes = await image.read()
            success = await plugin_self.register_face(
                person_name=registered_name,
                person_id=person_id,
                image_bytes=image_bytes,
                metadata={"source_label": "face"},
            )
            if not success:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No se detectó ningún rostro en la imagen",
                )
            return {"ok": True, "face_name": registered_name, "person_name": registered_name}

        @router.post("/faces/{face_id}/identify")
        async def identify_face(
            face_id: int,
            body: dict,
            _=Depends(require_operator),
        ):
            person_name = body.get("person_name", "").strip()
            if not person_name:
                raise HTTPException(status_code=400, detail="person_name required")
            from sqlalchemy import text
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    UPDATE face_embeddings SET person_name = :name WHERE id = :id RETURNING id
                """), {"name": person_name, "id": face_id})
                row = result.fetchone()
                await db.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Face not found")
            return {"ok": True}

        @router.put("/faces/{face_id}/name")
        async def rename_face(
            face_id: int,
            body: dict,
            _=Depends(require_operator),
        ):
            face_name = (body.get("face_name") or body.get("person_name") or "").strip()
            if not face_name:
                raise HTTPException(status_code=400, detail="face_name required")
            from sqlalchemy import text
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    UPDATE face_embeddings
                    SET person_name = :name
                    WHERE id = :id
                    RETURNING id, person_name
                """), {"name": face_name, "id": face_id})
                row = result.fetchone()
                await db.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Face not found")
            return {"ok": True, "face_id": row[0], "face_name": row[1], "person_name": row[1]}

        @router.delete("/faces/{face_id}", status_code=204)
        async def delete_face(
            face_id: int,
            _=Depends(require_operator),
        ):
            from sqlalchemy import text
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    DELETE FROM face_embeddings WHERE id = :id RETURNING id
                """), {"id": face_id})
                deleted = result.fetchone()
                await db.commit()
            if not deleted:
                raise HTTPException(status_code=404, detail="Face not found")

        return router

    @staticmethod
    def _crop_face_image(image_bytes: bytes, bbox: list) -> bytes | None:
        if not bbox or len(bbox) != 4:
            return None

        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return None

        height, width = image.shape[:2]
        x1, y1, x2, y2 = [int(float(v)) for v in bbox]
        pad_x = int((x2 - x1) * 0.35)
        pad_y = int((y2 - y1) * 0.45)
        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(width, x2 + pad_x)
        y2 = min(height, y2 + pad_y)
        if x2 <= x1 or y2 <= y1:
            return None

        crop = image[y1:y2, x1:x2]
        ok, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return jpeg.tobytes() if ok else None
