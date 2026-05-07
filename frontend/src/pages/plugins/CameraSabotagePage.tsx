import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { countEvents, listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";
import { getCameraSabotageStats } from "../../api/plugins";
import { fetchClipWithAuth, fetchSnapshotWithAuth } from "../../utils/snapshot";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const SABOTAGE_TYPE_LABEL: Record<string, string> = {
  covered: "Tapado",
  blurred: "Desenfoque",
  moved: "Movimiento brusco",
  tampered: "Manipulación",
  loss_of_signal: "Corte de servicio",
  solid_color: "Imagen sólida",
  blur: "Desenfoque",
  scene_change: "Cambio de escena",
};

const EVENT_LABEL: Record<string, string> = {
  camera_sabotage: "Sabotaje",
  camera_sabotage_recovered: "Recuperada",
};

export default function CameraSabotagePage() {
  const [cameraId, setCameraId] = useState("all");
  const { data: camerasData } = useQuery("sabotage-cameras", () => listCameras({ page_size: 200 }));
  const { data: sabotageStats } = useQuery("sabotage-runtime-stats", getCameraSabotageStats, { refetchInterval: 10000 });
  const cameras = camerasData?.items ?? [];
  const selectedCamera = cameraId === "all" ? null : cameras.find((c) => c.id === cameraId) ?? null;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["sabotage-stats", cameraId],
    () => countEvents({
      source: "plugin:camera_sabotage",
      camera_id: selectedCamera?.id,
      start: todayStart.toISOString(),
    }),
    { refetchInterval: 30000 },
  );

  const { data: recentData, isLoading } = useQuery(
    ["sabotage-events", cameraId],
    () => listEvents({
      source: "plugin:camera_sabotage",
      camera_id: selectedCamera?.id,
      limit: 100,
    }),
    { refetchInterval: 30000 },
  );

  const todayCount = statsData?.count ?? 0;
  const recentItems = recentData?.items ?? [];

  const camById = new Map(cameras.map((c) => [c.id, c]));

  const activeSabotage = (sabotageStats?.active_sabotage ?? []).filter((item) => {
    if (!selectedCamera) return true;
    return item.camera_name === selectedCamera.frigate_name || item.camera_name === selectedCamera.display_name;
  });

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🛡 Sabotaje de cámaras</h2>
        <select
          value={cameraId}
          onChange={(e) => setCameraId(e.target.value)}
          className="ml-auto h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>{camera.display_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Alertas hoy</span>
          <span className="text-2xl font-bold text-[var(--warn)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Cámaras en alerta (1h)</span>
          <span className="text-2xl font-bold text-red-400">{activeSabotage.length}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">{selectedCamera ? "Cámara seleccionada" : "Cámaras monitorizadas"}</span>
          <span className="text-2xl font-bold text-[var(--text-0)]">{selectedCamera ? selectedCamera.display_name : cameras.length}</span>
        </div>
      </div>

      {activeSabotage.length > 0 && (
        <div className="vms-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-[var(--warn)]">Cámaras en sabotaje activo</h3>
          <div className="flex flex-wrap gap-2">
            {activeSabotage.map((item) => {
              const cam = cameras.find((c) => c.frigate_name === item.camera_name || c.display_name === item.camera_name);
              return (
                <span key={item.camera_name} className="vms-pill warn">
                  {cam?.display_name ?? item.camera_name} · {SABOTAGE_TYPE_LABEL[item.sabotage_type ?? ""] ?? item.sabotage_type ?? "sabotaje"}
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
                <th>Estado</th>
                <th>Tipo</th>
                <th>Evidencia</th>
                <th>Confianza</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7}>Cargando...</td></tr>
              ) : recentItems.length === 0 ? (
                <tr><td colSpan={7}>Sin alertas de sabotaje</td></tr>
              ) : recentItems.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const sabType = (meta.sabotage_type as string) ?? (meta.type as string) ?? "—";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td>
                      <span className={`vms-pill ${ev.label === "camera_sabotage_recovered" ? "green" : "warn"}`}>
                        {EVENT_LABEL[ev.label] ?? ev.label}
                      </span>
                    </td>
                    <td>{SABOTAGE_TYPE_LABEL[sabType] ?? sabType}</td>
                    <td><SabotageEvidence event={ev} /></td>
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

function SabotageEvidence({ event }: { event: VmsEvent }) {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const [open, setOpen] = useState<"snapshot" | "clip" | null>(null);

  useEffect(() => {
    let alive = true;
    let snapUrl: string | null = null;
    let clipUrl: string | null = null;

    if (event.has_snapshot) {
      fetchSnapshotWithAuth(event.id)
        .then((url) => {
          snapUrl = url;
          if (alive) setSnapshot(url);
        })
        .catch(() => {
          if (alive) setSnapshot(null);
        });
    }
    if (event.has_clip) {
      fetchClipWithAuth(event.id)
        .then(({ blobUrl }) => {
          clipUrl = blobUrl;
          if (alive) setClip(blobUrl);
        })
        .catch(() => {
          if (alive) setClip(null);
        });
    }

    return () => {
      alive = false;
      if (snapUrl) URL.revokeObjectURL(snapUrl);
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    };
  }, [event.id, event.has_snapshot, event.has_clip]);

  return (
    <div className="flex items-center gap-2">
      {snapshot ? (
        <button
          type="button"
          onClick={() => setOpen("snapshot")}
          className="h-12 w-20 overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-2)]"
          title="Ver snapshot"
        >
          <img src={snapshot} alt="Snapshot sabotaje" className="h-full w-full object-cover" />
        </button>
      ) : (
        <span className="text-[var(--text-3)]">Sin snapshot</span>
      )}
      {clip ? (
        <button type="button" onClick={() => setOpen("clip")} className="vms-btn !h-7 !px-2 text-xs">
          Clip
        </button>
      ) : (
        <span className="text-[10px] text-[var(--text-3)]">Sin clip</span>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[90vh] max-w-[90vw] overflow-hidden rounded border border-white/10 bg-black" onClick={(e) => e.stopPropagation()}>
            {open === "clip" && clip ? (
              <video src={clip} controls autoPlay className="max-h-[90vh] max-w-[90vw]" />
            ) : snapshot ? (
              <img src={snapshot} alt="Snapshot sabotaje" className="max-h-[90vh] max-w-[90vw] object-contain" />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
