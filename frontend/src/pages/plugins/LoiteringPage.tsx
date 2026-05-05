import { useEffect, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { Camera, getCameraSnapshot, listCameras } from "../../api/cameras";
import { listPlugins, updatePluginConfig } from "../../api/plugins";

type ZoneRule = {
  name: string;
  polygon: [number, number][];
  threshold_seconds: number;
  min_seconds?: number;
  labels: string[];
  severity: "low" | "medium" | "high" | "critical";
  alert_cooldown: number;
};

const LABELS = ["person", "car", "truck", "bus", "motorcycle", "bicycle"];
const DEFAULT_ZONE: ZoneRule = {
  name: "zona_principal",
  polygon: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]],
  threshold_seconds: 60,
  min_seconds: 60,
  labels: ["person"],
  severity: "medium",
  alert_cooldown: 300,
};

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

export default function LoiteringPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("loitering-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];
  const pluginsQ = useQuery("loitering-plugins", listPlugins);
  const plugin = pluginsQ.data?.find((p) => p.name === "loitering");
  const config = (plugin?.config ?? {}) as { zones?: Record<string, ZoneRule[]> };
  const selectedCam = cameras.find((c) => c.id === cameraId) ?? cameras[0];
  const selectedKey = selectedCam?.frigate_name || selectedCam?.name || "";
  const cameraZones = selectedKey ? config.zones?.[selectedKey] ?? [] : [];
  const [draft, setDraft] = useState<ZoneRule>(DEFAULT_ZONE);
  const [editingZone, setEditingZone] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [placingPoint, setPlacingPoint] = useState<number | null>(null);

  const saveConfig = useMutation(
    (next: Record<string, unknown>) => updatePluginConfig("loitering", next),
    { onSuccess: () => pluginsQ.refetch() },
  );

  async function saveZone() {
    if (!selectedKey || !draft.name.trim()) return;
    setSaveError(null);
    const threshold = Number(draft.threshold_seconds || draft.min_seconds || 60);
    const clean: ZoneRule = { ...draft, name: draft.name.trim(), threshold_seconds: threshold, min_seconds: threshold };
    const nextZones = [...cameraZones];
    if (editingZone === null) nextZones.push(clean);
    else nextZones[editingZone] = clean;
    try {
      await saveConfig.mutateAsync({ ...config, zones: { ...(config.zones ?? {}), [selectedKey]: nextZones } });
      setDraft(DEFAULT_ZONE);
      setEditingZone(null);
      setPlacingPoint(null);
    } catch {
      setSaveError("No se pudo guardar la zona. Revisá permisos o conexión con el backend.");
    }
  }

  function editZone(index: number) {
    const zone = cameraZones[index];
    setDraft({
      ...zone,
      polygon: (zone.polygon ?? []).map((p) => [...p] as [number, number]),
      threshold_seconds: zone.threshold_seconds ?? zone.min_seconds ?? 60,
      labels: [...(zone.labels ?? ["person"])],
    });
    setEditingZone(index);
    setPlacingPoint(null);
    setSaveError(null);
  }

  function cancelEdit() {
    setDraft(DEFAULT_ZONE);
    setEditingZone(null);
    setPlacingPoint(null);
    setSaveError(null);
  }

  function deleteZone(index: number) {
    if (!selectedKey) return;
    const nextZones = cameraZones.filter((_, i) => i !== index);
    saveConfig.mutate({ ...config, zones: { ...(config.zones ?? {}), [selectedKey]: nextZones } });
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["loitering-stats", cameraId],
    () => listEvents({
      label: "loitering",
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      start: todayStart.toISOString(),
      limit: 500,
    }),
    { refetchInterval: 30000 },
  );
  const todayCount = statsData?.items.length ?? 0;
  const criticalCount = statsData?.items.filter((e) => e.severity === "critical" || e.severity === "high").length ?? 0;

  const { isLoading } = useQuery(
    ["loitering-events", cameraId],
    () => listEvents({
      label: "loitering",
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
        label: "loitering", source: "plugin",
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
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">👁 Merodeo</h2>
        <select
          value={cameraId}
          onChange={(e) => { setCameraId(e.target.value); setPages([]); setCursor(null); }}
          className="ml-auto h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
      </div>

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <div className="vms-card">
          <div className="vms-card-hd">
            <h3>Configuración</h3>
            <span className="mono text-[10px] text-[var(--text-3)]">{selectedKey || "sin camara"}</span>
          </div>
          <div className="space-y-3 p-3 pt-0">
            <ZoneRuleForm
              draft={draft}
              setDraft={setDraft}
              onSave={saveZone}
              onCancel={cancelEdit}
              saving={saveConfig.isLoading}
              editing={editingZone !== null}
              placingPoint={placingPoint}
              setPlacingPoint={setPlacingPoint}
            />
            {saveError && <p className="rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1 text-xs text-[var(--warn)]">{saveError}</p>}
            <div className="space-y-1 border-t border-[var(--line)] pt-3">
              {cameraZones.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">No hay zonas para esta cámara.</p>
              ) : cameraZones.map((zone, index) => (
                <div key={`${zone.name}-${index}`} className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-0)]">{zone.name}</span>
                    <span className="vms-pill info">{zone.threshold_seconds ?? zone.min_seconds}s</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-3)]">
                    {(zone.labels ?? []).join(", ") || "todos"} · {zone.polygon?.length ?? 0} puntos · {zone.severity ?? "medium"}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button type="button" onClick={() => editZone(index)} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]">Editar</button>
                    <button type="button" onClick={() => deleteZone(index)} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]">Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <ZonePreview
          camera={selectedCam}
          zones={cameraZones}
          draft={draft}
          editingIndex={editingZone}
          placingPoint={placingPoint}
          onPlacePoint={(index, value) => {
            setDraft((current) => {
              const polygon = current.polygon.map((p) => [...p] as [number, number]);
              polygon[index] = value;
              return { ...current, polygon };
            });
            setPlacingPoint(null);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Hoy" value={todayCount} />
        <StatCard label="Alta severidad" value={criticalCount} color="text-[var(--warn)]" />
        <StatCard label="Cámaras con zona" value={cameras.length} />
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Alertas de merodeo</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Zona</th>
                <th>Objeto</th>
                <th>Tiempo en zona</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={6}>Sin alertas de merodeo</td></tr>
              ) : allEvents.map((ev) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = ev.extra_metadata ?? {};
                const zone = (meta.zone_name as string) ?? (meta.zone as string) ?? "—";
                const label = (meta.label as string) ?? ev.label;
                const seconds = meta.time_in_zone_seconds ?? meta.time_in_zone;
                const elapsed = typeof seconds === "number" ? `${Math.round(seconds)}s` : "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td className="mono text-[11px]">{zone}</td>
                    <td>{label}</td>
                    <td className="mono text-[11px]">{elapsed}</td>
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

function ZoneRuleForm({ draft, setDraft, onSave, onCancel, saving, editing, placingPoint, setPlacingPoint }: {
  draft: ZoneRule;
  setDraft: (zone: ZoneRule) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  editing: boolean;
  placingPoint: number | null;
  setPlacingPoint: (index: number | null) => void;
}) {
  function setPoint(index: number, axis: 0 | 1, value: number) {
    const polygon = draft.polygon.map((p) => [...p] as [number, number]);
    polygon[index][axis] = Math.max(0, Math.min(1, value));
    setDraft({ ...draft, polygon });
  }
  function movePoint(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.polygon.length) return;
    const polygon = draft.polygon.map((p) => [...p] as [number, number]);
    [polygon[index], polygon[nextIndex]] = [polygon[nextIndex], polygon[index]];
    setDraft({ ...draft, polygon });
  }
  function toggleLabel(label: string) {
    const labels = draft.labels ?? [];
    setDraft({ ...draft, labels: labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label] });
  }
  return (
    <div className="space-y-2">
      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]" placeholder="Nombre de zona" />
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={10} value={draft.threshold_seconds} onChange={(e) => setDraft({ ...draft, threshold_seconds: Number(e.target.value), min_seconds: Number(e.target.value) })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]" />
        <input type="number" min={0} value={draft.alert_cooldown} onChange={(e) => setDraft({ ...draft, alert_cooldown: Number(e.target.value) })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]" />
        <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as ZoneRule["severity"] })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]">
          <option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option>
        </select>
        <button
          type="button"
          onClick={() => {
            const nextIndex = draft.polygon.length;
            setDraft({ ...draft, polygon: [...draft.polygon, [0.5, 0.5]] });
            setPlacingPoint(nextIndex);
          }}
          className="vms-btn !text-xs"
        >
          Agregar punto
        </button>
      </div>
      <div className="max-h-32 space-y-1 overflow-auto rounded border border-[var(--line)] p-1">
        {draft.polygon.map((point, index) => (
          <div key={index} className="grid grid-cols-[24px_1fr_1fr_44px_28px_28px_28px] gap-1">
            <span className="py-1 text-center text-[10px] text-[var(--text-3)]">{index + 1}</span>
            <input type="number" min={0} max={1} step={0.01} value={point[0]} onChange={(e) => setPoint(index, 0, Number(e.target.value))} className="rounded bg-[var(--bg-1)] px-1 py-1 text-xs text-[var(--text-0)]" />
            <input type="number" min={0} max={1} step={0.01} value={point[1]} onChange={(e) => setPoint(index, 1, Number(e.target.value))} className="rounded bg-[var(--bg-1)] px-1 py-1 text-xs text-[var(--text-0)]" />
            <button
              type="button"
              onClick={() => setPlacingPoint(placingPoint === index ? null : index)}
              className={`rounded text-[9px] ${placingPoint === index ? "bg-[var(--acc)] text-[var(--bg-0)]" : "bg-[var(--bg-1)] text-[var(--text-2)]"}`}
            >
              Colocar
            </button>
            <button type="button" disabled={index === 0} onClick={() => movePoint(index, -1)} className="rounded bg-[var(--bg-1)] text-[10px] text-[var(--text-2)] disabled:opacity-30">↑</button>
            <button type="button" disabled={index === draft.polygon.length - 1} onClick={() => movePoint(index, 1)} className="rounded bg-[var(--bg-1)] text-[10px] text-[var(--text-2)] disabled:opacity-30">↓</button>
            <button
              type="button"
              onClick={() => {
                setDraft({ ...draft, polygon: draft.polygon.filter((_, i) => i !== index) });
                setPlacingPoint(null);
              }}
              className="text-[var(--warn)]"
            >
              x
            </button>
          </div>
        ))}
      </div>
      {placingPoint !== null && (
        <p className="rounded border border-[var(--acc)]/40 bg-[var(--acc)]/10 px-2 py-1 text-[10px] text-[var(--acc)]">
          Clic sobre la imagen para colocar el punto {placingPoint + 1}.
        </p>
      )}
      <div className="grid grid-cols-3 gap-1">
        {LABELS.map((label) => (
          <label key={label} className="flex items-center gap-1 rounded bg-[var(--bg-1)] px-1.5 py-1 text-[10px] text-[var(--text-2)]">
            <input type="checkbox" checked={(draft.labels ?? []).includes(label)} onChange={() => toggleLabel(label)} className="accent-[var(--acc)]" />
            {label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {editing && (
          <button type="button" onClick={onCancel} disabled={saving} className="vms-btn w-full !text-xs disabled:opacity-50">
            Cancelar
          </button>
        )}
        <button type="button" onClick={onSave} disabled={saving || !draft.name.trim() || draft.polygon.length < 3} className={`vms-btn primary w-full !text-xs disabled:opacity-50 ${editing ? "" : "col-span-2"}`}>
          {saving ? "Guardando..." : editing ? "Actualizar zona" : "Agregar zona"}
        </button>
      </div>
    </div>
  );
}

function ZonePreview({
  camera,
  zones,
  draft,
  editingIndex,
  placingPoint,
  onPlacePoint,
}: {
  camera?: Camera;
  zones: ZoneRule[];
  draft: ZoneRule;
  editingIndex: number | null;
  placingPoint: number | null;
  onPlacePoint: (index: number, value: [number, number]) => void;
}) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);

  useEffect(() => {
    if (!camera) return;
    let url: string | null = null;
    setLoading(true);
    setSnapshotUrl(null);
    getCameraSnapshot(camera.id, { height: 720, quality: 85 })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setSnapshotUrl(url);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [camera?.id]);

  const previewZones = editingIndex === null
    ? zones
    : zones.map((zone, index) => index === editingIndex ? draft : zone);

  function getDivNorm(e: React.MouseEvent<HTMLDivElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (placingPoint === null) return;
    onPlacePoint(placingPoint, getDivNorm(e));
  }

  function getSvgNorm(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function handleSvgMove(e: React.MouseEvent<SVGSVGElement>) {
    if (draggingPoint === null) return;
    onPlacePoint(draggingPoint, getSvgNorm(e));
  }

  function stopDrag() {
    setDraggingPoint(null);
  }

  return (
    <div className="vms-card p-3">
      <div
        className={`relative aspect-video overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-2)] ${placingPoint !== null ? "cursor-crosshair ring-1 ring-[var(--acc)]" : ""}`}
        onClick={handleClick}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-3)]">Cargando imagen...</div>
        )}
        {!loading && !snapshotUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-3)]">
            <span className="text-3xl opacity-40">📷</span>
            <span>Sin snapshot disponible</span>
          </div>
        )}
        {snapshotUrl && <img src={snapshotUrl} alt="snapshot" className="h-full w-full object-contain" />}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onMouseMove={handleSvgMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          {previewZones.map((zone, i) => (
            <g key={`${zone.name}-${i}`}>
              <polygon points={zone.polygon.map((p) => `${p[0] * 100},${p[1] * 100}`).join(" ")} fill="rgba(0,201,255,0.16)" stroke={i === editingIndex ? "#facc15" : "var(--acc)"} strokeWidth="0.8" />
              {zone.polygon.map((p, pointIndex) => (
                <g key={pointIndex}>
                  <circle
                    cx={p[0] * 100}
                    cy={p[1] * 100}
                    r={i === editingIndex ? "2.4" : "1.6"}
                    fill={i === editingIndex && pointIndex === placingPoint ? "#facc15" : "var(--acc)"}
                    stroke="white"
                    strokeWidth="0.4"
                    style={{ cursor: i === editingIndex ? "grab" : "default" }}
                    onMouseDown={(e) => {
                      if (i !== editingIndex) return;
                      e.stopPropagation();
                      setDraggingPoint(pointIndex);
                    }}
                  />
                  <text x={p[0] * 100} y={p[1] * 100 - 2.6} fontSize="3" fill="white" textAnchor="middle">{pointIndex + 1}</text>
                </g>
              ))}
            </g>
          ))}
        </svg>
        <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-[10px] text-white">
          {camera?.display_name ?? "Camara"} · {zones.length} zonas{editingIndex !== null ? " · editando" : ""}
        </div>
        {placingPoint !== null && (
          <div className="absolute bottom-3 left-3 rounded bg-[var(--acc)] px-2 py-1 text-[10px] font-semibold text-[var(--bg-0)]">
            Clic para colocar punto {placingPoint + 1}
          </div>
        )}
        {editingIndex !== null && placingPoint === null && (
          <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
            Arrastrá cualquier punto para mover la zona
          </div>
        )}
      </div>
    </div>
  );
}
