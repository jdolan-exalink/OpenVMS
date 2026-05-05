import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "react-query";
import { useState, useEffect } from "react";
import { listCameras } from "../../api/cameras";
import { listServers } from "../../api/servers";
import { getSidebarPlugins } from "../../api/plugins";
import { useAuthStore } from "../../store/authStore";
import { useCameraStore } from "../../store/cameraStore";
import { APP_VERSION } from "../../version";

const coreNavItems = [
  {
    to: "/",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <rect x="3" y="3" width="7" height="7" rx="1.5" fill="#00d084" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" fill="#5b9dff" opacity="0.8" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" fill="#b07cff" opacity="0.8" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" fill="#ff7a59" opacity="0.8" />
      </svg>
    ),
    badge: "cameras",
  },
  {
    to: "/live",
    label: "Vista en Vivo",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <rect x="2" y="4" width="20" height="14" rx="2" stroke="#00d084" strokeWidth="1.5" />
        <path d="M9 18l5-4 5 4" stroke="#00d084" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="8.5" r="1.5" fill="#00d084" />
        <path d="M2 9l3-2v6l-3-2z" fill="#00d084" opacity="0.6" />
      </svg>
    ),
    badge: "live",
  },
  {
    to: "/events",
    label: "Eventos",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#ff7a59" opacity="0.7" />
        <path d="M2 17l10 5 10-5" stroke="#ff7a59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12l10 5 10-5" stroke="#ff7a59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    badge: "live",
  },
  {
    to: "/playback",
    label: "Reproducción",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <circle cx="12" cy="12" r="9" stroke="#5b9dff" strokeWidth="1.5" />
        <path d="M10.5 8.5l6 3.5-6 3.5V8.5z" fill="#5b9dff" />
      </svg>
    ),
  },
  {
    to: "/enterprise-analytics",
    label: "Analytics",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <rect x="3" y="14" width="4" height="7" rx="1" fill="#00d084" />
        <rect x="10" y="9" width="4" height="12" rx="1" fill="#5b9dff" opacity="0.85" />
        <rect x="17" y="4" width="4" height="17" rx="1" fill="#b07cff" opacity="0.7" />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "Configuración",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
        <circle cx="12" cy="12" r="3.5" stroke="#cfd6e2" strokeWidth="1.8" />
        <path d="M12 2.5v1.7M12 19.8v1.7M2.5 12h1.7M19.8 12h1.7M5.2 5.2l1.22 1.22M17.58 17.58l1.22 1.22M5.2 18.8l1.22-1.22M17.58 6.42l1.22-1.22" stroke="#cfd6e2" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.2" fill="#cfd6e2" />
      </svg>
    ),
  },
];

const PLUGIN_COUNTER_KEY = "openvms_plugin_counters";

interface PluginCounters {
  [pluginName: string]: number;
}

export function savePluginCounters(counters: PluginCounters) {
  localStorage.setItem(PLUGIN_COUNTER_KEY, JSON.stringify(counters));
}

export function loadPluginCounters(): PluginCounters {
  try {
    const raw = localStorage.getItem(PLUGIN_COUNTER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function Sidebar() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const [collapsed, setCollapsed] = useState(false);
  const [pluginSectionOpen, setPluginSectionOpen] = useState(true);
  const [counters, setCounters] = useState<PluginCounters>({});

  const serversQuery = useQuery("sidebar-servers", listServers, { refetchInterval: 30000 });
  const camerasQuery = useQuery("sidebar-cameras", () => listCameras({ page_size: 200 }), { refetchInterval: 30000 });
  const pluginsQuery = useQuery("sidebar-plugins", getSidebarPlugins, {
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [draggedCameraId, setDragaggedCameraId] = useState<string | null>(null);

  const servers = serversQuery.data ?? [];
  const cameras = camerasQuery.data?.items ?? [];
  const cameraCount = camerasQuery.data?.total ?? 0;
  const sidebarPlugins = pluginsQuery.data ?? [];

  const gridCameraIds = useCameraStore((s) => s.gridCameraIds);
  const setGridCameraIds = useCameraStore((s) => s.setGridCameraIds);

  useEffect(() => {
    setCounters(loadPluginCounters());
  }, []);

  const camerasByServer = servers.reduce<Record<string, typeof cameras>>((acc, srv) => {
    acc[srv.id] = cameras.filter((c) => c.server_id === srv.id);
    return acc;
  }, {});

  const initials = (user?.full_name ?? user?.username ?? "AD")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function toggleServer(serverId: string) {
    setExpandedServers((cur) => {
      const next = new Set(cur);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }

  function togglePluginSection() {
    setPluginSectionOpen((cur) => !cur);
  }

  function handleCameraDragStart(e: React.DragEvent, cameraId: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cameraId);
    setDragaggedCameraId(cameraId);
  }

  function handleCameraDragEnd() {
    setDragaggedCameraId(null);
  }

  function handleCameraDrop(e: React.DragEvent, targetCameraId: string) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetCameraId) return;
    const ordered = gridCameraIds.length ? [...gridCameraIds] : cameras.map((c) => c.id);
    const dragIdx = ordered.indexOf(draggedId);
    const targetIdx = ordered.indexOf(targetCameraId);
    if (dragIdx === -1 || targetIdx === -1) return;
    const next = [...ordered];
    const [item] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, item);
    setGridCameraIds(next);
  }

  const pageTitle = getPageTitle(location.pathname);

  if (collapsed) {
    return (
      <aside className="vms-sidebar collapsed">
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-[linear-gradient(135deg,#00d084,#00a36a)] text-sm font-black text-[var(--bg-0)]">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.9" />
              <circle cx="12" cy="12" r="4" fill="white" opacity="0.6" />
            </svg>
          </div>
        </div>

        <nav className="flex flex-col items-center gap-0.5">
          {coreNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                [
                  "flex h-10 w-10 items-center justify-center rounded-lg text-[13px] transition",
                  isActive
                    ? "bg-[var(--acc-soft)] text-[var(--acc-strong)]"
                    : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
                ].join(" ")
              }
            >
              {item.icon}
            </NavLink>
          ))}
        </nav>

        {sidebarPlugins.length > 0 && (
          <nav className="flex flex-col items-center gap-0.5">
            {sidebarPlugins.map((plugin) => (
              <NavLink
                key={plugin.name}
                to={`/plugins/${plugin.sidebar_route}`}
                title={plugin.sidebar_label}
                className={({ isActive }) =>
                  [
                    "group relative flex h-10 w-10 items-center justify-center rounded-lg text-[13px] transition",
                    isActive
                      ? "bg-[var(--acc-soft)] text-[var(--acc-strong)]"
                      : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
                  ].join(" ")
                }
              >
                <span className="text-[18px]">{plugin.sidebar_icon}</span>
                {(counters[plugin.name] ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--acc)] text-[9px] font-bold text-white">
                    {counters[plugin.name]! > 99 ? "99+" : counters[plugin.name]}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-3)] text-[var(--text-2)] transition hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]"
            title="Expandir sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="vms-sidebar">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#00d084,#00a36a)] text-sm font-black text-[var(--bg-0)] shadow-[0_0_12px_rgba(0,208,132,0.3)]">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.9" />
              <circle cx="12" cy="12" r="4" fill="white" opacity="0.6" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--text-0)]">OpenVMS</div>
            <div className="mono mt-px rounded bg-[var(--bg-3)] px-1.5 py-px text-[10px] font-semibold text-[var(--acc)]">v{APP_VERSION}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="mono text-[10px] text-[var(--text-3)]">{pageTitle}</span>
          <button
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--bg-3)] text-[var(--text-2)] transition hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]"
            title="Compactar sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 px-2 pb-1">
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="text-[var(--text-3)]">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Navegación</span>
        </div>
        {coreNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition",
                isActive
                  ? "bg-[linear-gradient(90deg,var(--acc-soft),transparent)] text-[var(--acc-strong)] border-l-2 border-[var(--acc)]"
                  : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
              ].join(" ")
            }
          >
            <span className="flex w-5 items-center justify-center">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
            {item.badge ? (
              <span className="ml-auto rounded-full bg-[var(--bg-3)] px-1.5 py-px text-[10px] font-semibold text-[var(--text-1)]">
                {item.badge === "cameras" ? cameraCount : item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {sidebarPlugins.length > 0 && (
        <nav className="flex flex-col gap-0.5">
          <button
            onClick={togglePluginSection}
            className="flex items-center gap-2 px-2 pb-1 text-left transition hover:opacity-80"
          >
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="text-[var(--text-3)]">
              <path d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Plugins</span>
            <svg
              className={`ml-auto transition-transform duration-200 ${pluginSectionOpen ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              width="10"
              height="10"
            >
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="ml-auto rounded-full bg-[var(--acc)] px-1.5 py-px text-[9px] font-bold text-white">
              {sidebarPlugins.length}
            </span>
          </button>

          {pluginSectionOpen && sidebarPlugins.map((plugin) => (
            <NavLink
              key={plugin.name}
              to={`/plugins/${plugin.sidebar_route}`}
              className={({ isActive }) =>
                [
                  "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition",
                  isActive
                    ? "bg-[linear-gradient(90deg,var(--acc-soft),transparent)] text-[var(--acc-strong)] border-l-2 border-[var(--acc)]"
                    : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
                ].join(" ")
              }
            >
              <span className="flex w-5 items-center justify-center text-[16px]">{plugin.sidebar_icon}</span>
              <span className="font-medium">{plugin.sidebar_label}</span>
              <span className={`ml-auto h-1.5 w-1.5 rounded-full ${categoryDot(plugin.category)}`} title={plugin.category} />
              {(counters[plugin.name] ?? 0) > 0 && (
                <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--acc)] text-[8px] font-bold text-white">
                  {counters[plugin.name]! > 99 ? "99+" : counters[plugin.name]}
                </span>
              )}
            </NavLink>
          ))}
          {!pluginSectionOpen && (
            <div className="flex items-center justify-center py-1">
              <span className="text-[10px] text-[var(--text-3)]">{sidebarPlugins.length} plugins</span>
            </div>
          )}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 pb-1">
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12" className="text-[var(--text-3)]">
            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 21h8m-4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Servidores Frigate</span>
        </div>
        {serversQuery.isLoading ? (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 text-[11px] text-[var(--text-2)]">
            Cargando...
          </div>
        ) : servers.length ? (
          servers.map((server, index) => {
            const serverCameras = camerasByServer[server.id] ?? [];
            const isExpanded = expandedServers.has(server.id);
            return (
              <div key={server.id} className="flex flex-col">
                <div
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 transition hover:border-[var(--text-3)]"
                  onClick={() => toggleServer(server.id)}
                >
                  <span className={`srvchip ${serverClass(index)} !p-0`}>
                    <span className="sw" />
                  </span>
                  <span className="mono truncate text-[11px] font-medium text-[var(--text-1)]">{server.display_name}</span>
                  <svg
                    className={`ml-auto transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    width="10"
                    height="10"
                  >
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={`vms-dot ${server.enabled ? "" : "warn"}`} />
                </div>
                {isExpanded && serverCameras.length > 0 && (
                  <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l-2 border-[var(--line)] pl-2">
                    {serverCameras.map((camera) => {
                      const isInGrid = gridCameraIds.includes(camera.id);
                      const isDragging = draggedCameraId === camera.id;
                      return (
                        <div
                          key={camera.id}
                          draggable
                          onDragStart={(e) => handleCameraDragStart(e, camera.id)}
                          onDragEnd={handleCameraDragEnd}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                          onDrop={(e) => handleCameraDrop(e, camera.id)}
                          className={[
                            "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-all",
                            isDragging ? "opacity-40 scale-95" : "",
                            isInGrid ? "font-semibold text-[var(--text-0)]" : "text-[var(--text-2)]",
                            "hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]",
                          ].join(" ")}
                        >
                          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" className="flex-shrink-0 opacity-60">
                            <rect x="1" y="3" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="4" cy="6" r="1" fill="currentColor" opacity="0.6" />
                            <path d="M1 7.5l2-1.5v5L1 7.5z" fill="currentColor" opacity="0.4" />
                          </svg>
                          <span className="truncate">{camera.display_name}</span>
                          {isInGrid && (
                            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--acc)]" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 text-[11px] text-[var(--text-2)]">
            Sin servidores
          </div>
        )}
      </div>

      <div className="-mx-2 -mb-3 flex items-center gap-3 border-t border-[var(--line)] px-3 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#5b9dff,#b07cff)] text-[11px] font-bold text-white shadow-[0_0_10px_rgba(91,157,255,0.4)]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[var(--text-0)]">
            {user?.username ?? "admin"}
          </div>
          <div className="mono text-[10px] text-[var(--text-3)]">{user?.role ?? "admin"}</div>
        </div>
      </div>
    </aside>
  );
}

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/live") return "Vista en Vivo";
  if (pathname === "/events") return "Eventos";
  if (pathname === "/playback") return "Reproducción";
  if (pathname === "/settings") return "Configuración";
  if (pathname === "/enterprise-analytics") return "Analytics";
  if (pathname.startsWith("/plugins/")) {
    const plugin = pathname.split("/plugins/")[1]?.replace(/-/g, " ");
    return plugin ? plugin.charAt(0).toUpperCase() + plugin.slice(1) : "Plugin";
  }
  return "";
}

function serverClass(index: number) {
  return (["a", "b", "c"] as const)[index >= 0 ? index % 3 : 0];
}

function categoryDot(category: string) {
  const map: Record<string, string> = {
    analytics: "bg-blue-400",
    recognition: "bg-purple-400",
    ai: "bg-green-400",
    safety: "bg-orange-400",
    security: "bg-red-400",
    notifications: "bg-yellow-400",
  };
  return map[category] ?? "bg-[var(--text-3)]";
}
