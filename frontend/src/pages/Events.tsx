import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { deleteEvent, listEvents, protectEvent, unprotectEvent, VmsEvent } from "../api/events";
import { listCameras } from "../api/cameras";
import { listServers } from "../api/servers";
import { useEventStore, WsEvent } from "../store/eventStore";
import EventFiltersBar, { FiltersState } from "../components/events/EventFilters";
import { EventPopup } from "../components/events/EventCard";
import { fetchSnapshotWithAuth } from "../utils/snapshot";
import { pluginKey, pluginMeta } from "../utils/pluginMeta";

// ─── Snapshot thumbnail ──────────────────────────────────────────────────────

function SnapThumb({ eventId, hasSnapshot }: { eventId: number; hasSnapshot: boolean }) {
  const blobUrls = useEventStore((s) => s.blobUrls);
  const setBlobUrl = useEventStore((s) => s.setBlobUrl);
  const [src, setSrc] = useState<string | null>(blobUrls[eventId] ?? null);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (!hasSnapshot || src || err || fetched.current) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fetched.current) return;
      fetched.current = true;
      fetchSnapshotWithAuth(eventId)
        .then((url) => { setSrc(url); setBlobUrl(eventId, url); })
        .catch(() => setErr(true));
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [eventId, hasSnapshot, src, err, setBlobUrl]);

  if (!hasSnapshot || err) {
    return <div className="video-thumb h-9 w-16 flex items-center justify-center"><span className="text-[9px] text-[var(--text-3)]">—</span></div>;
  }

  return (
    <div ref={ref} className="video-thumb h-9 w-16 overflow-hidden">
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <div className="h-full w-full animate-pulse bg-[var(--bg-3)]" />
      }
    </div>
  );
}

// ─── Label chip ──────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  person: "#00d084", car: "#ff7a59", truck: "#ff7a59", bus: "#ff7a59",
  bicycle: "#ff7a59", motorcycle: "#ff7a59", dog: "#b45309", cat: "#b45309",
  lpr: "#00c9ff", motion: "#5b9dff", fall_detected: "#ef4444",
};

function eventTheme(ev: VmsEvent) {
  const metaData = ev.extra_metadata as Record<string, unknown> | undefined;
  const meta = pluginMeta(ev.source, metaData);
  if (pluginKey(ev.source, metaData)) return meta;
  const color = LABEL_COLORS[ev.label.toLowerCase()] ?? "#8a93a3";
  return { color, label: "Frigate" };
}

function LabelChip({ label, plate, color }: { label: string; plate?: string | null; color?: string }) {
  const chipColor = color ?? LABEL_COLORS[label.toLowerCase()] ?? "#8a93a3";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: chipColor }} />
      <span className="text-[var(--text-0)]">{label}</span>
      {plate && <span className="mono ml-1 rounded bg-[var(--bg-3)] px-1 text-[10px] text-[var(--acc-strong)]">{plate}</span>}
    </span>
  );
}

function SourceChip({ event }: { event: VmsEvent }) {
  const theme = eventTheme(event);
  const key = pluginKey(event.source, event.extra_metadata as Record<string, unknown> | undefined);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: `${theme.color}22`, color: theme.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: theme.color }} />
      {key ? theme.label : "Base"}
    </span>
  );
}

const SEVERITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const SEVERITY_CLASSES: Record<string, string> = {
  low: "green",
  medium: "info",
  high: "warn",
  critical: "warn",
};

function SeverityChip({ severity }: { severity?: string | null }) {
  if (!severity) return <span className="text-[var(--text-3)]">—</span>;
  return (
    <span className={`vms-pill ${SEVERITY_CLASSES[severity] ?? "info"}`}>
      {SEVERITY_LABELS[severity] ?? severity}
    </span>
  );
}

// ─── Convert VmsEvent → WsEvent for the popup ────────────────────────────────

function toWsEvent(ev: VmsEvent): WsEvent {
  return {
    id: ev.id,
    frigate_event_id: ev.frigate_event_id,
    server_id: ev.server_id ?? "",
    camera_id: ev.camera_id,
    camera_name: (ev.extra_metadata?.camera_name as string | undefined) ?? null,
    label: ev.label,
    sub_label: ev.sub_label,
    score: ev.score != null ? Number(ev.score) : null,
    plate_number: ev.plate_number,
    has_clip: ev.has_clip,
    has_snapshot: ev.has_snapshot,
    zones: ev.zones,
    snapshot_url: ev.snapshot_url ?? null,
    timestamp: ev.start_time,
    plugin: pluginKey(ev.source, ev.extra_metadata as Record<string, unknown> | undefined),
    severity: ev.severity ?? null,
    data: (ev.extra_metadata ?? {}) as Record<string, unknown>,
  };
}

// ─── Main page ───────────────────────────────────────────────────────────────

type ApiError = { response?: { data?: { detail?: string } } };

export default function Events() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<FiltersState>({});
  const [pages, setPages] = useState<VmsEvent[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<VmsEvent | null>(null);

  // Track WS new events for the banner
  const wsEvents = useEventStore((s) => s.events);
  const loadedAtRef = useRef<number | null>(null);
  const [newCount, setNewCount] = useState(0);

  const { data: camerasData } = useQuery("events-cameras", () => listCameras({ page_size: 200 }));
  const { data: serversData } = useQuery("events-servers", listServers);
  const cameras = camerasData?.items ?? [];
  const servers = serversData ?? [];

  const camerasById = new Map(cameras.map((c) => [c.id, c]));

  // Initial load + filter change
  const firstPageQuery = useQuery(
    ["events-page", filters],
    () => listEvents({ ...filters, limit: 50 }),
    {
      keepPreviousData: true,
      onSuccess: (data) => {
        setPages([data.items]);
        setCursor(data.next_cursor);
        setHasMore(data.next_cursor !== null);
        loadedAtRef.current = data.items[0]?.id ?? null;
        setNewCount(0);
      },
    },
  );

  // Load more
  const [loadingMore, setLoadingMore] = useState(false);
  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listEvents({ ...filters, cursor, limit: 50 });
      setPages((prev) => [...prev, data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } finally {
      setLoadingMore(false);
    }
  }

  // Delete
  const deleteMut = useMutation((id: number) => deleteEvent(id), {
    onSuccess: (_, id) => {
      setPages((prev) => prev.map((page) => page.filter((ev) => ev.id !== id)));
      if (selected?.id === id) setSelected(null);
    },
    onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al eliminar"),
  });

  // Protect / unprotect
  const protectMut = useMutation(
    (id: number) => protectEvent(id),
    {
      onSuccess: (updated) => {
        setPages((prev) => prev.map((page) => page.map((ev) => ev.id === updated.id ? updated : ev)));
      },
      onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al proteger"),
    },
  );
  const unprotectMut = useMutation(
    (id: number) => unprotectEvent(id),
    {
      onSuccess: (updated) => {
        setPages((prev) => prev.map((page) => page.map((ev) => ev.id === updated.id ? updated : ev)));
      },
      onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al desproteger"),
    },
  );

  // WS new events banner
  useEffect(() => {
    if (loadedAtRef.current === null) return;
    const count = wsEvents.filter((e) => e.id > (loadedAtRef.current ?? 0)).length;
    setNewCount(count);
  }, [wsEvents]);

  function handleApplyFilters(f: FiltersState) {
    setFilters(f);
    setPages([]);
    setCursor(null);
  }

  function handleRefresh() {
    qc.invalidateQueries(["events-page", filters]);
    setNewCount(0);
  }

  function confirmDelete(ev: VmsEvent, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar evento #${ev.id} (${ev.label})?`)) return;
    deleteMut.mutate(ev.id);
  }

  const allEvents = pages.flat();
  const total = allEvents.length;
  const isLoading = firstPageQuery.isLoading;

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <div className="space-y-3">
      <EventFiltersBar cameras={cameras} servers={servers} onApply={handleApplyFilters} />

      {/* New events banner */}
      {newCount > 0 && (
        <button
          type="button"
          onClick={handleRefresh}
          className="w-full rounded border border-[var(--acc)] bg-[var(--acc-soft)] py-2 text-center text-sm font-medium text-[var(--acc-strong)] transition hover:bg-[rgba(0,208,132,0.15)]"
        >
          ↑ {newCount} evento{newCount !== 1 ? "s" : ""} nuevo{newCount !== 1 ? "s" : ""} — clic para actualizar
        </button>
      )}

      {/* Table */}
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Eventos</h3>
          {!isLoading && (
            <span className="mono text-[11px] text-[var(--text-3)]">
              {total} cargados{hasMore ? " (hay más)" : ""}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Snap</th>
                <th>Hora</th>
                <th>Cámara</th>
                <th>Servidor</th>
                <th>Origen</th>
                <th>Tipo</th>
                <th>Gravedad</th>
                <th>Score</th>
                <th>Zonas</th>
                <th>Media</th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" width="11" height="11" stroke="#FBBF24" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    Prot
                  </span>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12}>Cargando eventos...</td></tr>
              ) : firstPageQuery.error ? (
                <tr><td colSpan={12} className="text-[var(--warn)]">Error al cargar eventos.</td></tr>
              ) : allEvents.length === 0 ? (
                <tr><td colSpan={12}>Sin eventos para los filtros aplicados.</td></tr>
              ) : allEvents.map((ev) => {
                const cam = ev.camera_id ? camerasById.get(ev.camera_id) : undefined;
                const serverIdx = ev.server_id ? servers.findIndex((s) => s.id === ev.server_id) : -1;
                const server = serverIdx >= 0 ? servers[serverIdx] : undefined;
                const theme = eventTheme(ev);
                const evMeta = ev.extra_metadata as Record<string, unknown> | undefined;
                const isPluginEvent = Boolean(pluginKey(ev.source, evMeta));
                return (
                  <tr
                    key={ev.id}
                    className="cursor-pointer"
                    style={isPluginEvent ? {
                      boxShadow: `inset 3px 0 0 ${theme.color}`,
                      background: `linear-gradient(90deg, ${theme.color}16 0%, transparent 42%)`,
                    } : undefined}
                    onClick={() => setSelected(ev)}
                  >
                    <td className="!p-1">
                      <SnapThumb eventId={ev.id} hasSnapshot={ev.has_snapshot} />
                    </td>
                    <td className="mono text-[11px] text-[var(--text-2)] whitespace-nowrap">
                      {formatTime(ev.start_time)}
                    </td>
                    <td className="text-[var(--text-0)]">
                      {cam?.display_name ?? (evMeta?.camera_name as string | undefined) ?? <span className="text-[var(--text-3)]">—</span>}
                    </td>
                    <td>
                      {server
                        ? <span className={`srvchip ${["a","b","c"][serverIdx % 3]}`}><span className="sw" />{server.display_name}</span>
                        : <span className="text-[var(--text-3)]">—</span>
                      }
                    </td>
                    <td>
                      <SourceChip event={ev} />
                    </td>
                    <td>
                      <LabelChip label={ev.label} plate={ev.plate_number} color={isPluginEvent ? theme.color : undefined} />
                    </td>
                    <td>
                      <SeverityChip severity={ev.severity} />
                    </td>
                    <td className="mono text-[11px] text-[var(--text-2)]">
                      {ev.score != null ? `${Math.round(Number(ev.score) * 100)}%` : "—"}
                    </td>
                    <td className="mono text-[10px] text-[var(--text-3)]">
                      {ev.zones.length ? ev.zones.join(", ") : "—"}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {ev.has_clip && <span className="vms-pill info">clip</span>}
                        {ev.has_snapshot && <span className="vms-pill green">snap</span>}
                        {!ev.has_clip && !ev.has_snapshot && <span className="text-[var(--text-3)] text-[10px]">—</span>}
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {ev.is_protected ? (
                          <svg viewBox="0 0 24 24" fill="#FBBF24" width="13" height="13">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="#5e6678" strokeWidth="1.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        )}
                        <button
                          type="button"
                          className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (ev.is_protected) {
                              unprotectMut.mutate(ev.id);
                            } else {
                              protectMut.mutate(ev.id);
                            }
                          }}
                          title={ev.is_protected ? "Desproteger" : "Proteger"}
                        >
                          {ev.is_protected ? "Desprot" : "Prot"}
                        </button>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]"
                        onClick={(e) => confirmDelete(ev, e)}
                        disabled={deleteMut.isLoading || ev.is_protected}
                        title={ev.is_protected ? "Evento protegido — no se puede eliminar" : "Eliminar"}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Load more */}
        {hasMore && (
          <div className="border-t border-[var(--line)] p-3 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore}
              className="vms-btn !px-6 disabled:opacity-60">
              {loadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        )}
      </div>

      {/* Detail popup */}
      {selected && (
        <EventPopup event={toWsEvent(selected)} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
