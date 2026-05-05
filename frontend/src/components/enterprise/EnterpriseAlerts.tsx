import { useEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { listEvents } from "../../api/events";

interface EnterpriseAlert {
  id: number;
  plugin: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  camera_id: string;
  camera_name?: string;
  event_id?: number;
  data: Record<string, unknown>;
  has_snapshot: boolean;
  timestamp: string;
}

interface EnterpriseAlertsProps {
  onAlertClick?: (alert: EnterpriseAlert) => void;
}

const SEVERITY_COLORS = {
  low: "text-[var(--text-2)]",
  medium: "text-yellow-500",
  high: "text-orange-500",
  critical: "text-red-500 animate-pulse",
};

const ALERT_ICONS: Record<string, string> = {
  epp_violation: "⛑️",
  fire_detected: "🔥",
  smoke_detected: "💨",
  abandoned_object: "📦",
  blacklisted_plate: "🚗",
  ocr_match: "🔤",
  face_recognized: "👤",
  fall_detected: "⚠️",
  loitering: "👁️",
  line_crossing: "➡️",
  camera_sabotage: "📷",
};

export default function EnterpriseAlerts({ onAlertClick }: EnterpriseAlertsProps) {
  const [severityFilter, setSeverityFilter] = useState<"all" | "low" | "medium" | "high" | "critical">("all");
  const [pluginFilter, setPluginFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: eventsData, isLoading } = useQuery(
    ["enterprise-alerts", severityFilter, pluginFilter],
    () =>
      listEvents({
        source: "plugin",
        severity: severityFilter !== "all" ? severityFilter : undefined,
        limit: 200,
      }),
    { refetchInterval: 10000 }
  );

  const alerts: EnterpriseAlert[] = (eventsData?.items ?? []).map((event) => ({
    id: event.id,
    plugin: (event.extra_metadata as Record<string, unknown>)?.plugin as string ?? "unknown",
    alert_type: event.label,
    severity: event.severity as EnterpriseAlert["severity"],
    camera_id: event.camera_id ?? "",
    camera_name: (event.extra_metadata as Record<string, unknown>)?.camera_name as string,
    event_id: event.id,
    data: (event.extra_metadata as Record<string, unknown>) ?? {},
    has_snapshot: event.has_snapshot,
    timestamp: event.start_time,
  }));

  const filteredAlerts = alerts.filter((a) => {
    if (pluginFilter !== "all" && a.plugin !== pluginFilter) return false;
    return true;
  });

  const displayedAlerts = filteredAlerts.slice(0, visibleCount);
  const uniquePlugins = [...new Set(alerts.map((a) => a.plugin))];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 100) {
        setVisibleCount((v) => v + 50);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-xs font-semibold text-[var(--text-1)]">Filtrar:</span>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as "all" | "low" | "medium" | "high" | "critical")}
          className="vms-select !h-6 !min-h-0 !text-[10px]"
        >
          <option value="all">Todas severidades</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={pluginFilter}
          onChange={(e) => setPluginFilter(e.target.value)}
          className="vms-select !h-6 !min-h-0 !text-[10px]"
        >
          <option value="all">Todos plugins</option>
          {uniquePlugins.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <span className="ml-auto mono text-[10px] text-[var(--text-3)]">
          {filteredAlerts.length} alertas
        </span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-sm text-[var(--text-2)]">
            Cargando alertas...
          </div>
        ) : displayedAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-[var(--text-2)]">
            <span className="text-2xl opacity-30">🔔</span>
            <span>No hay alertas enterprise</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {displayedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex cursor-pointer items-start gap-3 px-3 py-2 transition hover:bg-[var(--bg-2)]"
                onClick={() => onAlertClick?.(alert)}
              >
                <span className="mt-0.5 text-lg" title={alert.plugin}>
                  {ALERT_ICONS[alert.alert_type] ?? "⚡"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-[var(--text-0)] ${SEVERITY_COLORS[alert.severity]}`}>
                      {alert.alert_type.replace(/_/g, " ")}
                    </span>
                    <span className="mono text-[10px] text-[var(--text-3)]">{alert.plugin}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-2)]">
                    <span>{alert.camera_name ?? alert.camera_id}</span>
                    <span>•</span>
                    <span>{formatTimestamp(alert.timestamp)}</span>
                  </div>
                  {alert.data && Object.keys(alert.data).length > 0 && (
                    <div className="mt-1 mono truncate text-[10px] text-[var(--text-3)]">
                      {formatAlertData(alert.alert_type, alert.data)}
                    </div>
                  )}
                </div>
                {alert.has_snapshot && (
                  <span className="shrink-0 rounded bg-[var(--bg-3)] px-1 py-0.5 text-[9px] text-[var(--text-2)]">
                    📷
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {visibleCount < filteredAlerts.length && (
          <div className="flex justify-center p-2">
            <button
              className="vms-btn !h-6 !min-h-0 !text-[10px]"
              onClick={() => setVisibleCount((v) => v + 50)}
            >
              Cargar más ({filteredAlerts.length - visibleCount} restantes)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "ahora";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m atrás`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
    return date.toLocaleDateString();
  } catch {
    return ts;
  }
}

function formatAlertData(alertType: string, data: Record<string, unknown>): string {
  switch (alertType) {
    case "epp_violation":
      return `${data["violations"] ?? "violación"} en ${data["zone_name"] ?? "zona"}`;
    case "blacklisted_plate":
      return `Placa: ${data["plate_text"] ?? "N/A"} - ${data["reason"] ?? ""}`;
    case "face_recognized":
      return `Persona: ${data["person_name"] ?? "desconocido"} (${Math.round((data["similarity"] as number ?? 0) * 100)}%)`;
    case "fall_detected":
      return `Tipo: ${data["fall_type"] ?? "desconocido"} - Confianza: ${Math.round((data["fall_confidence"] as number ?? 0) * 100)}%`;
    case "abandoned_object":
      return `${data["object_class"] ?? "objeto"} abandonado por ${data["duration_seconds"] ?? 0}s`;
    case "fire_detected":
    case "smoke_detected":
      return `Detecciones: fuego=${data["fire_count"] ?? 0}, humo=${data["smoke_count"] ?? 0}`;
    default:
      return Object.entries(data)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === "number" ? Math.round(v * 100) / 100 : v}`)
        .join(" | ");
  }
}