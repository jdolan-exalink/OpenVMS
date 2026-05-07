import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="vms-card p-4 flex flex-col gap-1">
      <span className="text-xs text-[var(--text-3)]">{label}</span>
      <span className={`text-2xl font-bold ${color ?? "text-[var(--text-0)]"}`}>{value}</span>
    </div>
  );
}

export default function AbandonedObjectPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("abandoned-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const { data: statsData } = useQuery(
    ["abandoned-stats", cameraId],
    () => listEvents({
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      start: todayStart.toISOString(),
      limit: 500,
    }),
    { refetchInterval: 30000 },
  );

  const todayItems = (statsData?.items ?? []).filter(isAbandonedPluginEvent);
  const uniqueClasses = new Set(
    todayItems.map((e) => eventMeta(e).objectType).filter(Boolean)
  );
  const alertedCams = new Set(todayItems.map((e) => e.camera_id).filter(Boolean));
  const confirmedToday = todayItems.filter((e) => e.label === "abandoned_object").length;
  const activeLikeToday = todayItems.filter((e) => ["suspicious_static_object", "abandoned_pending"].includes(e.label)).length;
  const removedToday = todayItems.filter((e) => e.label === "removed_object").length;

  const { isLoading } = useQuery(
    ["abandoned-events", cameraId],
    () => listEvents({
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      limit: 50,
    }),
    {
      onSuccess: (data) => {
        setPages([data.items.filter(isAbandonedPluginEvent)]);
        setCursor(data.next_cursor);
        setHasMore(data.next_cursor !== null);
      },
      keepPreviousData: true,
    },
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { listEvents: le } = await import("../../api/events");
      const data = await le({
        source: "plugin",
        camera_id: cameraId !== "all" ? cameraId : undefined,
        cursor, limit: 50,
      });
      setPages((p) => [...p, data.items.filter(isAbandonedPluginEvent)]);
      setCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } finally { setLoadingMore(false); }
  }

  const camById = new Map(cameras.map((c) => [c.id, c]));
  const allEvents = pages.flat();

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">Objetos Abandonados</h2>
        <select
          value={cameraId}
          onChange={(e) => { setCameraId(e.target.value); setPages([]); setCursor(null); }}
          className="ml-auto h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Confirmados hoy" value={confirmedToday} color="text-[var(--warn)]" />
        <StatCard label="Sospechosos/Pending" value={activeLikeToday} color="text-yellow-400" />
        <StatCard label="Removidos" value={removedToday} />
        <StatCard label="Cámaras con eventos" value={alertedCams.size} />
      </div>

      {uniqueClasses.size > 0 && (
        <div className="vms-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-0)]">Objetos detectados hoy</h3>
          <div className="flex flex-wrap gap-2">
            {[...uniqueClasses].map((cls) => (
              <span key={cls} className="vms-pill info">{cls}</span>
            ))}
          </div>
        </div>
      )}

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Timeline profesional</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Estado</th>
                <th>Objeto</th>
                <th>Zona</th>
                <th>Tiempo</th>
                <th>Dueño</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={7}>Sin eventos de objetos abandonados registrados</td></tr>
              ) : allEvents.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = eventMeta(ev);
                const duration = typeof meta.durationSeconds === "number"
                  ? fmtDuration(meta.durationSeconds)
                  : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? meta.cameraName ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td><span className={`vms-pill ${statePillClass(ev.label)}`}>{labelText(ev.label)}</span></td>
                    <td>
                      <span className="vms-pill info">{meta.objectType}</span>
                    </td>
                    <td className="mono text-[11px]">{meta.zone}</td>
                    <td className="mono text-[11px]">
                      {duration}
                      {typeof meta.countdownSeconds === "number" && meta.countdownSeconds > 0
                        ? <span className="ml-2 text-[var(--warn)]">-{meta.countdownSeconds}s</span>
                        : null}
                    </td>
                    <td className="mono text-[11px]">{meta.ownerTrackId ?? "sin dueño"}</td>
                    <td>
                      {ev.severity
                        ? <span className={`vms-pill ${ev.severity === "high" || ev.severity === "critical" ? "warn" : "info"}`}>{ev.severity}</span>
                        : <span className="text-[var(--text-3)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="border-t border-[var(--line)] p-3 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="vms-btn !px-6 disabled:opacity-60">
              {loadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function isAbandonedPluginEvent(ev: VmsEvent) {
  const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
  return meta.plugin === "abandoned_object" || [
    "object_appeared",
    "suspicious_static_object",
    "abandoned_pending",
    "abandoned_object",
    "owner_returned",
    "removed_object",
    "object_cleared",
  ].includes(ev.label);
}

function eventMeta(ev: VmsEvent) {
  const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
  return {
    cameraName: meta.camera_name as string | undefined,
    objectType: String(meta.object_type ?? meta.object_class ?? "objeto"),
    durationSeconds: typeof meta.duration_seconds === "number" ? meta.duration_seconds : undefined,
    countdownSeconds: typeof meta.countdown_seconds === "number" ? meta.countdown_seconds : undefined,
    ownerTrackId: meta.owner_track_id != null ? String(meta.owner_track_id) : undefined,
    zone: String(meta.zone ?? "default"),
  };
}

function labelText(label: string) {
  return ({
    object_appeared: "apareció",
    suspicious_static_object: "sospechoso",
    abandoned_pending: "prealerta",
    abandoned_object: "confirmado",
    owner_returned: "dueño volvió",
    removed_object: "removido",
    object_cleared: "resuelto",
  } as Record<string, string>)[label] ?? label;
}

function statePillClass(label: string) {
  if (label === "abandoned_object") return "warn";
  if (label === "abandoned_pending" || label === "suspicious_static_object") return "info";
  if (label === "object_cleared" || label === "owner_returned") return "green";
  return "info";
}
