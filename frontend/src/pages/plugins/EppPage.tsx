import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="vms-card p-4 flex flex-col gap-1">
      <span className="text-xs text-[var(--text-3)]">{label}</span>
      <span className={`text-2xl font-bold ${color ?? "text-[var(--text-0)]"}`}>{value}</span>
    </div>
  );
}

const VIOLATION_LABELS: Record<string, string> = {
  no_helmet: "Sin casco",
  no_vest: "Sin chaleco",
};

export default function EppPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("epp-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const { data: statsData } = useQuery(
    ["epp-stats", cameraId],
    () => listEvents({
      label: "epp_violation",
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      start: todayStart.toISOString(),
      limit: 500,
    }),
    { refetchInterval: 30000 },
  );

  const todayItems = statsData?.items ?? [];
  const helmetViolations = todayItems.filter((e) => {
    const v = ((e.extra_metadata as Record<string, unknown>)?.violations ?? []) as string[];
    return v.includes("no_helmet");
  }).length;
  const vestViolations = todayItems.filter((e) => {
    const v = ((e.extra_metadata as Record<string, unknown>)?.violations ?? []) as string[];
    return v.includes("no_vest");
  }).length;

  const { isLoading } = useQuery(
    ["epp-events", cameraId],
    () => listEvents({
      label: "epp_violation",
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
        label: "epp_violation", source: "plugin",
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
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🦺 Cumplimiento de EPP</h2>
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
        <StatCard label="Violaciones hoy" value={todayItems.length} color="text-[var(--warn)]" />
        <StatCard label="Sin casco" value={helmetViolations} color="text-orange-400" />
        <StatCard label="Sin chaleco" value={vestViolations} color="text-yellow-400" />
        <StatCard label="Cámaras monitorizadas" value={cameras.length} />
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Historial de violaciones EPP</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Zona</th>
                <th>Violaciones</th>
                <th>Track ID</th>
                <th>Confianza</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={7}>Sin violaciones de EPP registradas</td></tr>
              ) : allEvents.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const violations = (meta.violations as string[] | undefined) ?? [];
                const zone = (meta.zone_name as string) ?? "—";
                const trackId = meta.track_id !== undefined ? String(meta.track_id) : "—";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td className="mono text-[11px]">{zone}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {violations.length > 0
                          ? violations.map((v) => (
                            <span key={v} className="vms-pill warn text-[10px]">
                              {VIOLATION_LABELS[v] ?? v}
                            </span>
                          ))
                          : <span className="text-[var(--text-3)]">—</span>
                        }
                      </div>
                    </td>
                    <td className="mono text-[11px]">{trackId}</td>
                    <td className="mono text-[11px]">{conf}</td>
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
