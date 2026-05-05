import pytest
from unittest.mock import AsyncMock

from app.plugins.enterprise.line_crossing.plugin import LineCrossingPlugin
from app.plugins.enterprise.people_counting.plugin import PeopleCountingPlugin


@pytest.fixture(autouse=True)
def patch_save_count_event(monkeypatch):
    async def noop(*args, **kwargs):
        pass

    monkeypatch.setattr(PeopleCountingPlugin, "_save_count_event", noop)


@pytest.mark.asyncio
async def test_people_counting_counts_normalized_editor_lines():
    plugin = PeopleCountingPlugin()
    await plugin.on_load(
        {
            "counting_lines": {
                "front": [
                    {
                        "name": "door",
                        "zone": "entry",
                        "p1": [0, 0.5],
                        "p2": [1, 0.5],
                        "labels": ["person"],
                    }
                ]
            }
        }
    )

    base = {
        "camera_name": "front",
        "track_id": "evt-1",
        "label": "person",
        "mqtt_type": "update",
        "raw_cx": 320,
        "raw_cy": 0,
        "cx": 0.5,
    }
    await plugin.on_event({**base, "cy": 0.4, "raw_cy": 144})
    await plugin.on_event({**base, "cy": 0.6, "raw_cy": 216})

    assert await plugin.get_counts("front") == {"front": {"entry": {"person_exit": 1}}}


@pytest.mark.asyncio
async def test_people_counting_counts_legacy_pixel_lines():
    plugin = PeopleCountingPlugin()
    await plugin.on_load(
        {
            "counting_lines": {
                "front": [
                    {
                        "name": "door",
                        "zone": "entry",
                        "p1": [0, 180],
                        "p2": [640, 180],
                        "labels": ["person"],
                    }
                ]
            }
        }
    )

    base = {
        "camera_name": "front",
        "track_id": "evt-1",
        "label": "person",
        "mqtt_type": "update",
        "raw_cx": 320,
        "cx": 0.5,
    }
    await plugin.on_event({**base, "raw_cy": 144, "cy": 0.4})
    await plugin.on_event({**base, "raw_cy": 216, "cy": 0.6})

    assert await plugin.get_counts("front") == {"front": {"entry": {"person_exit": 1}}}


@pytest.mark.asyncio
async def test_line_crossing_reads_normalized_payload_and_emits_direction():
    plugin = LineCrossingPlugin()
    alerts = []

    async def capture_alert(**kwargs):
        alerts.append(kwargs)

    plugin._emit_alert = capture_alert
    await plugin.on_load(
        {
            "lines": {
                "front": [
                    {
                        "name": "door",
                        "p1": [0, 0.5],
                        "p2": [1, 0.5],
                        "directions": ["BA"],
                        "enter_direction": "BA",
                    }
                ]
            }
        }
    )

    base = {
        "camera_name": "front",
        "track_id": "evt-1",
        "label": "person",
        "mqtt_type": "update",
        "raw_cx": 320,
        "cx": 0.5,
    }
    await plugin.on_event({**base, "raw_cy": 144, "cy": 0.4})
    await plugin.on_event({**base, "raw_cy": 216, "cy": 0.6})

    assert len(alerts) == 1
    assert alerts[0]["data"]["direction"] == "BA"
    assert alerts[0]["data"]["movement"] == "enter"
