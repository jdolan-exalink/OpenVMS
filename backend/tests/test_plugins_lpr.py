import pytest
from unittest.mock import MagicMock

from app.plugins.builtin.lpr import LPRPlugin
from app.plugins.enterprise.lpr_advanced.plugin import LPRAdvancedPlugin


# ── LPR Basic ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lpr_on_load_normalizes_config():
    plugin = LPRPlugin()
    await plugin.on_load({
        "enabled_cameras": ["cam1"],
        "detection_cooldown": 15,
        "min_score": 0.5,
    })
    assert plugin._config["enabled_cameras"] == ["cam1"]
    assert plugin._config["detection_cooldown"] == 15
    assert plugin._config["min_score"] == 0.5


@pytest.mark.asyncio
async def test_lpr_normalizes_plate_valid():
    plugin = LPRPlugin()
    await plugin.on_load({})
    assert plugin._normalize_plate("ABC123")["plate"] == "ABC123"
    assert plugin._normalize_plate("abc 123")["plate"] == "ABC123"
    assert plugin._normalize_plate("  XYZ999  ")["plate"] == "XYZ999"
    assert plugin._normalize_plate("AB0I2CD")["plate"] == "AB012CD"


@pytest.mark.asyncio
async def test_lpr_normalizes_plate_invalid():
    plugin = LPRPlugin()
    await plugin.on_load({})
    assert plugin._normalize_plate("AB") is None
    assert plugin._normalize_plate("") is None


@pytest.mark.asyncio
async def test_lpr_get_routes_returns_router():
    plugin = LPRPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/plates" in paths
    assert "/search" in paths
    assert "/blacklist" in paths
    assert any("/blacklist/" in p for p in paths)


@pytest.mark.asyncio
async def test_lpr_get_config_schema():
    plugin = LPRPlugin()
    schema = plugin.get_config_schema()
    assert schema["type"] == "object"
    assert "properties" in schema
    assert "detection_cooldown" in schema["properties"]
    assert "alert_cooldown" in schema["properties"]
    assert "country" in schema["properties"]
    assert "min_frames" in schema["properties"]


# ── LPR Advanced ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lpr_advanced_on_load_sets_config():
    plugin = LPRAdvancedPlugin()
    await plugin.on_load({
        "plate_model_path": "/models/lp_detector.onnx",
        "use_gpu": False,
    })
    assert plugin._config["plate_model_path"] == "/models/lp_detector.onnx"
    assert plugin._config["use_gpu"] is False


@pytest.mark.asyncio
async def test_lpr_advanced_get_config_schema():
    plugin = LPRAdvancedPlugin()
    schema = plugin.get_config_schema()
    assert schema["type"] == "object"
    assert "properties" in schema
    assert "min_frames" in schema["properties"]
    assert "dedupe_window" in schema["properties"]


@pytest.mark.asyncio
async def test_lpr_advanced_missing_model_sets_correct_state():
    plugin = LPRAdvancedPlugin()
    await plugin.on_load({"plate_model_path": "/models/nonexistent_model.onnx"})
    assert plugin._plate_engine is None
    assert plugin._engine_status["state"] == "missing_model"
    assert len(plugin._engine_status.get("missing", [])) == 1
    assert "model_file" in plugin._engine_status["missing"][0]["type"]


@pytest.mark.asyncio
async def test_lpr_advanced_get_routes_returns_router():
    plugin = LPRAdvancedPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert any("/stats" in p or "/reset/" in p for p in paths)
