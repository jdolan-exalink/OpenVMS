# Changelog

All notable changes to OpenVMS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.2] — 2026-05-08

### Added
- **Settings › Sistema tab** — edit OME WebRTC/LL-HLS URLs, go2rtc RTSP host, and CORS origins at runtime from the UI without container restarts. Values stored in a new `system_config` DB table (60 s TTL cache, falls back to env vars).
- **Frigate server wizard** — 3-step modal replacing the flat form: (1) test connection live, (2) configure name + RTSP base, (3) confirm and auto-sync cameras. New `POST /servers/test-connection` endpoint.
- **Per-camera plugin assignment** — Settings › Cámaras shows which plugins support camera-level filtering (`enabled_cameras`) with inline checkboxes to toggle assignments per channel without leaving the camera form.
- **32-camera grid** — new "Mural" 8×4 layout option in LiveView (up to 32 simultaneous streams).
- **Connection batching** — WebSocket streams open in groups of 6 with 350 ms stagger to prevent thundering herd on large grids.

### Changed
- All hardcoded IPs, ports, and credentials replaced with env-var-driven configuration. Frontend nginx config uses template substitution (`${GO2RTC_HOST}`, `${GO2RTC_ADMIN_HOST}`) processed at container start.
- OME stream URLs now read from `SystemConfigService` at sync time (overridable without restart).
- go2rtc RTSP host in `FrigateConfigService` reads from `SystemConfigService` with env-var fallback.
- `video-rtc.js` reconnect timeout 15 s → 8 s; live window 5 s → 3 s; MSE buffer 2 MB → 1 MB per stream.
- `OMEService.get_stream_for_grid` substream threshold: 16 cameras → 9 cameras.

### Migration
```bash
make migrate   # applies 0011_system_config
```

---

## [1.0.1] — 2026-04-XX

### Added
- LPR auto-deploy pipeline.
- UI rebranding (logos, sidebar persistence, analytics dashboard redesign).
- Enterprise plugins overhaul.
- Plugin filter dropdown with colors and shared plugin meta constants.

### Fixed
- LiveView: access `iframeRef` lazily to survive server load race.
- nginx proxy: resolve DNS at runtime; fix dev Vite proxy target.

---

## [1.0.0] — Initial release

- Multi-node Frigate server management (add, sync, monitor).
- Real-time event pipeline: Frigate MQTT → EventService → WebSocket → Frontend.
- LiveView configurable grid 1×1–6×6 with WebRTC/LL-HLS via OvenPlayer.
- Cursor-paginated Events table with filters.
- Multi-camera Playback with timeline sync.
- Plugin system: LPR, face recognition, semantic search, notifications.
- JWT auth with role-based access (admin/operator/viewer).
- Alembic migrations, Docker Compose stack, Makefile.
