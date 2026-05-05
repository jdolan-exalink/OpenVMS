import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const SABOTAGE_TYPE_LABEL: Record<string, string> = {
  covered: "Tapado",
  blurred: "Desenfoque",
  moved: "Movimiento brusco",
  tampered: "Manipulación",
};

export default function CameraSabotagePage() {
  const { data: camerasData } = useQuery("sabotage-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["sabotage-stats"],
    () => listEvents({ label: "camera_sabotage", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );

  const { data: recentData, isLoading } = useQuery(
    ["sabotage-events"],
    () => listEvents({ label: "camera_sabotage", source: "plugin", limit: 100 }),
    { refetchInterval: 30000 },
  );

  const todayItems = statsData?.items ?? [];
  const recentItems = recentData?.items ?? [];

  const camById = new Map(cameras.map((c) => [c.id, c]));

  const alertedCamIds = new Set(
    todayItems
      .filter((e) => new Date(e.start_time).getTime() > Date.now() - 3600_000)
      .map((e) => e.camera_id)
      .filter(Boolean),
  );

  return (
    <div className="space-y-3">
      <div className="vms-card p-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🛡 Sabotaje de cámaras</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Alertas hoy</span>
          <span className="text-2xl font-bold text-[var(--warn)]">{todayItems.length}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Cámaras en alerta (1h)</span>
          <span className="text-2xl font-bold text-red-400">{alertedCamIds.size}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Cámaras monitorizadas</span>
          <span className="text-2xl font-bold text-[var(--text-0)]">{cameras.length}</span>
        </div>
      </div>

      {alertedCamIds.size > 0 && (
        <div className="vms-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-[var(--warn)]">Cámaras en alerta activa (última hora)</h3>
          <div className="flex flex-wrap gap-2">
            {[...alertedCamIds].map((id) => {
              const cam = id ? camById.get(id) : undefined;
              return (
                <span key={id ?? "unknown"} className="vms-pill warn">
                  {cam?.display_name ?? id ?? "—"}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Historial de sabotaje</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{recentItems.length} recientes</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Tipo</th>
                <th>Confianza</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5}>Cargando...</td></tr>
              ) : recentItems.length === 0 ? (
                <tr><td colSpan={5}>Sin alertas de sabotaje</td></tr>
              ) : recentItems.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const sabType = (meta.sabotage_type as string) ?? (meta.type as string) ?? "—";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td>{SABOTAGE_TYPE_LABEL[sabType] ?? sabType}</td>
                    <td className="mono text-[11px]">{conf}</td>
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
      </div>
    </div>
  );
}
