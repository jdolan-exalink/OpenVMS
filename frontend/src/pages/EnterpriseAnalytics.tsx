import { useQuery, useQueries } from "react-query";
import { useState, useMemo, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import { listEvents, type VmsEvent } from "../api/events";
import { listCameras } from "../api/cameras";
import { listServers, getServerStatus, type ServerStatus } from "../api/servers";
import { listPlugins } from "../api/plugins";
import { fetchSnapshotWithAuth, fetchClipWithAuth } from "../utils/snapshot";

type Range = "1h" | "6h" | "24h" | "7d";

const RANGE_CONFIG: Record<Range, { label: string; ms: number; bins: number; binLabel: (d: Date) => string }> = {
  "1h":  { label: "Última hora",   ms: 3600_000,     bins: 12, binLabel: (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
  "6h":  { label: "Últimas 6h",    ms: 21600_000,    bins: 12, binLabel: (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
  "24h": { label: "Últimas 24h",   ms: 86400_000,    bins: 24, binLabel: (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
  "7d":  { label: "Últimos 7 días",ms: 604800_000,   bins: 14, binLabel: (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric" }) },
};

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
};

export default function EnterpriseAnalytics() {
  const [range, setRange] = useState<Range>("24h");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const cfg = RANGE_CONFIG[range];

  const now = Date.now();
  const startTime = new Date(now - cfg.ms).toISOString();
  const prevStart = new Date(now - cfg.ms * 2).toISOString();
  const prevEnd   = startTime;

  const eventsQ = useQuery(
    ["analytics-events", range],
    () => listEvents({ start: startTime, limit: 1000 }),
    { refetchInterval: 15000, onSuccess: () => setLastRefresh(new Date()) }
  );
  const prevEventsQ = useQuery(
    ["analytics-events-prev", range],
    () => listEvents({ start: prevStart, end: prevEnd, limit: 1000 }),
    { refetchInterval: 60000 }
  );
  const camerasQ  = useQuery("analytics-cameras",  () => listCameras({ page_size: 200 }),  { refetchInterval: 30000 });
  const serversQ  = useQuery("analytics-servers",  listServers,   { refetchInterval: 30000 });
  const pluginsQ  = useQuery("analytics-plugins",  listPlugins,   { refetchInterval: 60000 });

  const events     = useMemo(() => eventsQ.data?.items ?? [],     [eventsQ.data]);
  const prevEvents = useMemo(() => prevEventsQ.data?.items ?? [], [prevEventsQ.data]);
  const cameras    = camerasQ.data?.items ?? [];
  const servers    = serversQ.data ?? [];
  const plugins    = pluginsQ.data ?? [];

  // ── Live server status (real ping to each Frigate) ──────────────
  // Explicit return type so useQueries infers ServerStatus, not unknown
  const serverStatusQueries = useQueries(
    servers.map((s) => ({
      queryKey: ["analytics-srv-status", s.id],
      queryFn: (): Promise<ServerStatus> => getServerStatus(s.id),
      enabled: servers.length > 0,
      refetchInterval: 30000,
      retry: 1,
      staleTime: 20000,
    }))
  );

  const serverStatusLoading = serverStatusQueries.some((q) => q.isLoading);

  // Build the online camera name set directly — no useMemo to avoid
  // stale-closure issues with useQueries' ever-changing array reference.
  const onlineCameraNames = new Set<string>();
  serverStatusQueries.forEach((q) => {
    const status = q.data as ServerStatus | undefined;
    if (status?.online) status.cameras.forEach((n) => onlineCameraNames.add(n));
  });

  const srvsOnline  = serverStatusQueries.filter((q) => (q.data as ServerStatus | undefined)?.online).length;
  const camsTotal   = cameras.length;
  const camsOnline  = serverStatusLoading
    ? null   // unknown while loading — don't show stale zero
    : cameras.filter((c) => c.enabled && onlineCameraNames.has(c.frigate_name ?? c.name)).length;

  const plgsActive  = plugins.filter((p) => p.enabled).length;
  const plgsTotal   = plugins.length;

  // ── KPI derivations ──────────────────────────────────────────────
  const totalNow  = events.length;
  const totalPrev = prevEvents.length;
  const trendPct  = totalPrev > 0 ? Math.round(((totalNow - totalPrev) / totalPrev) * 100) : 0;

  const criticalNow  = events.filter((e) => e.severity === "critical" || e.severity === "high").length;
  const criticalPrev = prevEvents.filter((e) => e.severity === "critical" || e.severity === "high").length;
  const critTrend    = criticalPrev > 0 ? Math.round(((criticalNow - criticalPrev) / criticalPrev) * 100) : 0;

  // severity breakdown
  const sevCounts = useMemo(() => ({
    critical: events.filter((e) => e.severity === "critical").length,
    high:     events.filter((e) => e.severity === "high").length,
    medium:   events.filter((e) => e.severity === "medium").length,
    low:      events.filter((e) => e.severity === "low").length,
    none:     events.filter((e) => !e.severity).length,
  }), [events]);

  // ── Timeline bins ─────────────────────────────────────────────────
  const timelineBins = useMemo((): { label: string; count: number; ts: Date }[] => {
    const binMs = cfg.ms / cfg.bins;
    const bins = Array.from({ length: cfg.bins }, (_, i) => {
      const ts = new Date(now - cfg.ms + i * binMs);
      return { label: cfg.binLabel(ts), count: 0, ts };
    });
    events.forEach((ev) => {
      const t = new Date(ev.start_time).getTime();
      const idx = Math.floor((t - (now - cfg.ms)) / binMs);
      if (idx >= 0 && idx < cfg.bins) bins[idx].count++;
    });
    return bins;
  }, [events, range]);

  // ── Top cameras / plugins ─────────────────────────────────────────
  const topCameras = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach((e) => { if (e.camera_id) counts[e.camera_id] = (counts[e.camera_id] ?? 0) + 1; });
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 8);
  }, [events]);

  const topLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach((e) => { counts[e.label] = (counts[e.label] ?? 0) + 1; });
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 8);
  }, [events]);

  // ── Recent alerts feed ───────────────────────────────────────────
  const recentAlerts = useMemo(() =>
    [...events]
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 15),
    [events]
  );

  // ── Activity heatmap (hour of day 0-23) ─────────────────────────
  const hourlyActivity = useMemo(() => {
    const h = Array(24).fill(0);
    events.forEach((e) => { h[new Date(e.start_time).getHours()]++; });
    return h;
  }, [events]);

  const isLoading = eventsQ.isLoading || camerasQ.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--text-2)]">
          <svg className="animate-spin" viewBox="0 0 24 24" fill="none" width="16" height="16">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Cargando analytics...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-[var(--text-0)]">Analytics</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="vms-dot" />
            <span className="mono text-[10px] text-[var(--text-3)]">
              actualizado {lastRefresh.toLocaleTimeString()} · auto-refresh 15s
            </span>
          </div>
        </div>

        {/* Time range selector */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] p-1">
          {(["1h", "6h", "24h", "7d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "rounded-md px-3 py-1 text-[11px] font-semibold transition",
                range === r
                  ? "bg-[var(--acc)] text-white shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text-0)]",
              ].join(" ")}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="mono text-[10px] text-[var(--text-3)]">{srvsOnline}/{servers.length} servidores</span>
          <span className={`vms-dot ${srvsOnline > 0 ? "" : "warn"}`} />
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Eventos"
          value={totalNow}
          sub={cfg.label}
          trend={trendPct}
          icon={
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#5b9dff" opacity="0.8" />
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="#5b9dff" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          }
          color="#5b9dff"
          sparkData={timelineBins.map((b) => b.count)}
        />
        <KpiCard
          label="Alertas Críticas"
          value={criticalNow}
          sub="critical + high"
          trend={critTrend}
          icon={
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="#ef4444" opacity="0.8" />
              <line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="17" x2="12.01" y2="17" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
          color="#ef4444"
          invertTrend
          sparkData={timelineBins.map((b) => b.count)}
        />
        <KpiCard
          label="Cámaras"
          value={camsOnline ?? "…"}
          sub={camsOnline === null ? "verificando..." : `de ${camsTotal} total`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="#00d084" strokeWidth="1.5" />
              <circle cx="12" cy="11" r="3" stroke="#00d084" strokeWidth="1.5" />
              <circle cx="6" cy="7.5" r="1.2" fill="#00d084" opacity="0.7" />
            </svg>
          }
          color="#00d084"
          suffix={`/${camsTotal}`}
        />
        <KpiCard
          label="Plugins Activos"
          value={plgsActive}
          sub={`de ${plgsTotal} instalados`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" stroke="#b07cff" strokeWidth="1.5" />
            </svg>
          }
          color="#b07cff"
          suffix={`/${plgsTotal}`}
        />
      </div>

      {/* ── Timeline + Severity ── */}
      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        {/* Event timeline */}
        <div className="vms-card">
          <div className="vms-card-hd">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--acc)]">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3>Actividad de Eventos</h3>
            <span className="ml-auto mono text-[10px] text-[var(--text-3)]">{cfg.label}</span>
          </div>
          <div className="p-4">
            <TimelineChart bins={timelineBins} />
          </div>
        </div>

        {/* Severity breakdown */}
        <div className="vms-card">
          <div className="vms-card-hd">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--acc)]">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <polyline points="12 6 12 12 16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3>Severidad</h3>
          </div>
          <div className="flex flex-col items-center gap-4 p-4">
            <SeverityRing counts={sevCounts} total={totalNow} />
            <div className="w-full space-y-2">
              {(["critical", "high", "medium", "low"] as const).map((sev) => {
                const count = sevCounts[sev];
                const pct = totalNow > 0 ? Math.round((count / totalNow) * 100) : 0;
                return (
                  <div key={sev} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[sev] }} />
                    <span className="text-[11px] capitalize text-[var(--text-2)] w-16">{sev}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-3)]">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: SEV_COLOR[sev] }} />
                    </div>
                    <span className="mono text-[10px] text-[var(--text-1)] w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hourly heatmap ── */}
      <div className="vms-card">
        <div className="vms-card-hd">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--acc)]">
            <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2" />
          </svg>
          <h3>Actividad por Hora del Día</h3>
          <span className="ml-auto mono text-[10px] text-[var(--text-3)]">00:00 – 23:00</span>
        </div>
        <div className="p-4">
          <HourHeatmap data={hourlyActivity} />
        </div>
      </div>

      {/* ── Data tables row ── */}
      <div className="grid gap-3 lg:grid-cols-3">

        {/* Recent alerts feed */}
        <div className="vms-card lg:col-span-1">
          <div className="vms-card-hd">
            <span className="vms-dot animate-pulse" />
            <h3>Feed en Vivo</h3>
            <span className="ml-auto mono text-[9px] font-bold text-[var(--acc)]">LIVE</span>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {recentAlerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-3)]">Sin eventos recientes</div>
            ) : (
              recentAlerts.slice(0, 10).map((ev) => (
                <AlertRow key={ev.id} event={ev} />
              ))
            )}
          </div>
        </div>

        {/* Top cameras */}
        <div className="vms-card">
          <div className="vms-card-hd">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--text-3)]">
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="2" />
            </svg>
            <h3>Top Cámaras</h3>
            <span className="ml-auto mono text-[10px] text-[var(--text-3)]">por eventos</span>
          </div>
          <div className="p-4 space-y-2">
            {topCameras.length === 0 ? (
              <div className="text-sm text-[var(--text-3)] text-center py-4">Sin datos</div>
            ) : topCameras.map(([id, count], i) => {
              const cam = cameras.find((c) => c.id === id);
              const name = cam?.display_name ?? id;
              const max = topCameras[0][1];
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="mono text-[10px] text-[var(--text-3)] w-4">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="truncate text-[11px] font-medium text-[var(--text-0)]">{name}</span>
                      <span className="mono text-[10px] text-[var(--text-2)] ml-2 shrink-0">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-3)]">
                      <div className="h-1.5 rounded-full bg-[var(--acc)] transition-all" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top labels + Plugin health */}
        <div className="vms-card">
          <div className="vms-card-hd">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--text-3)]">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" stroke="currentColor" strokeWidth="2" />
              <line x1="7" y1="7" x2="7.01" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3>Top Etiquetas</h3>
            <span className="ml-auto mono text-[10px] text-[var(--text-3)]">por detección</span>
          </div>
          <div className="p-4 space-y-2">
            {topLabels.length === 0 ? (
              <div className="text-sm text-[var(--text-3)] text-center py-4">Sin datos</div>
            ) : topLabels.map(([label, count], i) => {
              const max = topLabels[0][1];
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="mono text-[10px] text-[var(--text-3)] w-4">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="capitalize truncate text-[11px] font-medium text-[var(--text-0)]">{label}</span>
                      <span className="mono text-[10px] text-[var(--text-2)] ml-2 shrink-0">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-3)]">
                      <div className="h-1.5 rounded-full bg-[#b07cff] transition-all" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Camera health grid ── */}
      <div className="vms-card">
        <div className="vms-card-hd">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--text-3)]">
            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 21h8m-4-4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h3>Estado de Cámaras</h3>
          <span className="ml-auto flex items-center gap-2">
            {serverStatusLoading ? (
              <>
                <svg className="animate-spin text-[var(--text-3)]" viewBox="0 0 24 24" fill="none" width="10" height="10">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="mono text-[10px] text-[var(--text-3)]">verificando…</span>
              </>
            ) : (
              <>
                <span className="mono text-[10px] text-[var(--acc)]">{camsOnline} online</span>
                <span className="mono text-[10px] text-[var(--text-3)]">/ {camsTotal} total</span>
              </>
            )}
          </span>
        </div>
        <div className="p-4">
          {cameras.length === 0 ? (
            <div className="text-center text-sm text-[var(--text-3)] py-4">Sin cámaras configuradas</div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {cameras.map((cam) => {
                const isDisabled = !cam.enabled;
                // While server status loads, show neutral state (don't show red "offline" prematurely)
                const isOnline = !serverStatusLoading && cam.enabled && onlineCameraNames.has(cam.frigate_name ?? cam.name);
                const isUnknown = serverStatusLoading && cam.enabled;
                const evCount = events.filter((e) => e.camera_id === cam.id).length;
                return (
                  <div
                    key={cam.id}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition hover:border-[var(--text-3)] ${
                      isUnknown
                        ? "border-[var(--line)] bg-[var(--bg-2)]"
                        : isOnline
                        ? "border-[var(--line)] bg-[var(--bg-2)]"
                        : isDisabled
                        ? "border-[var(--line)] bg-[var(--bg-2)] opacity-50"
                        : "border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)]"
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 h-2 w-2 rounded-full ${isUnknown ? "animate-pulse" : ""}`}
                      style={{ background: isUnknown ? "#6b7280" : isOnline ? "#22c55e" : isDisabled ? "#6b7280" : "#ef4444" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-[var(--text-0)]">{cam.display_name}</div>
                      <div className="mono text-[9px] mt-0.5" style={{
                        color: isUnknown ? "var(--text-3)" : isOnline ? "#22c55e" : isDisabled ? "#6b7280" : "#ef4444"
                      }}>
                        {isUnknown ? "verificando…" : isOnline ? "online" : isDisabled ? "deshabilitada" : "offline"}
                        {evCount > 0 && ` · ${evCount} ev`}
                      </div>
                    </div>
                    {!isOnline && !isDisabled && (
                      <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="shrink-0 text-red-400">
                        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Plugin health ── */}
      <div className="vms-card">
        <div className="vms-card-hd">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" className="text-[var(--text-3)]">
            <path d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <h3>Estado de Plugins</h3>
          <span className="ml-auto mono text-[10px] text-[var(--acc)]">{plgsActive}/{plgsTotal} activos</span>
        </div>
        <div className="p-4">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {plugins.map((plugin) => {
              const evCount = events.filter((e) => {
                const meta = e.extra_metadata as Record<string, unknown> | undefined;
                return meta?.plugin === plugin.name;
              }).length;
              return (
                <div key={plugin.name} className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-semibold text-[var(--text-0)]">{plugin.name}</span>
                      <span className="mono text-[9px] text-[var(--text-3)]">v{plugin.version}</span>
                    </div>
                    <div className="mono text-[9px] text-[var(--text-3)] mt-0.5">{evCount} alertas</div>
                  </div>
                  <span className={`vms-pill ${plugin.enabled ? "green" : "warn"} text-[9px]`}>
                    {plugin.enabled ? "activo" : "off"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, trend, icon, color, suffix, sparkData, invertTrend,
}: {
  label: string;
  value: number | string;
  sub: string;
  trend?: number;
  icon: ReactNode;
  color: string;
  suffix?: string;
  sparkData?: number[];
  invertTrend?: boolean;
}) {
  const up = (trend ?? 0) > 0;
  const trendGood = invertTrend ? !up : up;
  return (
    <div className="vms-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          {icon}
        </div>
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${trendGood ? "text-[var(--acc)]" : "text-[var(--warn)]"}`}>
            <svg viewBox="0 0 10 10" fill="none" width="8" height="8">
              <path d={up ? "M5 1l4 4H1z" : "M5 9l4-4H1z"} fill="currentColor" />
            </svg>
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-[var(--text-0)]" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}{suffix}
        </div>
        <div className="text-xs text-[var(--text-2)] mt-0.5">{label}</div>
        <div className="mono text-[9px] text-[var(--text-3)] mt-0.5">{sub}</div>
      </div>
      {sparkData && sparkData.length > 0 && (
        <div className="h-8">
          <Sparkline data={sparkData} color={color} />
        </div>
      )}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 32`} preserveAspectRatio="none" className="w-full h-full opacity-60">
      {data.map((v, i) => (
        <rect
          key={i}
          x={i * w + 0.3}
          y={32 - (v / max) * 32}
          width={w - 0.6}
          height={(v / max) * 32}
          fill={color}
          rx="1"
        />
      ))}
    </svg>
  );
}

function TimelineChart({ bins }: { bins: { label: string; count: number }[] }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  const showEvery = Math.ceil(bins.length / 8);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-px h-28">
        {bins.map((bin, i) => (
          <div
            key={i}
            className="group relative flex flex-1 flex-col justify-end"
            title={`${bin.label}: ${bin.count} eventos`}
          >
            <div
              className="rounded-t transition-all hover:opacity-80"
              style={{
                height: `${Math.max((bin.count / max) * 100, bin.count > 0 ? 4 : 0)}%`,
                background: "var(--acc)",
                opacity: 0.7 + (bin.count / max) * 0.3,
              }}
            />
            {bin.count > 0 && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-[var(--bg-0)] border border-[var(--line)] rounded px-1.5 py-0.5 whitespace-nowrap text-[10px] text-[var(--text-0)]">
                {bin.count}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex">
        {bins.map((bin, i) => (
          <div key={i} className="flex-1 text-center">
            {i % showEvery === 0 && (
              <span className="mono text-[8px] text-[var(--text-3)]">{bin.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HourHeatmap({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {data.map((count, hour) => {
          const intensity = max > 0 ? count / max : 0;
          return (
            <div key={hour} className="group relative flex-1" title={`${String(hour).padStart(2, "0")}:00 — ${count} eventos`}>
              <div
                className="rounded-sm transition-all hover:ring-1 hover:ring-[var(--acc)]"
                style={{
                  height: 32,
                  background: intensity > 0
                    ? `rgba(0, 208, 132, ${0.15 + intensity * 0.8})`
                    : "var(--bg-3)",
                }}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-[var(--bg-0)] border border-[var(--line)] rounded px-1.5 py-0.5 whitespace-nowrap text-[10px] text-[var(--text-0)]">
                {String(hour).padStart(2, "0")}:00 · {count}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex">
        {data.map((_, hour) => (
          <div key={hour} className="flex-1 text-center">
            {hour % 3 === 0 && (
              <span className="mono text-[8px] text-[var(--text-3)]">{String(hour).padStart(2, "0")}h</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SeverityRing({ counts, total }: { counts: Record<string, number>; total: number }) {
  const segments = [
    { key: "critical", color: SEV_COLOR.critical, value: counts.critical ?? 0 },
    { key: "high",     color: SEV_COLOR.high,     value: counts.high ?? 0 },
    { key: "medium",   color: SEV_COLOR.medium,   value: counts.medium ?? 0 },
    { key: "low",      color: SEV_COLOR.low,       value: counts.low ?? 0 },
  ].filter((s) => s.value > 0);

  if (total === 0) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-[var(--bg-3)]">
        <span className="text-[10px] text-[var(--text-3)]">sin datos</span>
      </div>
    );
  }

  const R = 38, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="relative">
      <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--bg-3)" strokeWidth="10" />
        {segments.map((seg) => {
          const dash = (seg.value / total) * circumference;
          const el = (
            <circle
              key={seg.key}
              cx={cx} cy={cy} r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth="10"
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-[var(--text-0)]">{total}</span>
        <span className="text-[9px] text-[var(--text-3)]">eventos</span>
      </div>
    </div>
  );
}

function AlertRow({ event }: { event: VmsEvent }) {
  const sev = event.severity ?? "low";
  const color = SEV_COLOR[sev] ?? SEV_COLOR.low;
  const timeStr = new Date(event.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const [open, setOpen] = useState(false);
  const hasMedia = event.has_snapshot || event.has_clip;

  return (
    <>
      <div
        className={`flex items-center gap-2.5 px-3 py-2 transition ${hasMedia ? "cursor-pointer hover:bg-[var(--bg-2)]" : "hover:bg-[var(--bg-2)]"}`}
        onClick={hasMedia ? () => setOpen(true) : undefined}
      >
        {/* Thumbnail */}
        {event.has_snapshot ? (
          <SnapThumb eventId={event.id} hasClip={event.has_clip} />
        ) : (
          <div className="h-9 w-14 flex-shrink-0 rounded-md bg-[var(--bg-3)] flex items-center justify-center">
            {event.has_clip ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-[var(--text-3)]">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="text-[var(--text-3)]">
                <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </div>
        )}

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="capitalize text-[11px] font-medium text-[var(--text-0)] truncate">{event.label}</span>
            {event.plate_number && (
              <span className="mono text-[9px] bg-[var(--bg-3)] px-1 rounded text-[var(--acc)]">{event.plate_number}</span>
            )}
          </div>
          <div className="mono text-[9px] text-[var(--text-3)] truncate mt-0.5">
            {event.camera_id ?? "cam"}{event.zones?.length ? ` · ${event.zones[0]}` : ""}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="mono text-[9px] text-[var(--text-3)]">{timeStr}</span>
          {hasMedia && (
            <svg viewBox="0 0 24 24" fill="none" width="10" height="10" className="text-[var(--text-3)]">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>

      {open && <EventDetailModal event={event} onClose={() => setOpen(false)} />}
    </>
  );
}

function SnapThumb({ eventId, hasClip }: { eventId: number; hasClip: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSnapshotWithAuth(eventId)
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [eventId]);

  return (
    <div className="relative h-9 w-14 flex-shrink-0 overflow-hidden rounded-md bg-[var(--bg-3)]">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : err ? (
        <div className="flex h-full w-full items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="text-[var(--text-3)]">
            <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-3 w-3 animate-spin rounded-full border border-[var(--text-3)] border-t-transparent" />
        </div>
      )}
      {hasClip && src && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <svg viewBox="0 0 24 24" fill="white" width="14" height="14">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      )}
    </div>
  );
}

function EventDetailModal({ event, onClose }: { event: VmsEvent; onClose: () => void }) {
  const hasBoth = event.has_snapshot && event.has_clip;
  const [tab, setTab] = useState<"clip" | "snapshot">(event.has_clip ? "clip" : "snapshot");
  const [snapSrc, setSnapSrc] = useState<string | null>(null);
  const [snapLoading, setSnapLoading] = useState(event.has_snapshot);
  const [clipSrc, setClipSrc] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(event.has_clip);
  const [clipProgress, setClipProgress] = useState(0);

  useEffect(() => {
    if (!event.has_snapshot) return;
    let alive = true;
    fetchSnapshotWithAuth(event.id)
      .then((url) => { if (alive) { setSnapSrc(url); setSnapLoading(false); } })
      .catch(() => { if (alive) setSnapLoading(false); });
    return () => { alive = false; };
  }, [event.id, event.has_snapshot]);

  useEffect(() => {
    if (!event.has_clip) return;
    let alive = true;
    fetchClipWithAuth(event.id, (pct) => { if (alive) setClipProgress(pct); })
      .then(({ blobUrl }) => { if (alive) { setClipSrc(blobUrl); setClipLoading(false); } })
      .catch(() => { if (alive) setClipLoading(false); });
    return () => { alive = false; };
  }, [event.id, event.has_clip]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  const sev = event.severity ?? "low";
  const timeStr = new Date(event.start_time).toLocaleString([], {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[680px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-1)] shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[sev] }} />
          <span className="capitalize font-semibold text-sm text-[var(--text-0)]">{event.label}</span>
          {event.plate_number && (
            <span className="mono rounded bg-[var(--bg-3)] px-2 py-0.5 text-[10px] text-[var(--acc)]">
              {event.plate_number}
            </span>
          )}
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
            style={{ background: SEV_COLOR[sev] + "22", color: SEV_COLOR[sev] }}
          >
            {sev}
          </span>
          <span className="ml-auto mono text-[10px] text-[var(--text-3)]">{timeStr}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-3)] text-[var(--text-2)] hover:text-[var(--text-0)] transition"
          >
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs (only if both media types exist) */}
        {hasBoth && (
          <div className="flex border-b border-[var(--line)] bg-[var(--bg-2)]">
            {(["clip", "snapshot"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  "px-5 py-2 text-xs font-semibold transition border-b-2",
                  tab === t
                    ? "border-[var(--acc)] text-[var(--acc)]"
                    : "border-transparent text-[var(--text-2)] hover:text-[var(--text-0)]",
                ].join(" ")}
              >
                {t === "clip" ? "Video" : "Snapshot"}
              </button>
            ))}
          </div>
        )}

        {/* Media area */}
        <div className="relative flex aspect-video items-center justify-center bg-black">
          {tab === "clip" ? (
            clipLoading ? (
              <div className="flex flex-col items-center gap-3 text-sm text-white/60">
                <svg className="animate-spin" viewBox="0 0 24 24" fill="none" width="22" height="22">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5" opacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <span>{clipProgress > 0 ? `Cargando ${clipProgress}%` : "Cargando clip…"}</span>
              </div>
            ) : clipSrc ? (
              <video src={clipSrc} controls autoPlay className="h-full w-full object-contain" />
            ) : (
              <span className="text-sm text-white/40">Sin clip disponible</span>
            )
          ) : (
            snapLoading ? (
              <svg className="animate-spin" viewBox="0 0 24 24" fill="none" width="22" height="22">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5" opacity="0.25" />
                <path d="M12 2a10 10 0 0110 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            ) : snapSrc ? (
              <img src={snapSrc} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-sm text-white/40">Sin snapshot disponible</span>
            )
          )}
        </div>

        {/* Footer metadata */}
        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-2.5 text-[11px]">
          <span className="text-[var(--text-3)]">
            Cámara: <span className="text-[var(--text-1)]">{event.camera_id ?? "—"}</span>
          </span>
          {event.zones?.length > 0 && (
            <span className="text-[var(--text-3)]">
              Zona: <span className="text-[var(--text-1)]">{event.zones.join(", ")}</span>
            </span>
          )}
          {event.score != null && (
            <span className="text-[var(--text-3)]">
              Score: <span className="mono text-[var(--text-1)]">{Math.round(Number(event.score) * 100)}%</span>
            </span>
          )}
          {clipSrc && (
            <a
              href={clipSrc}
              download={`event_${event.id}.mp4`}
              className="vms-btn ml-auto !text-[11px] gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" width="11" height="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Descargar clip
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
