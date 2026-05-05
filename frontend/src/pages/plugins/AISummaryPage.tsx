import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";
import { listPlugins } from "../../api/plugins";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AISummaryPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: camerasData } = useQuery("ais-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const { data: pluginsData } = useQuery("ais-plugins", listPlugins);
  const aiPlugin = pluginsData?.find((p) => p.name === "ai_summary");
  const ollamaUrl = (aiPlugin?.config as Record<string, unknown>)?.ollama_url as string ?? "—";
  const model = (aiPlugin?.config as Record<string, unknown>)?.model as string ?? "—";

  const { data: eventsData, isLoading } = useQuery(
    ["ais-events", cameraId],
    () => listEvents({
      label: "ai_summary",
      source: "plugin",
      camera_id: cameraId !== "all" ? cameraId : undefined,
      limit: 100,
    }),
    { refetchInterval: 60000 },
  );

  const events = eventsData?.items ?? [];
  const camById = new Map(cameras.map((c) => [c.id, c]));

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCount = events.filter((e) => new Date(e.start_time) >= todayStart).length;

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🤖 Resumen IA (Ollama)</h2>
        <select
          value={cameraId}
          onChange={(e) => setCameraId(e.target.value)}
          className="ml-auto h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Resúmenes hoy</span>
          <span className="text-2xl font-bold text-[var(--acc)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Modelo</span>
          <span className="mono text-sm font-semibold text-[var(--text-0)] truncate">{model}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Ollama URL</span>
          <span className="mono text-[11px] text-[var(--text-2)] truncate">{ollamaUrl}</span>
        </div>
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Resúmenes de eventos</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{events.length} resúmenes</span>}
        </div>
        <div className="divide-y divide-[var(--line)]">
          {isLoading ? (
            <div className="p-4 text-sm text-[var(--text-2)]">Cargando...</div>
          ) : events.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-2)]">Sin resúmenes generados aún.</div>
          ) : events.map((ev: VmsEvent) => {
            const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
            const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
            const summary = (meta.summary as string) ?? (meta.ai_summary as string) ?? null;
            const isOpen = expanded === ev.id;
            return (
              <div key={ev.id} className="p-3">
                <div
                  className="flex items-start justify-between gap-3 cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : ev.id)}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[11px] text-[var(--text-3)]">{fmtTime(ev.start_time)}</span>
                      {cam && <span className="text-xs text-[var(--text-2)]">{cam.display_name}</span>}
                    </div>
                    {summary && (
                      <p className={`text-sm text-[var(--text-0)] leading-relaxed ${isOpen ? "" : "line-clamp-2"}`}>
                        {summary}
                      </p>
                    )}
                    {!summary && (
                      <p className="text-xs text-[var(--text-3)] italic">Sin texto de resumen en metadata</p>
                    )}
                  </div>
                  <span className="text-[var(--text-3)] text-xs shrink-0">{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div className="mt-2 rounded bg-[var(--bg-2)] p-2">
                    <pre className="text-[11px] text-[var(--text-2)] overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
