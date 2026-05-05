import { useState } from "react";
import { useQuery } from "react-query";
import { listEvents, VmsEvent } from "../../api/events";
import { listCameras } from "../../api/cameras";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function OcrPage() {
  const [cameraId, setCameraId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: camerasData } = useQuery("ocr-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: statsData } = useQuery(
    ["ocr-stats"],
    () => listEvents({ label: "ocr_match", source: "plugin", start: todayStart.toISOString(), limit: 500 }),
    { refetchInterval: 30000 },
  );
  const todayCount = statsData?.items.length ?? 0;

  const { isLoading } = useQuery(
    ["ocr-events", cameraId],
    () => listEvents({
      label: "ocr_match",
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
        label: "ocr_match", source: "plugin",
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

  const filtered = search.trim()
    ? allEvents.filter((ev) => {
        const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
        const text = ((meta.text as string) ?? (ev.sub_label ?? "")).toLowerCase();
        return text.includes(search.toLowerCase());
      })
    : allEvents;

  return (
    <div className="space-y-3">
      <div className="vms-card p-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🔤 OCR General</h2>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar texto detectado..."
          className="h-8 w-52 rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
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

      <div className="grid grid-cols-2 gap-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Lecturas hoy</span>
          <span className="text-2xl font-bold text-[var(--text-0)]">{todayCount}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Cargados</span>
          <span className="text-2xl font-bold text-[var(--text-0)]">{filtered.length}</span>
        </div>
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Texto detectado</h3>
          {!isLoading && <span className="mono text-[11px] text-[var(--text-3)]">{filtered.length} resultados</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Texto detectado</th>
                <th>Confianza</th>
                <th>Patrón coincidente</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5}>Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5}>Sin resultados OCR</td></tr>
              ) : filtered.map((ev: VmsEvent) => {
                const cam = ev.camera_id ? camById.get(ev.camera_id) : undefined;
                const meta = (ev.extra_metadata ?? {}) as Record<string, unknown>;
                const text = (meta.text as string) ?? ev.sub_label ?? "—";
                const conf = typeof meta.confidence === "number" ? `${Math.round((meta.confidence as number) * 100)}%` : "—";
                const pattern = (meta.matched_pattern as string) ?? "—";
                return (
                  <tr key={ev.id}>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">{fmtTime(ev.start_time)}</td>
                    <td>{cam?.display_name ?? <span className="text-[var(--text-3)]">—</span>}</td>
                    <td className="mono font-semibold text-[var(--acc-strong)]">{text}</td>
                    <td className="mono text-[11px]">{conf}</td>
                    <td className="mono text-[11px] text-[var(--text-3)]">{pattern}</td>
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
