/**
 * PeopleCountingPage — Dashboard + editor visual de líneas de conteo.
 *
 * Coordenadas: normalizadas 0–1 (mismo sistema que Frigate bboxes).
 * La línea divide el frame en dos semiplanos; "in" = cruzar desde el
 * lado positivo al negativo (flecha perpendicular 90° CW a p1→p2).
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { Camera, listCameras, getCameraSnapshot } from "../../api/cameras";
import {
  CounterData,
  deletePeopleCountingHistory,
  getPeopleCountingHistory,
  getPluginCounts,
  listPlugins,
  resetPluginCounts,
  updatePluginConfig,
} from "../../api/plugins";

// ── Types ────────────────────────────────────────────────────────────────────

interface CountingLine {
  id: string;
  name: string;
  zone: string;
  p1: [number, number];
  p2: [number, number];
  labels: string[];
  enter_direction: "in" | "out";
}

type DrawPhase = "idle" | "p1" | "p2";

interface DraftLine {
  p1?: [number, number];
  p2?: [number, number];
}

const LINE_COLORS = ["#00d084","#5b9dff","#b07cff","#ff7a59","#ffd166","#ff6b9d","#00c8ff"];
const COMMON_LABELS = ["person","car","truck","bus","motorcycle","bicycle"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2);
}

function configToLines(raw: unknown[]): CountingLine[] {
  return raw.map((l: any, i) => ({
    id: uid(),
    name: l.name ?? `Línea ${i + 1}`,
    zone: l.zone ?? "default",
    p1: l.p1 as [number, number],
    p2: l.p2 as [number, number],
    labels: (l.labels as string[]) ?? ["person"],
    enter_direction: (l.enter_direction as "in" | "out") ?? "in",
  }));
}

function linesToConfig(lines: CountingLine[]) {
  return lines.map(({ name, zone, p1, p2, labels, enter_direction }) => ({
    name,
    zone,
    p1,
    p2,
    labels,
    enter_direction,
  }));
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PeopleCountingPage() {
  const [tab, setTab] = useState<"dashboard" | "config">("dashboard");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--bg-1)] px-4 py-2">
        <span className="mr-2 text-lg">👥</span>
        <h1 className="mr-4 text-sm font-bold text-[var(--text-0)]">Conteo de Personas</h1>
        {(["dashboard", "config"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1 text-xs transition ${
              tab === t
                ? "bg-[var(--acc)] font-semibold text-[var(--bg-0)]"
                : "text-[var(--text-2)] hover:text-[var(--text-0)]"
            }`}
          >
            {t === "dashboard" ? "Dashboard" : "Configurar líneas"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "dashboard" ? <DashboardTab /> : <ConfigTab />}
      </div>
    </div>
  );
}

// ── Dashboard Tab ────────────────────────────────────────────────────────────

function parseCounters(data: CounterData) {
  const rows: { camera: string; zone: string; entries: { label: string; in: number; out: number }[]; total_in: number; total_out: number }[] = [];
  for (const [camera, zones] of Object.entries(data)) {
    for (const [zone, counts] of Object.entries(zones)) {
      const map: Record<string, { in: number; out: number }> = {};
      for (const [key, val] of Object.entries(counts)) {
        const [label, dir] = key.split("_");
        if (!map[label]) map[label] = { in: 0, out: 0 };
        if (dir === "enter" || dir === "in") map[label].in += val;
        if (dir === "exit" || dir === "out") map[label].out += val;
      }
      const entries = Object.entries(map).map(([label, c]) => ({ label, ...c }));
      rows.push({ camera, zone, entries, total_in: entries.reduce((s, e) => s + e.in, 0), total_out: entries.reduce((s, e) => s + e.out, 0) });
    }
  }
  return rows;
}

const LABEL_ICONS: Record<string, string> = { person:"🚶", car:"🚗", truck:"🚚", bus:"🚌", motorcycle:"🏍", bicycle:"🚲" };

function DashboardTab() {
  const countsQ = useQuery(["pc-counts"], () => getPluginCounts(), { refetchInterval: 5000 });
  const [daysBack, setDaysBack] = useState(0);
  const historyQ = useQuery(["pc-history", daysBack], () => getPeopleCountingHistory({ days_back: daysBack }), { refetchInterval: 30000 });
  const data = countsQ.data ?? {};
  const rows = parseCounters(data);
  const resetMut = useMutation(({ camera, zone }: { camera?: string; zone?: string }) => resetPluginCounts(camera, zone), { onSuccess: () => countsQ.refetch() });

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => countsQ.refetch()} className="vms-btn !text-xs">Actualizar</button>
        <button type="button" disabled={rows.length === 0} onClick={() => resetMut.mutate({})} className="vms-btn !text-xs !text-[var(--warn)] disabled:opacity-40">Resetear todo</button>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-16 text-center">
          <span className="text-5xl">📊</span>
          <p className="text-sm text-[var(--text-2)]">Sin datos de conteo aún</p>
          <p className="text-xs text-[var(--text-3)]">Configura las líneas de conteo en la pestaña "Configurar líneas"</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <div key={`${row.camera}-${row.zone}`} className="vms-card">
              <div className="vms-card-hd">
                <div>
                  <div className="mono text-xs font-semibold text-[var(--text-0)]">{row.camera}</div>
                  <div className="text-[10px] text-[var(--text-3)]">Zona: {row.zone}</div>
                </div>
                <button type="button" onClick={() => resetMut.mutate({ camera: row.camera, zone: row.zone })} className="vms-btn !h-5 !min-h-0 !px-2 !text-[9px] !text-[var(--text-3)]">Reset</button>
              </div>
              <div className="flex border-b border-[var(--line)] px-4 py-3">
                {[{ label: "Entradas", val: row.total_in, color: "text-[var(--acc)]" }, { label: "Salidas", val: row.total_out, color: "text-[var(--info)]" }, { label: "Dentro", val: row.total_in - row.total_out, color: row.total_in - row.total_out >= 0 ? "text-[var(--text-0)]" : "text-[var(--warn)]" }].map(({ label, val, color }) => (
                  <div key={label} className="flex-1 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{val}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{label}</div>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-[var(--line-2)]">
                {row.entries.map((e) => (
                  <div key={e.label} className="flex items-center gap-2 px-4 py-2 text-xs">
                    <span className="text-base">{LABEL_ICONS[e.label] ?? "📦"}</span>
                    <span className="flex-1 capitalize text-[var(--text-1)]">{e.label}</span>
                    <span className="mono text-[var(--acc)]">↑{e.in}</span>
                    <span className="mono text-[var(--info)]">↓{e.out}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <HistoryPanel
        daysBack={daysBack}
        onDaysBackChange={setDaysBack}
        data={historyQ.data}
        isLoading={historyQ.isLoading}
        onChanged={() => {
          historyQ.refetch();
          countsQ.refetch();
        }}
      />
    </div>
  );
}

function HistoryPanel({
  daysBack,
  onDaysBackChange,
  data,
  isLoading,
  onChanged,
}: {
  daysBack: number;
  onDaysBackChange: (daysBack: number) => void;
  data?: Awaited<ReturnType<typeof getPeopleCountingHistory>>;
  isLoading: boolean;
  onChanged: () => void;
}) {
  const deleteHistoryMut = useMutation(deletePeopleCountingHistory, { onSuccess: onChanged });
  const cameras = data?.cameras ?? [];
  const hours = data?.hours ?? [];
  const maxValue = Math.max(
    1,
    ...cameras.flatMap((camera) => camera.hours.map((bucket) => bucket.enter + bucket.exit)),
  );

  return (
    <div className="mt-6 border-t border-[var(--line)] pt-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-0)]">Histórico 24 horas</h2>
          <p className="text-[10px] text-[var(--text-3)]">
            {data ? `${formatShortDate(data.start)} - ${formatShortDate(data.end)}` : "Cargando histórico"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={daysBack}
            onChange={(e) => onDaysBackChange(Number(e.target.value))}
            className="vms-select !h-8 !min-h-0 !text-xs"
          >
            <option value={0}>Últimas 24 horas</option>
            <option value={1}>Ayer</option>
            <option value={2}>Hace 2 días</option>
            <option value={3}>Hace 3 días</option>
            <option value={7}>Hace 7 días</option>
          </select>
        </div>
      </div>

      <div className="vms-card overflow-hidden">
        {isLoading ? (
          <div className="p-5 text-xs text-[var(--text-3)]">Cargando histórico...</div>
        ) : cameras.length === 0 ? (
          <div className="p-5 text-xs text-[var(--text-3)]">Sin histórico para este período.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[140px_repeat(24,minmax(28px,1fr))_92px] border-b border-[var(--line)] bg-[var(--bg-1)]">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase text-[var(--text-3)]">Cámara</div>
                {hours.map((hour) => (
                  <div key={hour} className="px-1 py-2 text-center text-[10px] text-[var(--text-3)]">
                    {formatHour(hour)}
                  </div>
                ))}
                <div className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-[var(--text-3)]">Total</div>
              </div>

              {cameras.map((camera, index) => (
                <div key={camera.camera_name} className="grid grid-cols-[140px_repeat(24,minmax(28px,1fr))_92px] border-b border-[var(--line-2)] last:border-b-0">
                  <div className="flex items-center gap-2 px-3 py-3">
                    <span className="h-8 w-1 rounded-full" style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
                    <div className="min-w-0">
                      <div className="mono truncate text-xs font-semibold text-[var(--text-0)]">{camera.camera_name}</div>
                      <button
                        type="button"
                        disabled={deleteHistoryMut.isLoading}
                        onClick={() => deleteHistoryMut.mutate(camera.camera_name)}
                        className="text-[9px] text-[var(--warn)] hover:underline disabled:opacity-40"
                      >
                        Borrar histórico
                      </button>
                    </div>
                  </div>

                  {camera.hours.map((bucket) => (
                    <div key={bucket.hour} className="flex items-end justify-center px-1 py-2" title={`${formatHour(bucket.hour)} · Entradas ${bucket.enter} · Salidas ${bucket.exit}`}>
                      <div className="flex h-16 w-full max-w-[18px] flex-col justify-end overflow-hidden rounded-sm bg-[var(--bg-3)]">
                        <div
                          className="bg-[var(--info)]"
                          style={{ height: `${Math.max(bucket.exit ? 4 : 0, (bucket.exit / maxValue) * 64)}px` }}
                        />
                        <div
                          className="bg-[var(--acc)]"
                          style={{ height: `${Math.max(bucket.enter ? 4 : 0, (bucket.enter / maxValue) * 64)}px` }}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-col justify-center px-3 py-2 text-right">
                    <span className="mono text-xs text-[var(--acc)]">↑{camera.total_enter}</span>
                    <span className="mono text-xs text-[var(--info)]">↓{camera.total_exit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-4 text-[10px] text-[var(--text-3)]">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--acc)]" />Entradas</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--info)]" />Salidas</span>
      </div>
    </div>
  );
}

function formatHour(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", hour12: false });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit" });
}

// ── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
  const camerasQ = useQuery("cameras-pc", () => listCameras({ enabled: true }));
  const pluginsQ = useQuery("plugins-pc", listPlugins);
  const cameras = camerasQ.data?.items ?? [];

  const plugin = pluginsQ.data?.find((p) => p.name === "people_counting");
  const fullConfig = (plugin?.config ?? {}) as Record<string, unknown>;
  const countingLines = (fullConfig.counting_lines ?? {}) as Record<string, unknown[]>;

  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [localLines, setLocalLines] = useState<CountingLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load lines for selected camera
  useEffect(() => {
    if (!selectedCamera) return;
    const raw = countingLines[selectedCamera.frigate_name] ?? [];
    setLocalLines(configToLines(raw));
    setDirty(false);
    setSaved(false);
  }, [selectedCamera?.id, plugin?.config]);

  const saveMut = useMutation(
    () => {
      const updated = {
        ...fullConfig,
        counting_lines: {
          ...countingLines,
          [selectedCamera!.frigate_name]: linesToConfig(localLines),
        },
      };
      return updatePluginConfig("people_counting", updated);
    },
    {
      onSuccess: () => {
        setDirty(false);
        setSaved(true);
        pluginsQ.refetch();
        setTimeout(() => setSaved(false), 2000);
      },
    },
  );

  function handleLinesChange(lines: CountingLine[]) {
    setLocalLines(lines);
    setDirty(true);
    setSaved(false);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Camera list */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-1)] overflow-hidden">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Cámaras ({cameras.length})
        </div>
        <div className="flex-1 overflow-y-auto">
          {cameras.map((cam) => {
            const lineCount = (countingLines[cam.frigate_name] ?? []).length;
            const isSelected = selectedCamera?.id === cam.id;
            return (
              <button
                key={cam.id}
                type="button"
                onClick={() => setSelectedCamera(cam)}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-[var(--bg-2)] ${isSelected ? "bg-[var(--acc-soft)] border-r-2 border-[var(--acc)]" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-xs font-medium ${isSelected ? "text-[var(--acc-strong)]" : "text-[var(--text-0)]"}`}>
                    {cam.display_name}
                  </div>
                  <div className="mono truncate text-[10px] text-[var(--text-3)]">{cam.frigate_name}</div>
                </div>
                {lineCount > 0 && (
                  <span className="mt-0.5 shrink-0 rounded-full bg-[var(--acc)]/20 px-1.5 py-px text-[9px] font-semibold text-[var(--acc)]">
                    {lineCount}
                  </span>
                )}
              </button>
            );
          })}
          {cameras.length === 0 && (
            <p className="p-3 text-[11px] text-[var(--text-3)]">Sin cámaras habilitadas</p>
          )}
        </div>
      </aside>

      {/* Editor area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedCamera ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="text-4xl">👈</span>
            <p className="text-sm text-[var(--text-2)]">Selecciona una cámara para configurar sus líneas</p>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2">
              <span className="text-sm font-semibold text-[var(--text-0)]">{selectedCamera.display_name}</span>
              <span className="mono text-xs text-[var(--text-3)]">{selectedCamera.frigate_name}</span>
              <div className="ml-auto flex gap-2">
                {dirty && (
                  <span className="text-[10px] text-[var(--warn)]">● Cambios sin guardar</span>
                )}
                {saved && (
                  <span className="text-[10px] text-[var(--acc)]">✓ Guardado</span>
                )}
                <button
                  type="button"
                  disabled={!dirty || saveMut.isLoading}
                  onClick={() => saveMut.mutate()}
                  className="vms-btn primary !text-xs disabled:opacity-40"
                >
                  {saveMut.isLoading ? "Guardando…" : "Guardar configuración"}
                </button>
              </div>
            </div>

            {/* Editor main area */}
            <LineEditor
              camera={selectedCamera}
              lines={localLines}
              onChange={handleLinesChange}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Line Editor ──────────────────────────────────────────────────────────────

interface LineEditorProps {
  camera: Camera;
  lines: CountingLine[];
  onChange: (lines: CountingLine[]) => void;
}

function LineEditor({ camera, lines, onChange }: LineEditorProps) {
  const [phase, setPhase] = useState<DrawPhase>("idle");
  const [draft, setDraft] = useState<DraftLine>({});
  const [mouseNorm, setMouseNorm] = useState<[number, number] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pendingLine, setPendingLine] = useState<Pick<CountingLine, "p1" | "p2"> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Load snapshot
  useEffect(() => {
    let url: string | null = null;
    setSnapLoading(true);
    setSnapshotUrl(null);
    getCameraSnapshot(camera.id)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setSnapshotUrl(url);
      })
      .catch(() => {})
      .finally(() => setSnapLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [camera.id]);

  function cancelDraw() {
    setPhase("idle");
    setDraft({});
    setMouseNorm(null);
  }

  function getSvgNorm(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (phase === "idle") return;
    e.stopPropagation();
    const pos = getSvgNorm(e);
    if (phase === "p1") {
      setDraft({ p1: pos });
      setPhase("p2");
    } else if (phase === "p2" && draft.p1) {
      const p1 = draft.p1;
      const p2 = pos;
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      if (Math.sqrt(dx * dx + dy * dy) < 0.02) return; // too short
      setPendingLine({ p1, p2 });
      setDraft({});
      setPhase("idle");
      setMouseNorm(null);
      setShowForm(true);
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (phase === "idle") return;
    setMouseNorm(getSvgNorm(e));
  }

  function handleMouseLeave() {
    if (phase !== "idle") setMouseNorm(null);
  }

  function handleFormConfirm(name: string, zone: string, labels: string[], enterDirection: "in" | "out") {
    setShowForm(false);
    if (!pendingLine) return;
    const newLine: CountingLine = { id: uid(), name, zone, labels, ...pendingLine, enter_direction: enterDirection };
    if (editingId) {
      onChange(lines.map((l) => l.id === editingId ? { ...l, name, zone, labels, enter_direction: enterDirection } : l));
      setEditingId(null);
    } else {
      onChange([...lines, newLine]);
    }
    setPendingLine(null);
  }

  function handleFormCancel() {
    setShowForm(false);
    setPendingLine(null);
    setEditingId(null);
  }

  function handleDeleteLine(id: string) {
    onChange(lines.filter((l) => l.id !== id));
  }

  function handleEditLine(line: CountingLine) {
    setEditingId(line.id);
    setPendingLine({ p1: line.p1, p2: line.p2 });
    setShowForm(true);
  }

  const editing = editingId ? lines.find((l) => l.id === editingId) : undefined;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Canvas area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[var(--bg-0)] p-4">
        {/* Controls */}
        <div className="mb-3 flex items-center gap-2">
          {phase === "idle" ? (
            <button
              type="button"
              onClick={() => setPhase("p1")}
              className="vms-btn primary !text-xs"
            >
              + Nueva línea
            </button>
          ) : (
            <>
              <span className="text-xs text-[var(--acc)]">
                {phase === "p1" ? "Clic para colocar punto inicial" : "Clic para colocar punto final"}
              </span>
              <button type="button" onClick={cancelDraw} className="vms-btn !text-xs !text-[var(--warn)]">
                Cancelar (Esc)
              </button>
            </>
          )}
          {lines.length > 0 && phase === "idle" && (
            <span className="mono ml-auto text-[10px] text-[var(--text-3)]">{lines.length} línea{lines.length !== 1 ? "s" : ""} configurada{lines.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* Canvas */}
        <div className="relative flex-1 overflow-hidden rounded border border-[var(--line)]">
          {snapLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-1)]">
              <span className="text-xs text-[var(--text-3)]">Cargando snapshot…</span>
            </div>
          )}
          {!snapLoading && !snapshotUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-1)]">
              <span className="text-4xl opacity-30">📷</span>
              <span className="text-xs text-[var(--text-3)]">Sin imagen de cámara</span>
            </div>
          )}
          {snapshotUrl && (
            <img
              src={snapshotUrl}
              alt="snapshot"
              className="h-full w-full object-contain"
              style={{ display: "block" }}
            />
          )}

          {/* SVG overlay */}
          <svg
            ref={svgRef}
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            style={{ cursor: phase !== "idle" ? "crosshair" : "default" }}
            onClick={handleSvgClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <marker id="pc-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="white" opacity="0.9" />
              </marker>
            </defs>

            {/* Existing lines */}
            {lines.map((line, i) => (
              <LineOverlay
                key={line.id}
                line={line}
                color={LINE_COLORS[i % LINE_COLORS.length]}
                onDelete={() => handleDeleteLine(line.id)}
                onEdit={() => handleEditLine(line)}
              />
            ))}

            {/* Draft line */}
            {phase === "p2" && draft.p1 && (
              <>
                <circle cx={draft.p1[0]} cy={draft.p1[1]} r="0.012" fill="white" stroke="rgba(0,0,0,0.5)" strokeWidth="0.002" />
                {mouseNorm && (
                  <>
                    <line
                      x1={draft.p1[0]} y1={draft.p1[1]}
                      x2={mouseNorm[0]} y2={mouseNorm[1]}
                      stroke="white" strokeWidth="0.004" strokeDasharray="0.02 0.01" opacity="0.8"
                    />
                    <circle cx={mouseNorm[0]} cy={mouseNorm[1]} r="0.01" fill="white" opacity="0.7" />
                  </>
                )}
              </>
            )}

            {/* P1 placement ghost */}
            {phase === "p1" && mouseNorm && (
              <circle cx={mouseNorm[0]} cy={mouseNorm[1]} r="0.012" fill="white" opacity="0.5" stroke="white" strokeWidth="0.002" />
            )}
          </svg>
        </div>

        {/* Legend */}
        {lines.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {lines.map((line, i) => (
              <div key={line.id} className="flex items-center gap-1.5 text-[10px] text-[var(--text-2)]">
                <span className="inline-block h-2 w-4 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
                <span className="font-medium">{line.name}</span>
                <span className="text-[var(--text-3)]">({line.zone})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lines panel */}
      <aside className="flex w-60 shrink-0 flex-col border-l border-[var(--line)] overflow-hidden">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Líneas configuradas
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--line)]">
          {lines.length === 0 ? (
            <p className="p-3 text-[11px] text-[var(--text-3)]">
              Haz clic en "+ Nueva línea" y dibuja sobre el frame.
            </p>
          ) : (
            lines.map((line, i) => (
              <LineCard
                key={line.id}
                line={line}
                color={LINE_COLORS[i % LINE_COLORS.length]}
                onEdit={() => handleEditLine(line)}
                onDelete={() => handleDeleteLine(line.id)}
              />
            ))
          )}
        </div>

        {/* Tips */}
        <div className="border-t border-[var(--line)] p-3 space-y-1">
          <p className="text-[9px] text-[var(--text-3)] leading-relaxed">
            <span className="text-[var(--acc)]">→</span> La flecha indica la dirección configurada como <strong>Entrada</strong>.
          </p>
          <p className="text-[9px] text-[var(--text-3)] leading-relaxed">
            <span className="text-[var(--text-2)]">P1 → P2:</span> define el sentido de la línea.
          </p>
        </div>
      </aside>

      {/* Line form modal */}
      {showForm && (
        <LineFormModal
          initialName={editing?.name}
          initialZone={editing?.zone}
          initialLabels={editing?.labels}
          initialEnterDirection={editing?.enter_direction}
          onConfirm={handleFormConfirm}
          onCancel={handleFormCancel}
        />
      )}
    </div>
  );
}

// ── SVG Line Overlay ─────────────────────────────────────────────────────────

function LineOverlay({ line, color, onDelete, onEdit }: { line: CountingLine; color: string; onDelete: () => void; onEdit: () => void }) {
  const [hovered, setHovered] = useState(false);

  const mx = (line.p1[0] + line.p2[0]) / 2;
  const my = (line.p1[1] + line.p2[1]) / 2;
  const dx = line.p2[0] - line.p1[0];
  const dy = line.p2[1] - line.p1[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Physical "in" direction = 90° CW of (p1→p2). Flip it if the configured entry is "out".
  const enterSign = line.enter_direction === "out" ? -1 : 1;
  const inX = (dy / len) * enterSign;
  const inY = (-dx / len) * enterSign;
  const arrowLen = 0.06;

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ filter: hovered ? "drop-shadow(0 0 2px rgba(255,255,255,0.4))" : "none" }}
    >
      {/* Shadow / hit area */}
      <line x1={line.p1[0]} y1={line.p1[1]} x2={line.p2[0]} y2={line.p2[1]} stroke="transparent" strokeWidth="0.04" />

      {/* Main line */}
      <line
        x1={line.p1[0]} y1={line.p1[1]}
        x2={line.p2[0]} y2={line.p2[1]}
        stroke={color} strokeWidth="0.005" strokeLinecap="round"
        opacity="0.9"
      />

      {/* End points */}
      <circle cx={line.p1[0]} cy={line.p1[1]} r="0.012" fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="0.002" />
      <circle cx={line.p2[0]} cy={line.p2[1]} r="0.012" fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="0.002" />

      {/* P1 / P2 labels */}
      <text x={line.p1[0] - 0.018} y={line.p1[1] - 0.018} fontSize="0.022" fill="white" textAnchor="middle" fontWeight="bold" opacity="0.9">P1</text>
      <text x={line.p2[0] + 0.018} y={line.p2[1] - 0.018} fontSize="0.022" fill="white" textAnchor="middle" fontWeight="bold" opacity="0.9">P2</text>

      {/* Entry direction arrow */}
      <line
        x1={mx} y1={my}
        x2={mx + inX * arrowLen} y2={my + inY * arrowLen}
        stroke="white" strokeWidth="0.004"
        markerEnd="url(#pc-arrow)"
        opacity="0.9"
      />
      {/* "Entrada" label near arrow tip */}
      <text
        x={mx + inX * (arrowLen + 0.022)} y={my + inY * (arrowLen + 0.022)}
        fontSize="0.022" fill="white" textAnchor="middle" dominantBaseline="middle"
        fontWeight="bold" opacity="0.85"
      >
        ENTRA
      </text>

      {/* Name label — below line midpoint */}
      <rect
        x={mx - 0.07} y={my + 0.01}
        width="0.14" height="0.032"
        rx="0.004" ry="0.004"
        fill="rgba(0,0,0,0.55)"
      />
      <text
        x={mx} y={my + 0.028}
        fontSize="0.024" fill={color} textAnchor="middle" fontWeight="bold"
      >
        {line.name}
      </text>

      {/* Hover: edit + delete buttons */}
      {hovered && (
        <g>
          {/* Edit */}
          <g onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ cursor: "pointer" }}>
            <rect x={mx + 0.08} y={my - 0.042} width="0.06" height="0.03" rx="0.004" fill="rgba(91,157,255,0.85)" />
            <text x={mx + 0.11} y={my - 0.023} fontSize="0.02" fill="white" textAnchor="middle">✎ Edit</text>
          </g>
          {/* Delete */}
          <g onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ cursor: "pointer" }}>
            <rect x={mx + 0.08} y={my - 0.005} width="0.06" height="0.03" rx="0.004" fill="rgba(255,122,89,0.85)" />
            <text x={mx + 0.11} y={my + 0.014} fontSize="0.02" fill="white" textAnchor="middle">✕ Borrar</text>
          </g>
        </g>
      )}
    </g>
  );
}

// ── Line Card (sidebar) ──────────────────────────────────────────────────────

function LineCard({ line, color, onEdit, onDelete }: { line: CountingLine; color: string; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="flex-1 truncate text-xs font-semibold text-[var(--text-0)]">{line.name}</span>
        <button type="button" onClick={onEdit} className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px]">✎</button>
        {confirm ? (
          <button type="button" onClick={onDelete} className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px] !text-[var(--warn)]" onBlur={() => setConfirm(false)}>✕ Confirmar</button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px] !text-[var(--text-3)]">✕</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded bg-[var(--bg-3)] px-1.5 py-px text-[9px] text-[var(--text-2)]">Zona: {line.zone}</span>
        {line.labels.map((lb) => (
          <span key={lb} className="rounded bg-[var(--acc)]/15 px-1.5 py-px text-[9px] text-[var(--acc)]">{lb}</span>
        ))}
        <span className="rounded bg-[var(--info)]/15 px-1.5 py-px text-[9px] text-[var(--info)]">
          Entrada: {line.enter_direction === "in" ? "IN" : "OUT"}
        </span>
      </div>
      <div className="mono text-[9px] text-[var(--text-3)]">
        P1 ({line.p1[0].toFixed(2)}, {line.p1[1].toFixed(2)}) → P2 ({line.p2[0].toFixed(2)}, {line.p2[1].toFixed(2)})
      </div>
    </div>
  );
}

// ── Line Form Modal ──────────────────────────────────────────────────────────

interface LineFormModalProps {
  initialName?: string;
  initialZone?: string;
  initialLabels?: string[];
  initialEnterDirection?: "in" | "out";
  onConfirm: (name: string, zone: string, labels: string[], enterDirection: "in" | "out") => void;
  onCancel: () => void;
}

function LineFormModal({ initialName, initialZone, initialLabels, initialEnterDirection, onConfirm, onCancel }: LineFormModalProps) {
  const [name, setName] = useState(initialName ?? "");
  const [zone, setZone] = useState(initialZone ?? "default");
  const [labels, setLabels] = useState<string[]>(initialLabels ?? ["person"]);
  const [enterDirection, setEnterDirection] = useState<"in" | "out">(initialEnterDirection ?? "in");
  const [customLabel, setCustomLabel] = useState("");

  function toggleLabel(lb: string) {
    setLabels((prev) => prev.includes(lb) ? prev.filter((l) => l !== lb) : [...prev, lb]);
  }

  function addCustom() {
    const lb = customLabel.trim().toLowerCase();
    if (lb && !labels.includes(lb)) setLabels((prev) => [...prev, lb]);
    setCustomLabel("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="vms-card w-80 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--text-0)]">
          {initialName ? "Editar línea" : "Nueva línea de conteo"}
        </h3>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-[var(--text-2)]">Nombre <span className="text-[var(--warn)]">*</span></span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Entrada principal"
              autoFocus
              className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </label>

          <label className="block">
            <span className="text-xs text-[var(--text-2)]">Zona</span>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Ej: entrada, sala_a, zona_1"
              className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </label>

          <div>
            <span className="text-xs text-[var(--text-2)]">Dirección de entrada</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(["in", "out"] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setEnterDirection(dir)}
                  className={`rounded px-2 py-1 text-[10px] transition ${
                    enterDirection === dir
                      ? "bg-[var(--acc)] text-[var(--bg-0)] font-semibold"
                      : "bg-[var(--bg-3)] text-[var(--text-2)] hover:bg-[var(--bg-2)]"
                  }`}
                >
                  {dir === "in" ? "IN es entrada" : "OUT es entrada"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs text-[var(--text-2)]">Labels a contar</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COMMON_LABELS.map((lb) => (
                <button
                  key={lb}
                  type="button"
                  onClick={() => toggleLabel(lb)}
                  className={`rounded px-2 py-0.5 text-[10px] transition ${
                    labels.includes(lb)
                      ? "bg-[var(--acc)] text-[var(--bg-0)] font-semibold"
                      : "bg-[var(--bg-3)] text-[var(--text-2)] hover:bg-[var(--bg-2)]"
                  }`}
                >
                  {lb}
                </button>
              ))}
            </div>
            {/* Custom label */}
            <div className="mt-2 flex gap-1.5">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="Otro label…"
                className="flex-1 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1 text-[10px] text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
              />
              <button type="button" onClick={addCustom} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]">+</button>
            </div>
            {labels.filter((l) => !COMMON_LABELS.includes(l)).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {labels.filter((l) => !COMMON_LABELS.includes(l)).map((lb) => (
                  <span key={lb} className="flex items-center gap-1 rounded bg-[var(--info)]/20 px-1.5 py-0.5 text-[9px] text-[var(--info)]">
                    {lb}
                    <button type="button" onClick={() => toggleLabel(lb)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="vms-btn flex-1 !text-xs">Cancelar</button>
          <button
            type="button"
            disabled={!name.trim() || labels.length === 0}
            onClick={() => onConfirm(name.trim(), zone.trim() || "default", labels, enterDirection)}
            className="vms-btn primary flex-1 !text-xs disabled:opacity-50"
          >
            {initialName ? "Actualizar" : "Agregar línea"}
          </button>
        </div>
      </div>
    </div>
  );
}
