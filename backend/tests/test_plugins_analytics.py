import pytest
from unittest.mock import MagicMock

from app.plugins.enterprise.smoke_fire.plugin import SmokeFirePlugin
from app.plugins.enterprise.fall_detection.plugin import FallDetectionPlugin
from app.plugins.enterprise.camera_sabotage.plugin import CameraSabotagePlugin
from app.plugins.enterprise.loitering.plugin import LoiteringPlugin
from app.plugins.enterprise.line_crossing.plugin import LineCrossingPlugin


# ── Smoke / Fire ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_smoke_fire_on_load_sets_config():
    plugin = SmokeFirePlugin()
    await plugin.on_load({"enabled_cameras": ["cam1"], "confidence": 0.6})
    assert plugin._config["enabled_cameras"] == ["cam1"]
    assert plugin._config["confidence"] == 0.6


@pytest.mark.asyncio
async def test_smoke_fire_get_routes_returns_router():
    plugin = SmokeFirePlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/stats" in paths
    assert any("/reset/" in p for p in paths)


# ── Fall Detection ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fall_detection_normalizes_config():
    plugin = FallDetectionPlugin()
    await plugin.on_load({"sensitivity": "high"})
    assert plugin._config["sensitivity"] == "high"
    assert plugin._config["fall_angle_threshold"] == 40


@pytest.mark.asyncio
async def test_fall_detection_get_routes_returns_router():
    plugin = FallDetectionPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/stats" in paths
    assert any("/tracks/" in p for p in paths)


@pytest.mark.asyncio
async def test_fall_detection_cleanup_tracks():
    plugin = FallDetectionPlugin()
    await plugin.on_load({})
    plugin._person_tracks["cam1"][1] = MagicMock()
    plugin._alerted_tracks["cam1"][1] = 1000.0

    await plugin.on_unload()
    assert len(plugin._person_tracks) == 0


# ── Camera Sabotage ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_camera_sabotage_on_load_sets_config():
    plugin = CameraSabotagePlugin()
    await plugin.on_load({"blur_threshold": 100})
    assert plugin._config["blur_threshold"] == 100


@pytest.mark.asyncio
async def test_camera_sabotage_get_routes_returns_router():
    plugin = CameraSabotagePlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/stats" in paths
    assert any("/reset/" in p for p in paths)


# ── Loitering ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_loitering_normalizes_zones_config():
    plugin = LoiteringPlugin()
    await plugin.on_load({
        "zones": {
            "cam1": [
                {"name": "zone1", "polygon": [[0,0],[1,0],[1,1],[0,1]], "min_seconds": 30}
            ]
        }
    })
    assert "cam1" in plugin._zones
    assert plugin._zones["cam1"][0].threshold_seconds == 30
    assert plugin._zones["cam1"][0].name == "zone1"


@pytest.mark.asyncio
async def test_loitering_get_routes_returns_router():
    plugin = LoiteringPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/zones" in paths
    assert "/stats" in paths
    assert any("/tracks/" in p for p in paths)


@pytest.mark.asyncio
async def test_loitering_on_unload_clears_zones_and_tracks():
    plugin = LoiteringPlugin()
    await plugin.on_load({
        "zones": {
            "cam1": [{"name": "z1", "polygon": [[0,0],[1,0],[1,1],[0,1]], "threshold_seconds": 60}]
        }
    })
    # Manually add track state (normally done via on_event)
    plugin._track_entry_times["cam1"] = {1: 1000.0}
    plugin._alerted_tracks["cam1"] = {1: 1000.0}

    await plugin.on_unload()

    # on_unload should clear all state
    assert len(plugin._zones) == 0
    assert len(plugin._track_entry_times) == 0
    assert len(plugin._alerted_tracks) == 0


@pytest.mark.asyncio
async def test_loitering_delete_track_via_endpoint():
    plugin = LoiteringPlugin()
    await plugin.on_load({})
    # Simulate camera with zones configured
    plugin._zones["cam1"] = plugin._zones.get("cam1", [])
    plugin._track_entry_times["cam1"] = {42: 1000.0}
    plugin._alerted_tracks["cam1"] = {42: 1000.0}

    # Find the delete route (path is /tracks/{track_id})
    router = plugin.get_routes()
    delete_route = None
    for r in router.routes:
        if hasattr(r, "path") and r.path == "/tracks/{track_id}":
            delete_route = r
            break

    assert delete_route is not None

    mock_user = MagicMock()
    await delete_route.endpoint(track_id=42, camera_name="cam1", _=mock_user)

    assert 42 not in plugin._track_entry_times.get("cam1", {})


# ── Line Crossing ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_line_crossing_get_routes_returns_router():
    plugin = LineCrossingPlugin()
    await plugin.on_load({})
    router = plugin.get_routes()
    assert router is not None
    paths = [r.path for r in router.routes]
    assert "/lines" in paths
    assert "/stats" in paths
    assert any("/tracks/" in p for p in paths)


@pytest.mark.asyncio
async def test_line_crossing_on_unload_clears():
    plugin = LineCrossingPlugin()
    await plugin.on_load({"lines": {"cam1": [{"name": "l1", "p1": [0, 0.5], "p2": [1, 0.5]}]}})
    plugin._prev_positions["cam1"] = {"track-1": {"raw": (0.5, 0.5), "norm": (0.5, 0.5)}}
    plugin._last_alerts["cam1"] = {}

    await plugin.on_unload()

    assert len(plugin._prev_positions) == 0
    assert len(plugin._last_alerts) == 0


@pytest.mark.asyncio
async def test_line_crossing_delete_track_via_endpoint():
    plugin = LineCrossingPlugin()
    await plugin.on_load({})
    plugin._prev_positions["cam1"] = {"track-1": {"raw": (0.5, 0.5), "norm": (0.5, 0.5)}}

    router = plugin.get_routes()
    delete_route = None
    for r in router.routes:
        if hasattr(r, "path") and r.path == "/tracks/{track_id}":
            delete_route = r
            break

    assert delete_route is not None

    mock_user = MagicMock()
    await delete_route.endpoint(track_id="track-1", camera_name="cam1", _=mock_user)

    assert "track-1" not in plugin._prev_positions.get("cam1", {})
