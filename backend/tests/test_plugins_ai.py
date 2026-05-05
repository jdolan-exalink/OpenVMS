import pytest
from unittest.mock import MagicMock

from app.plugins.enterprise.ai_summary.plugin import AISummaryPlugin
from app.plugins.enterprise.semantic_search.plugin import SemanticSearchPlugin
from app.plugins.enterprise.face_recognition.plugin import FaceRecognitionPlugin


# ── AI Summary ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ai_summary_on_load_sets_config():
    plugin = AISummaryPlugin()
    await plugin.on_load({"ollama_url": "http://localhost:11434", "model": "llava"})
    assert plugin._config["ollama_url"] == "http://localhost:11434"
    assert plugin._config["model"] == "llava"


@pytest.mark.asyncio
async def test_ai_summary_enqueue_event_passes_filter():
    plugin = AISummaryPlugin()
    await plugin.on_load({})

    event = {
        "camera_name": "cam1",
        "track_id": "t1",
        "label": "person",
        "start_time": "2025-01-01T00:00:00Z",
        "severity": "high",
    }
    await plugin.on_event(event)
    assert plugin._event_queue.qsize() == 1


@pytest.mark.asyncio
async def test_ai_summary_get_routes_returns_router():
    plugin = AISummaryPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/queue-status" in paths


@pytest.mark.asyncio
async def test_ai_summary_get_config_schema():
    plugin = AISummaryPlugin()
    schema = plugin.get_config_schema()
    assert schema["type"] == "object"
    assert "properties" in schema


# ── Semantic Search ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_semantic_search_on_load_sets_config():
    plugin = SemanticSearchPlugin()
    await plugin.on_load({"clip_model": "openai/clip-vit-base-patch32"})
    assert plugin._config["clip_model"] == "openai/clip-vit-base-patch32"


@pytest.mark.asyncio
async def test_semantic_search_get_routes_returns_router():
    plugin = SemanticSearchPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert any("search" in p.lower() or "/stats" in p for p in paths)


@pytest.mark.asyncio
async def test_semantic_search_get_config_schema():
    plugin = SemanticSearchPlugin()
    schema = plugin.get_config_schema()
    assert schema["type"] == "object"
    assert "properties" in schema


# ── Face Recognition ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_face_recognition_on_load_sets_config():
    plugin = FaceRecognitionPlugin()
    await plugin.on_load({"detection_threshold": 0.7})
    assert plugin._config["detection_threshold"] == 0.7


@pytest.mark.asyncio
async def test_face_recognition_get_routes_returns_router():
    plugin = FaceRecognitionPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None


@pytest.mark.asyncio
async def test_face_recognition_get_config_schema():
    plugin = FaceRecognitionPlugin()
    schema = plugin.get_config_schema()
    assert schema["type"] == "object"
    assert "properties" in schema
