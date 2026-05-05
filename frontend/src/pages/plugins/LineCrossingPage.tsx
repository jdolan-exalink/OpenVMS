import { useEffect, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { Camera, getCameraSnapshot, listCameras } from "../../api/cameras";
import { listPlugins, updatePluginConfig } from "../../api/plugins";

type LineRule = {
  name: string;
  p1: [number, number];
  p2: [number, number];
  directions: ("AB" | "BA" | "BOTH")[];
  enter_direction: "AB" | "BA";
  severity: "low" | "medium" | "high" | "critical";
  alert_cooldown: number;
  labels: string[];
};

const LABELS = ["person", "car", "truck", "bus", "motorcycle", "bicycle"];

const DEFAULT_LINE: LineRule = {
  name: "entrada",
  p1: [0.25, 0.5],
  p2: [0.75, 0.5],
  directions: ["AB", "BA"],
  enter_direction: "AB",
  severity: "medium",
  alert_cooldown: 10,
  labels: ["person"],
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function LineCrossingPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("lc-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];
  const pluginsQ = useQuery("lc-plugins", listPlugins);
  const plugin = pluginsQ.data?.find((p) => p.name === "line_crossing");
  const config = (plugin?.config ?? {}) as { lines?: Record<string, LineRule[]> };
  const selectedCam = cameras.find((c) => c.id === cameraId) ?? cameras[0];
  const selectedKey = selectedCam?.frigate_name || selectedCam?.name || "";
  const cameraLines = selectedKey ? config.lines?.[selectedKey] ?? [] : [];
  const [draft, setDraft] = useState<LineRule>(DEFAULT_LINE);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [placingPoint, setPlacingPoint] = useState<"p1" | "p2" | null>(null);

  const saveConfig = useMutation(
    (next: Record<string, unknown>) => updatePluginConfig("line_crossing", next),
    { onSuccess: () => pluginsQ.refetch() },
  );

  async function saveLine() {
    if (!selectedKey || !draft.name.trim()) return;
    setSaveError(null);
    const nextLines = [...cameraLines];
    const clean: LineRule = { ...draft, name: draft.name.trim() };
    if (editingLine === null) nextLines.push(clean);
    else nextLines[editingLine] = clean;
    try {
      await saveConfig.mutateAsync({
        ...config,
        lines: { ...(config.lines ?? {}), [selectedKey]: nextLines },
      });
      setDraft(DEFAULT_LINE);
      setEditingLine(null);
      setPlacingPoint(null);
    } catch {
      setSaveError("No se pudo guardar la línea. Revisá permisos o conexión con el backend.");
    }
  }

  function editLine(index: number) {
    const line = cameraLines[index];
    setDraft({
      ...line,
      p1: [...line.p1] as [number, number],
      p2: [...line.p2] as [number, number],
      directions: [...(line.directions ?? ["AB", "BA"])],
      labels: [...(line.labels ?? [])],
    });
    setEditingLine(index);
    setPlacingPoint(null);
    setSaveError(null);
  }

  function cancelEdit() {
    setDraft(DEFAULT_LINE);
    setEditingLine(null);
    setPlacingPoint(null);
    setSaveError(null);
  }

  function deleteLine(index: number) {
    if (!selectedKey) return;
    const nextLines = cameraLines.filter((_, i) => i !== index);
    saveConfig.mutate({
      ...config,
      lines: { ...(config.lines ?? {}), [selectedKey]: nextLines },
    });
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["lc-stats"],
    () => listEvents({ label: "line_crossing", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const todayCount = statsData?.items.length ?? 0;
  const abCount = statsData?.items.filter((e) => (e.extra_metadata as Record<string, unknown>)?.direction === "AB").length ?? 0;
  const baCount = statsData?.items.filter((e) => (e.extra_metadata as Record<string, unknown>)?.direction === "BA").length ?? 0;

  const { isLoading } = useQuery(
    ["lc-events", cameraId],
    () => listEvents({
      label: "line_crossing",
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
        label: "line_crossing", source: "plugin",
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
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">➡ Cruce de línea</h2>
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
            <LineRuleForm
              draft={draft}
              setDraft={setDraft}
              onSave={saveLine}
              onCancel={cancelEdit}
              saving={saveConfig.isLoading}
              editing={editingLine !== null}
              placingPoint={placingPoint}
              setPlacingPoint={setPlacingPoint}
            />
            {saveError && <p className="rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1 text-xs text-[var(--warn)]">{saveError}</p>}
            <div className="space-y-1 border-t border-[var(--line)] pt-3">
              {cameraLines.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">No hay líneas para esta cámara.</p>
              ) : cameraLines.map((line, index) => (
                <div key={`${line.name}-${index}`} className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-0)]">{line.name}</span>
                    <span className="vms-pill info">{line.severity ?? "medium"}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-3)]">
                    {line.p1?.join(",")} → {line.p2?.join(",")} · {(line.labels ?? []).join(", ") || "todos"}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button type="button" onClick={() => editLine(index)} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]">Editar</button>
                    <button type="button" onClick={() => deleteLine(index)} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]">Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <LinePreview
          camera={selectedCam}
          lines={cameraLines}
          draft={draft}
          editingIndex={editingLine}
          placingPoint={placingPoint}
          onPlacePoint={(point, value) => {
            setDraft((current) => ({ ...current, [point]: value }));
            setPlacingPoint(point === "p1" ? "p2" : null);
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Cruces hoy</span>
          <span className="text-2xl font-bold text-[var(--text-0)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">A → B</span>
          <span className="text-2xl font-bold text-[var(--acc)]">{abCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">B → A</span>
          <span className="text-2xl font-bold text-blue-400">{baCount}</span>
        </div>
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Cruces de línea</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{allEvents.length} cargados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Línea</th>
                <th>Dirección</th>
                <th>Objeto</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6}>Cargando...</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={6}>Sin cruces detectados</td></tr>
              ) : allEvents.map((ev) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const lineName = (meta.line_name as string) ?? "—";
                const direction = (meta.direction as string) ?? "—";
                const label = (meta.label as string) ?? "—";
                const dirColor = direction === "AB" ? "text-[var(--acc)]" : "text-blue-400";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td className="mono text-[11px]">{lineName}</td>
                    <td className={`mono text-[11px] font-semibold ${dirColor}`}>{direction}</td>
                    <td>{label}</td>
                    <td>
                      {ev.severity
                        ? <span className="vms-pill info">{ev.severity}</span>
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

function LineRuleForm({ draft, setDraft, onSave, onCancel, saving, editing, placingPoint, setPlacingPoint }: {
  draft: LineRule;
  setDraft: (line: LineRule) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  editing: boolean;
  placingPoint: "p1" | "p2" | null;
  setPlacingPoint: (point: "p1" | "p2" | null) => void;
}) {
  function setPoint(point: "p1" | "p2", axis: 0 | 1, value: number) {
    const next = [...draft[point]] as [number, number];
    next[axis] = Math.max(0, Math.min(1, value));
    setDraft({ ...draft, [point]: next });
  }
  function toggleLabel(label: string) {
    const labels = draft.labels ?? [];
    setDraft({ ...draft, labels: labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label] });
  }
  return (
    <div className="space-y-2">
      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]" placeholder="Nombre de línea" />
      <div className="grid grid-cols-2 gap-2">
        {(["p1", "p2"] as const).map((point) => (
          <div key={point} className="rounded border border-[var(--line)] p-2">
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[10px] text-[var(--text-3)]">{point.toUpperCase()}</span>
              <button
                type="button"
                onClick={() => setPlacingPoint(placingPoint === point ? null : point)}
                className={`ml-auto rounded px-1.5 py-0.5 text-[9px] ${placingPoint === point ? "bg-[var(--acc)] text-[var(--bg-0)]" : "bg-[var(--bg-1)] text-[var(--text-2)]"}`}
              >
                Colocar
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <input type="number" min={0} max={1} step={0.01} value={draft[point][0]} onChange={(e) => setPoint(point, 0, Number(e.target.value))} className="rounded bg-[var(--bg-1)] px-1 py-1 text-xs text-[var(--text-0)]" />
              <input type="number" min={0} max={1} step={0.01} value={draft[point][1]} onChange={(e) => setPoint(point, 1, Number(e.target.value))} className="rounded bg-[var(--bg-1)] px-1 py-1 text-xs text-[var(--text-0)]" />
            </div>
          </div>
        ))}
      </div>
      {placingPoint && (
        <p className="rounded border border-[var(--acc)]/40 bg-[var(--acc)]/10 px-2 py-1 text-[10px] text-[var(--acc)]">
          Clic sobre la imagen para colocar {placingPoint.toUpperCase()}.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setDraft({ ...draft, p1: [...draft.p2] as [number, number], p2: [...draft.p1] as [number, number] })}
          className="vms-btn !text-xs"
        >
          Invertir puntos
        </button>
        <select value={draft.enter_direction} onChange={(e) => setDraft({ ...draft, enter_direction: e.target.value as "AB" | "BA" })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]">
          <option value="AB">Entrada AB</option><option value="BA">Entrada BA</option>
        </select>
        <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as LineRule["severity"] })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]">
          <option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option>
        </select>
      </div>
      <div>
        <input type="number" min={0} value={draft.alert_cooldown} onChange={(e) => setDraft({ ...draft, alert_cooldown: Number(e.target.value) })} className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)]" />
      </div>
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
        <button type="button" onClick={onSave} disabled={saving || !draft.name.trim()} className={`vms-btn primary w-full !text-xs disabled:opacity-50 ${editing ? "" : "col-span-2"}`}>
          {saving ? "Guardando..." : editing ? "Actualizar línea" : "Agregar línea"}
        </button>
      </div>
    </div>
  );
}

function LinePreview({
  camera,
  lines,
  draft,
  editingIndex,
  placingPoint,
  onPlacePoint,
}: {
  camera?: Camera;
  lines: LineRule[];
  draft: LineRule;
  editingIndex: number | null;
  placingPoint: "p1" | "p2" | null;
  onPlacePoint: (point: "p1" | "p2", value: [number, number]) => void;
}) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draggingPoint, setDraggingPoint] = useState<"p1" | "p2" | null>(null);

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

  const previewLines = editingIndex === null
    ? lines
    : lines.map((line, index) => index === editingIndex ? draft : line);

  function getDivNorm(e: React.MouseEvent<HTMLDivElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placingPoint) return;
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
    if (!draggingPoint) return;
    onPlacePoint(draggingPoint, getSvgNorm(e));
  }

  function stopDrag() {
    setDraggingPoint(null);
  }

  return (
    <div className="vms-card p-3">
      <div
        className={`relative aspect-video overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-2)] ${placingPoint ? "cursor-crosshair ring-1 ring-[var(--acc)]" : ""}`}
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
          {previewLines.map((line, i) => (
            <g key={`${line.name}-${i}`}>
              <line x1={line.p1[0] * 100} y1={line.p1[1] * 100} x2={line.p2[0] * 100} y2={line.p2[1] * 100} stroke={i === editingIndex ? "#facc15" : "var(--acc)"} strokeWidth="1.2" />
              <circle
                cx={line.p1[0] * 100}
                cy={line.p1[1] * 100}
                r={i === editingIndex ? "2.6" : "1.8"}
                fill="var(--acc)"
                stroke="white"
                strokeWidth="0.45"
                style={{ cursor: i === editingIndex ? "grab" : "default" }}
                onMouseDown={(e) => {
                  if (i !== editingIndex) return;
                  e.stopPropagation();
                  setDraggingPoint("p1");
                }}
              />
              <circle
                cx={line.p2[0] * 100}
                cy={line.p2[1] * 100}
                r={i === editingIndex ? "2.6" : "1.8"}
                fill="#60a5fa"
                stroke="white"
                strokeWidth="0.45"
                style={{ cursor: i === editingIndex ? "grab" : "default" }}
                onMouseDown={(e) => {
                  if (i !== editingIndex) return;
                  e.stopPropagation();
                  setDraggingPoint("p2");
                }}
              />
              <text x={line.p1[0] * 100} y={line.p1[1] * 100 - 3} fontSize="3" fill="white" textAnchor="middle">P1</text>
              <text x={line.p2[0] * 100} y={line.p2[1] * 100 - 3} fontSize="3" fill="white" textAnchor="middle">P2</text>
            </g>
          ))}
        </svg>
        <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-[10px] text-white">
          {camera?.display_name ?? "Camara"} · {lines.length} líneas{editingIndex !== null ? " · editando" : ""}
        </div>
        {placingPoint && (
          <div className="absolute bottom-3 left-3 rounded bg-[var(--acc)] px-2 py-1 text-[10px] font-semibold text-[var(--bg-0)]">
            Clic para colocar {placingPoint.toUpperCase()}
          </div>
        )}
        {editingIndex !== null && !placingPoint && (
          <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
            Arrastrá P1 o P2 para mover la línea
          </div>
        )}
      </div>
    </div>
  );
}
