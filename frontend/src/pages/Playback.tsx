import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "react-query";
import { listCameras } from "../api/cameras";
import { listEvents } from "../api/events";
import { listRecordings } from "../api/recordings";
import ExportModal from "../components/playback/ExportModal";
import PlaybackView from "../components/playback/PlaybackView";
import TimelineBar, { CameraSegments } from "../components/playback/TimelineBar";

const MAX_CAMERAS = 4;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(`${dateStr}T23:59:59`);
  return { start: start.getTime() / 1000, end: end.getTime() / 1000 };
}

function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Playback() {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showExport, setShowExport] = useState(false);
  const lastTickRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const { start: rangeStart, end: rangeEnd } = dayRange(selectedDate);
  const [currentTime, setCurrentTime] = useState(rangeStart);
  const [viewRange, setViewRange] = useState(() => ({ start: rangeStart, end: rangeEnd }));

  useEffect(() => {
    setViewRange({ start: rangeStart, end: rangeEnd });
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      return;
    }

    lastTickRef.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      setCurrentTime((time) => Math.min(rangeEnd, time + ((now - last) / 1000) * playbackRate));
    }, 500);

    return () => window.clearInterval(interval);
  }, [playbackRate, playing, rangeEnd]);

  const camerasQuery = useQuery("playback-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasQuery.data?.items ?? [];

  const selectedCameras = useMemo(
    () => cameras.filter((c) => selectedIds.includes(c.id)),
    [cameras, selectedIds],
  );

  const startISO = new Date(rangeStart * 1000).toISOString();
  const endISO = new Date(rangeEnd * 1000).toISOString();

  // Fetch recordings for each selected camera
  const recordingResults = useQueries(
    selectedCameras.map((c) => ({
      queryKey: ["recordings", c.id, selectedDate],
      queryFn: () => listRecordings({ camera_id: c.id, start: startISO, end: endISO }),
      enabled: !!c.id,
    })),
  );

  const recordingsLoading = recordingResults.some((result) => result.isLoading || result.isFetching);
  const cameraSegments: CameraSegments[] = useMemo(
    () => selectedCameras.map((c, i) => ({
      camera: c,
      segments: recordingsLoading ? [] : recordingResults[i]?.data?.segments ?? [],
    })),
    [recordingResults, recordingsLoading, selectedCameras],
  );
  const allSegments = useMemo(
    () => cameraSegments
      .flatMap(({ segments }) => segments)
      .slice()
      .sort((a, b) => a.start_time - b.start_time),
    [cameraSegments],
  );

  useEffect(() => {
    if (!playing || allSegments.length === 0) return;
    const next = findContinuousTime(currentTime, allSegments, rangeEnd);
    if (Math.abs(next - currentTime) > 0.05) {
      setCurrentTime(next);
      lastTickRef.current = Date.now();
    }
  }, [allSegments, currentTime, playing, rangeEnd]);

  // Fetch events for the day (all cameras)
  const eventsQuery = useQuery(
    ["playback-events", selectedDate],
    () => listEvents({ limit: 500, start: startISO, end: endISO }),
    { enabled: selectedCameras.length > 0 },
  );
  const eventsLoading = eventsQuery.isLoading || eventsQuery.isFetching;
  const events = useMemo(
    () => (eventsLoading ? [] : eventsQuery.data?.items ?? []).filter(
      (ev) => !selectedIds.length || (ev.camera_id && selectedIds.includes(ev.camera_id)),
    ),
    [eventsLoading, eventsQuery.data?.items, selectedIds],
  );

  const cameraPlayback = useMemo(
    () => cameraSegments.map(({ camera, segments }) => ({
      camera,
      segments,
    })),
    [cameraSegments],
  );
  const motionTimelineEvents = useMemo(
    () => events.filter((event) => event.label.toLowerCase().includes("motion")),
    [events],
  );

  function toggleCamera(id: string) {
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_CAMERAS) return cur;
      return [...cur, id];
    });
  }

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(Math.max(rangeStart, Math.min(rangeEnd, t)));
    setPlaying(true);
    lastTickRef.current = Date.now();
  }, [rangeStart, rangeEnd]);

  const handleTimeUpdate = useCallback((t: number) => {
    setCurrentTime(Math.max(rangeStart, Math.min(rangeEnd, t)));
    lastTickRef.current = Date.now();
  }, [rangeStart, rangeEnd]);

  const handleSegmentEnded = useCallback((t: number) => {
    setCurrentTime(findContinuousTime(Math.min(rangeEnd, t + 0.05), allSegments, rangeEnd));
    lastTickRef.current = Date.now();
  }, [allSegments, rangeEnd]);

  function handleDateChange(d: string) {
    setSelectedDate(d);
    const { start, end } = dayRange(d);
    queryClient.removeQueries("recordings");
    queryClient.removeQueries("playback-events");
    setCurrentTime(start);
    setViewRange({ start, end });
    setPlaying(false);
  }

  const elapsed = currentTime - rangeStart;
  const totalRecordingSeconds = cameraSegments.reduce(
    (acc, cs) => acc + cs.segments.reduce((s, seg) => s + (seg.end_time - seg.start_time), 0),
    0,
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="vms-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date */}
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-2)]">Fecha</span>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </label>

          {/* Play/pause */}
          <button
            type="button"
            className="vms-btn primary !px-3"
            onClick={() => {
              setPlaying((p) => {
                const nextPlaying = !p;
                if (nextPlaying && allSegments.length > 0) {
                  setCurrentTime((time) => findContinuousTime(time, allSegments, rangeEnd));
                  lastTickRef.current = Date.now();
                }
                return nextPlaying;
              });
            }}
            disabled={selectedCameras.length === 0}
          >
            {playing ? "⏸ Pausar" : "▶ Reproducir"}
          </button>

          {/* Current time display */}
          <span className="mono text-sm text-[var(--text-0)]">
            {new Date(currentTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className="mono text-xs text-[var(--text-3)]">
            +{fmtDuration(elapsed)}
          </span>
          <div className="flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--bg-2)] p-0.5">
            {[1, 2, 4, 8].map((rate) => (
              <button
                key={rate}
                type="button"
                className={[
                  "h-7 rounded px-2 text-xs font-semibold",
                  playbackRate === rate ? "bg-[var(--acc)] text-[var(--bg-0)]" : "text-[var(--text-2)] hover:text-[var(--text-0)]",
                ].join(" ")}
                onClick={() => setPlaybackRate(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {totalRecordingSeconds > 0 && (
              <span className="mono text-[11px] text-[var(--text-3)]">
                {fmtDuration(totalRecordingSeconds)} grabados
              </span>
            )}
            <button
              type="button"
              className="vms-btn"
              onClick={() => setShowExport(true)}
              disabled={selectedCameras.length === 0}
            >
              ↓ Exportar
            </button>
          </div>
        </div>
      </div>

      {/* Camera selector */}
      <div className="vms-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-2)]">Cámaras (máx. {MAX_CAMERAS})</span>
          {camerasQuery.isLoading ? (
            <span className="text-xs text-[var(--text-3)]">Cargando...</span>
          ) : cameras.length === 0 ? (
            <span className="text-xs text-[var(--text-3)]">No hay cámaras sincronizadas</span>
          ) : (
            cameras.map((c) => {
              const active = selectedIds.includes(c.id);
              const disabled = !active && selectedIds.length >= MAX_CAMERAS;
              const idx = selectedIds.indexOf(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCamera(c.id)}
                  disabled={disabled}
                  className={[
                    "vms-btn !h-7 !px-2.5 !text-xs transition",
                    active ? "!border-[var(--acc)] !text-[var(--acc-strong)] !bg-[var(--acc-soft)]" : "",
                    disabled ? "opacity-40 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  {active && (
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full"
                      style={{ background: ["#00D084", "#5B97FF", "#F59E0B", "#A855F7"][idx] }}
                    />
                  )}
                  {c.display_name}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Video grid */}
      <PlaybackView
        cameraPlayback={cameraPlayback}
        currentTime={currentTime}
        playing={playing}
        playbackRate={playbackRate}
        onTimeUpdate={handleTimeUpdate}
        onSegmentEnded={handleSegmentEnded}
      />

      {/* Timeline */}
      <TimelineBar
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        viewStart={viewRange.start}
        viewEnd={viewRange.end}
        cameraSegments={cameraSegments}
        events={motionTimelineEvents}
        currentTime={currentTime}
        isLoading={recordingsLoading || eventsLoading}
        onSeek={handleSeek}
        onViewportChange={(start, end) => setViewRange({ start, end })}
      />

      {/* Events summary under timeline */}
      {events.length > 0 && (
        <div className="vms-card p-3">
          <div className="vms-card-hd">
            <h3>Eventos del día</h3>
            <span className="mono text-[11px] text-[var(--text-3)]">{events.length} detecciones</span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <table className="vms-table">
              <thead>
                <tr><th>Hora</th><th>Cámara</th><th>Tipo</th><th>Score</th></tr>
              </thead>
              <tbody>
                {events.slice(0, 100).map((ev) => {
                  const cam = cameras.find((c) => c.id === ev.camera_id);
                  return (
                    <tr
                      key={ev.id}
                      className="cursor-pointer hover:bg-[var(--bg-2)]"
                      onClick={() => handleSeek(new Date(ev.start_time).getTime() / 1000 - 5)}
                    >
                      <td className="mono text-[11px] text-[var(--text-2)]">
                        {new Date(ev.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="text-[var(--text-1)]">{cam?.display_name ?? ev.camera_id ?? "—"}</td>
                      <td>{ev.plate_number ? `${ev.label} · ${ev.plate_number}` : ev.label}</td>
                      <td className="mono text-[11px] text-[var(--text-2)]">
                        {ev.score != null ? Number(ev.score).toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showExport && selectedCameras.length > 0 && (
        <ExportModal
          cameras={selectedCameras}
          rangeStart={currentTime}
          rangeEnd={rangeEnd}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

function findContinuousTime(
  time: number,
  segments: { start_time: number; end_time: number }[],
  rangeEnd: number,
) {
  if (segments.some((seg) => time >= seg.start_time && time < seg.end_time)) return time;
  const next = segments.find((seg) => seg.start_time > time);
  return next ? next.start_time : rangeEnd;
}
