import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";
import { getLprAdvancedStats } from "../../api/plugins";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type Tab = "all" | "blacklisted";

export default function LprAdvancedPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [cameraId, setCameraId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("lpradv-cameras", () => listCameras({ page_size: 200 }));
  const { data: engineStats } = useQuery("lpradv-engine-stats", getLprAdvancedStats, { refetchInterval: 15000 });
  const cameras = camerasData?.items ?? [];

  const label = tab === "blacklisted" ? "blacklisted_plate" : "lpr_advanced";

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["lpradv-stats"],
    () => listEvents({ label: "lpr_advanced", source: "plugin:lpr_advanced", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const { data: blacklistStats } = useQuery(
    ["lpradv-bl-stats"],
    () => listEvents({ label: "blacklisted_plate", source: "plugin:lpr_advanced", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const todayCount = statsData?.items.length ?? 0;
  const blacklistCount = blacklistStats?.items.length ?? 0;

  const { isLoading } = useQuery(
    ["lpradv-events", tab, cameraId],
    () => listEvents({
      label,
      source: "plugin:lpr_advanced",
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
      const data = await le({ label, source: "plugin:lpr_advanced", camera_id: cameraId !== "all" ? cameraId : undefined, cursor, limit: 50 });
      setPages((p) => [...p, data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } finally { setLoadingMore(false); }
  }

  function changeTab(t: Tab) {
    setTab(t);
    setPages([]);
    setCursor(null);
  }

  const camById = new Map(cameras.map((c) => [c.id, c]));
  const allEvents = pages.flat();
  const filtered = search.trim()
    ? allEvents.filter((ev) => {
        const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
        const plate = ((meta.plate as string) ?? (meta.plate_text as string) ?? ev.sub_label ?? "");
        return plate.toLowerCase().includes(search.toLowerCase());
      })
    : allEvents;

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🚗 LPR Avanzado</h2>
        <EngineBadge stats={engineStats} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar matrícula..."
          className="h-8 w-40 rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
        <select
          value={cameraId}
          onChange={(e) => { setCameraId(e.target.value); setPages([]); setCursor(null); }}
          className="h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
        >
          <option value="all">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
      </div>

      {engineStats && !engineStats.engine_loaded && (
        <div className="rounded border border-[var(--warn)]/35 bg-[var(--warn)]/10 p-3 text-sm text-[var(--text-1)]">
          <div className="font-semibold text-[var(--warn)]">Módulo LPR avanzado incompleto</div>
          <div className="mt-1">{engineStats.status?.message ?? "El detector de patentes no está cargado."}</div>
          {engineStats.status?.missing?.map((item, idx) => (
            <div key={`${item.type}-${idx}`} className="mt-2 rounded bg-[var(--bg-2)] px-3 py-2 text-xs">
              <div><span className="text-[var(--text-3)]">Falta:</span> {item.type}</div>
              {item.path && <div className="mono mt-1 break-all text-[var(--text-2)]">{item.path}</div>}
              {item.hint && <div className="mt-1 text-[var(--text-3)]">{item.hint}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Lecturas hoy</span>
          <span className="text-2xl font-bold text-[var(--acc)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Alertas lista negra hoy</span>
          <span className="text-2xl font-bold text-[var(--warn)]">{blacklistCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Motor</span>
          <span className={`text-sm font-semibold ${engineStats?.engine_loaded ? "text-[var(--acc)]" : "text-[var(--warn)]"}`}>
            {engineStats?.engine_loaded ? "YOLO + OCR online" : "Modelo faltante"}
          </span>
          <span className="truncate text-[10px] text-[var(--text-3)]">
            {engineStats?.configured_model_path ?? "—"}
          </span>
        </div>
      </div>

      <div className="flex border-b border-[var(--line)]">
        {(["all", "blacklisted"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => changeTab(t)}
            className={[
              "px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition",
              tab === t ? "border-[var(--acc)] text-[var(--acc-strong)]" : "border-transparent text-[var(--text-2)] hover:text-[var(--text-0)]",
            ].join(" ")}
          >
            {t === "all" ? "Todas las lecturas" : "Lista negra"}
          </button>
        ))}
      </div>

      <div className="vms-card">
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Matrícula</th>
                <th>Confianza</th>
                <th>País/Región</th>
                <th>Frames</th>
                {tab === "blacklisted" && <th>Razón</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={tab === "blacklisted" ? 7 : 6}>Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={tab === "blacklisted" ? 7 : 6}>Sin registros</td></tr>
              ) : filtered.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const plate = (meta.plate as string) ?? (meta.plate_text as string) ?? ev.sub_label ?? "—";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                const country = (meta.country as string) ?? "—";
                const frames = typeof meta.frames_used === "number" ? meta.frames_used : 1;
                const reason = (meta.reason as string) ?? "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td>
                      <span className={`mono font-semibold ${tab === "blacklisted" ? "text-[var(--warn)]" : "text-[var(--acc-strong)]"}`}>
                        {plate}
                      </span>
                    </td>
                    <td className="mono text-[11px]">{conf}</td>
                    <td className="mono text-[11px] text-[var(--text-3)]">{country}</td>
                    <td className="mono text-[11px] text-[var(--text-3)]">{frames}</td>
                    {tab === "blacklisted" && <td className="text-[11px] text-[var(--warn)]">{reason}</td>}
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

function EngineBadge({ stats }: { stats: Awaited<ReturnType<typeof getLprAdvancedStats>> | undefined }) {
  if (!stats) {
    return <span className="rounded bg-[var(--bg-2)] px-2 py-1 text-xs text-[var(--text-3)]">estado...</span>;
  }
  const ok = stats.engine_loaded;
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold ${ok ? "bg-[var(--acc)]/15 text-[var(--acc)]" : "bg-[var(--warn)]/15 text-[var(--warn)]"}`}>
      {ok ? "online" : stats.status?.state ?? "offline"}
    </span>
  );
}
