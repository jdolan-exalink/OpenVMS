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

export default function SmokeFirePage() {
  const [alertType, setAlertType] = useState<string>("all");
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("smokefire-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const { data: fireStats } = useQuery(
    ["smokefire-stats-fire"],
    () => listEvents({ label: "fire_detected", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const { data: smokeStats } = useQuery(
    ["smokefire-stats-smoke"],
    () => listEvents({ label: "smoke_detected", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );

  const fireCount = fireStats?.items.length ?? 0;
  const smokeCount = smokeStats?.items.length ?? 0;

  const alertedCamIds = new Set([
    ...(fireStats?.items.map((e) => e.camera_id).filter(Boolean) ?? []),
    ...(smokeStats?.items.map((e) => e.camera_id).filter(Boolean) ?? []),
  ]);

  const label = alertType === "fire" ? "fire_detected" : alertType === "smoke" ? "smoke_detected" : undefined;

  const { isLoading } = useQuery(
    ["smokefire-events", alertType, cameraId],
    () => listEvents({
      label: label ?? "fire_detected",
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      limit: 50,
    }),
    {
      enabled: alertType !== "all",
      onSuccess: (data) => {
        setPages([data.items]);
        setCursor(data.next_cursor);
        setHasMore(data.next_cursor !== null);
      },
      keepPreviousData: true,
    },
  );

  const { isLoading: isLoadingAll } = useQuery(
    ["smokefire-events-all", cameraId],
    async () => {
      const [fire, smoke] = await Promise.all([
        listEvents({ label: "fire_detected", source: "plugin", camera_id: cameraId !== "all" ? cameraId : undefined, limit: 25 }),
        listEvents({ label: "smoke_detected", source: "plugin", camera_id: cameraId !== "all" ? cameraId : undefined, limit: 25 }),
      ]);
      const merged = [...fire.items, ...smoke.items].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      );
      return { items: merged, next_cursor: null };
    },
    {
      enabled: alertType === "all",
      onSuccess: (data) => {
        setPages([data.items]);
        setCursor(null);
        setHasMore(false);
      },
      keepPreviousData: true,
    },
  );

  async function loadMore() {
    if (!cursor || loadingMore || alertType === "all") return;
    setLoadingMore(true);
    try {
      const { listEvents: le } = await import("../../api/events");
      const data = await le({
        label: label ?? "fire_detected", source: "plugin",
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
  const loading = alertType === "all" ? isLoadingAll : isLoading;

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🔥 Detección de Humo y Fuego</h2>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={alertType}
            onChange={(e) => { setAlertType(e.target.value); setPages([]); setCursor(null); }}
            className="h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
          >
            <option value="all">Todos</option>
            <option value="fire">Solo fuego</option>
            <option value="smoke">Solo humo</option>
          </select>
          <select
            value={cameraId}
            onChange={(e) => { setCameraId(e.target.value); setPages([]); setCursor(null); }}
            className="h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
          >
            <option value="all">Todas las cámaras</option>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Fuego hoy" value={fireCount} color="text-red-400" />
        <StatCard label="Humo hoy" value={smokeCount} color="text-orange-400" />
        <StatCard label="Total hoy" value={fireCount + smokeCount} color="text-[var(--warn)]" />
        <StatCard label="Cámaras en alerta" value={alertedCamIds.size} />
      </div>

      {alertedCamIds.size > 0 && (
        <div className="vms-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-red-400">Cámaras con alertas hoy</h3>
          <div className="flex flex-wrap gap-2">
            {[...alertedCamIds].map((id) => {
              const cam = id ? camById.get(id) : undefined;
              return <span key={id ?? "?"} className="vms-pill warn">{cam?.display_name ?? id ?? "—"}</span>;
            })}
          </div>
        </div>
      )}

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Historial de alertas</h3>
          {!loading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Tipo</th>
                <th>Fuego</th>
                <th>Humo</th>
                <th>Confianza</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={7}>Sin alertas de humo/fuego registradas</td></tr>
              ) : allEvents.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const isFire = meta.fire_detected === true || ev.label === "fire_detected";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td>
                      <span className={`vms-pill ${isFire ? "warn" : "info"}`}>
                        {isFire ? "🔥 Fuego" : "💨 Humo"}
                      </span>
                    </td>
                    <td className="mono text-[11px]">{typeof meta.fire_count === "number" ? meta.fire_count as number : "—"}</td>
                    <td className="mono text-[11px]">{typeof meta.smoke_count === "number" ? meta.smoke_count as number : "—"}</td>
                    <td className="mono text-[11px]">{conf}</td>
                    <td>
                      {ev.severity
                        ? <span className={`vms-pill ${ev.severity === "critical" ? "warn" : "info"}`}>{ev.severity}</span>
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
