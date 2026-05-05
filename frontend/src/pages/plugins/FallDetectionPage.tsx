import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function FallDetectionPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("fall-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["fall-stats"],
    () => listEvents({ label: "fall_detected", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const todayCount = statsData?.items.length ?? 0;
  const highCount = statsData?.items.filter((e) => e.severity === "critical" || e.severity === "high").length ?? 0;

  const { isLoading } = useQuery(
    ["fall-events", cameraId],
    () => listEvents({
      label: "fall_detected",
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      limit: 50,
    }),
    {
      onSuccess: (data) => {
        setPages([data.items]);
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
        label: "fall_detected", source: "plugin",
        camera_id: cameraId !== "all" ? cameraId : undefined,
        cursor, limit: 50,
      });
      setPages((p) => [...p, data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } finally { setLoadingMore(false); }
  }

  const camById = new Map(cameras.map((c) => [c.id, c]));
  const allEvents = pages.flat();

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🚨 Detección de caídas</h2>
        <select
          value={cameraId}
          onChange={(e) => { setCameraId(e.target.value); setPages([]); setCursor(null); }}
          className="ml-auto h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Caídas hoy</span>
          <span className="text-2xl font-bold text-[var(--warn)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Alta severidad</span>
          <span className="text-2xl font-bold text-red-400">{highCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Estado</span>
          <span className="text-sm font-semibold text-[var(--acc)]">MediaPipe Pose</span>
        </div>
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Eventos de caída</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Confianza</th>
                <th>Ángulo</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={5}>Sin caídas detectadas</td></tr>
              ) : allEvents.map((ev) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = ev.extra_metadata ?? {};
                const conf = typeof meta.fall_confidence === "number" ? `${Math.round((meta.fall_confidence as number) * 100)}%` : "—";
                const angle = typeof meta.fall_angle === "number" ? `${Math.round(meta.fall_angle as number)}°` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td className="mono text-[11px]">{conf}</td>
                    <td className="mono text-[11px]">{angle}</td>
                    <td>
                      {ev.severity
                        ? <span className={`vms-pill ${ev.severity === "critical" || ev.severity === "high" ? "warn" : "info"}`}>{ev.severity}</span>
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
