import { useQuery } from "react-query";
import { listEvents } from "../api/events";
import { listPlugins } from "../api/plugins";

interface DashboardStats {
  totalAlerts: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  alertsByPlugin: Record<string, number>;
  alertsByCamera: Record<string, number>;
  recentTrend: number[];
}

export default function EnterpriseAnalytics() {
  const { data: eventsData, isLoading: eventsLoading } = useQuery(
    ["analytics-events"],
    () => listEvents({ source: "plugin", limit: 500 }),
    { refetchInterval: 30000 }
  );

  const { data: pluginsData } = useQuery("analytics-plugins", listPlugins);

  const events = eventsData?.items ?? [];

  const stats: DashboardStats = {
    totalAlerts: events.length,
    criticalCount: events.filter((e) => e.severity === "critical").length,
    highCount: events.filter((e) => e.severity === "high").length,
    mediumCount: events.filter((e) => e.severity === "medium").length,
    lowCount: events.filter((e) => e.severity === "low").length,
    alertsByPlugin: {},
    alertsByCamera: {},
    recentTrend: [],
  };

  events.forEach((event) => {
    const plugin = (event.extra_metadata as Record<string, unknown>)?.plugin as string ?? "unknown";
    stats.alertsByPlugin[plugin] = (stats.alertsByPlugin[plugin] ?? 0) + 1;

    const cameraId = event.camera_id ?? "unknown";
    stats.alertsByCamera[cameraId] = (stats.alertsByCamera[cameraId] ?? 0) + 1;
  });

  const sortedPlugins = Object.entries(stats.alertsByPlugin)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const sortedCameras = Object.entries(stats.alertsByCamera)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const totalPlugins = pluginsData?.length ?? 0;
  const activePlugins = pluginsData?.filter((p) => p.enabled).length ?? 0;

  if (eventsLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-[var(--text-2)]">Cargando analytics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--text-0)]">Enterprise Analytics</h1>
        <div className="flex items-center gap-4">
          <span className="mono text-[11px] text-[var(--text-3)]">
            Plugins activos: {activePlugins}/{totalPlugins}
          </span>
          <span className="mono text-[11px] text-[var(--text-3)]">
            Total alertas: {stats.totalAlerts}
          </span>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatCard
          label="Total"
          value={stats.totalAlerts}
          color="bg-[var(--acc)]"
          icon="📊"
        />
        <StatCard
          label="Critical"
          value={stats.criticalCount}
          color="bg-red-500"
          icon="🔴"
        />
        <StatCard
          label="High"
          value={stats.highCount}
          color="bg-orange-500"
          icon="🟠"
        />
        <StatCard
          label="Medium"
          value={stats.mediumCount}
          color="bg-yellow-500"
          icon="🟡"
        />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="vms-card">
          <div className="vms-card-hd">
            <h3>Alertas por Plugin</h3>
          </div>
          <div className="p-4">
            {sortedPlugins.length === 0 ? (
              <div className="text-sm text-[var(--text-2)]">Sin datos</div>
            ) : (
              <div className="space-y-2">
                {sortedPlugins.map(([plugin, count]) => (
                  <div key={plugin} className="flex items-center gap-3">
                    <span className="w-24 truncate text-xs font-medium text-[var(--text-1)]">
                      {plugin}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-[var(--bg-3)]">
                        <div
                          className="h-2 rounded-full bg-[var(--acc)]"
                          style={{ width: `${(count / stats.totalAlerts) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="mono w-12 text-right text-xs text-[var(--text-2)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="vms-card">
          <div className="vms-card-hd">
            <h3>Alertas por Cámara</h3>
          </div>
          <div className="p-4">
            {sortedCameras.length === 0 ? (
              <div className="text-sm text-[var(--text-2)]">Sin datos</div>
            ) : (
              <div className="space-y-2">
                {sortedCameras.map(([camera, count]) => (
                  <div key={camera} className="flex items-center gap-3">
                    <span className="w-24 truncate text-xs font-medium text-[var(--text-1)]">
                      {camera}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-[var(--bg-3)]">
                        <div
                          className="h-2 rounded-full bg-[var(--acc-secondary)]"
                          style={{ width: `${(count / Math.max(...Object.values(stats.alertsByCamera))) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="mono w-12 text-right text-xs text-[var(--text-2)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Plugin Health</h3>
        </div>
        <div className="p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {pluginsData?.map((plugin) => (
              <div
                key={plugin.name}
                className="flex items-center justify-between rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2"
              >
                <div>
                  <div className="text-xs font-medium text-[var(--text-0)]">{plugin.name}</div>
                  <div className="mono text-[10px] text-[var(--text-3)]">v{plugin.version}</div>
                </div>
                <span className={`vms-pill ${plugin.enabled ? "green" : "warn"}`}>
                  {plugin.enabled ? "activo" : "inactivo"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <div className="vms-card">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color} text-lg`}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-[var(--text-0)]">{value}</div>
          <div className="text-xs text-[var(--text-2)]">{label}</div>
        </div>
      </div>
    </div>
  );
}