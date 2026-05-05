import { NavLink } from "react-router-dom";
import { useQuery } from "react-query";
import { useState } from "react";
import { listCameras } from "../../api/cameras";
import { listServers } from "../../api/servers";
import { getSidebarPlugins } from "../../api/plugins";
import { useAuthStore } from "../../store/authStore";
import { useCameraStore } from "../../store/cameraStore";

const coreNavItems = [
  {
    to: "/",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <rect x="3" y="3" width="7" height="7" rx="1.5" fill="#00d084" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" fill="#5b9dff" opacity="0.8" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" fill="#b07cff" opacity="0.8" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" fill="#ff7a59" opacity="0.8" />
      </svg>
    ),
  },
  {
    to: "/live",
    label: "LiveView",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <rect x="2" y="4" width="20" height="14" rx="2" stroke="#00d084" strokeWidth="1.5" />
        <path d="M9 18l5-4 5 4" stroke="#00d084" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="8.5" r="1.5" fill="#00d084" />
        <path d="M2 9l3-2v6l-3-2z" fill="#00d084" opacity="0.6" />
      </svg>
    ),
    badge: "cameras",
  },
  {
    to: "/events",
    label: "Eventos",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#ff7a59" opacity="0.7" />
        <path d="M2 17l10 5 10-5" stroke="#ff7a59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12l10 5 10-5" stroke="#ff7a59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    badge: "live",
  },
  {
    to: "/playback",
    label: "Playback",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="12" cy="12" r="9" stroke="#5b9dff" strokeWidth="1.5" />
        <path d="M10.5 8.5l6 3.5-6 3.5V8.5z" fill="#5b9dff" />
      </svg>
    ),
  },
  {
    to: "/enterprise-analytics",
    label: "Analytics",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <rect x="3" y="14" width="4" height="7" rx="1" fill="#00d084" />
        <rect x="10" y="9" width="4" height="12" rx="1" fill="#5b9dff" opacity="0.85" />
        <rect x="17" y="4" width="4" height="17" rx="1" fill="#b07cff" opacity="0.7" />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="12" cy="12" r="3" stroke="#cfd6e2" strokeWidth="1.5" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#cfd6e2" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const user = useAuthStore((state) => state.user);
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

  return (
    <aside className="vms-sidebar">
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-[linear-gradient(135deg,#00d084,#00a36a)] text-sm font-black text-[var(--bg-0)]">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.9" />
            <circle cx="12" cy="12" r="4" fill="white" opacity="0.6" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--text-0)]">OpenVMS</div>
          <div className="mono mt-px text-[10px] text-[var(--text-3)]">v0.1.0</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          navegacion
        </div>
        {coreNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "flex h-9 items-center gap-3 rounded px-2.5 text-[13px] transition",
                isActive
                  ? "bg-[var(--acc-soft)] text-[var(--acc-strong)]"
                  : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
              ].join(" ")
            }
          >
            <span className="flex w-4 items-center justify-center">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge ? (
              <span className="mono ml-auto rounded-full bg-[var(--bg-3)] px-1.5 py-px text-[10px] text-[var(--text-1)]">
                {item.badge === "cameras" ? cameraCount : item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {sidebarPlugins.length > 0 && (
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            plugins
          </div>
          {sidebarPlugins.map((plugin) => (
            <NavLink
              key={plugin.name}
              to={`/plugins/${plugin.sidebar_route}`}
              className={({ isActive }) =>
                [
                  "flex h-9 items-center gap-2.5 rounded px-2.5 text-[13px] transition",
                  isActive
                    ? "bg-[var(--acc-soft)] text-[var(--acc-strong)]"
                    : "text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]",
                ].join(" ")
              }
            >
              <span className="flex w-4 items-center justify-center text-[15px]">
                {plugin.sidebar_icon}
              </span>
              <span>{plugin.sidebar_label}</span>
              <span className={`ml-auto h-1.5 w-1.5 rounded-full ${categoryDot(plugin.category)}`} title={plugin.category} />
            </NavLink>
          ))}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-1">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          servidores frigate
        </div>
        {serversQuery.isLoading ? (
          <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 text-[11px] text-[var(--text-2)]">
            Cargando...
          </div>
        ) : servers.length ? (
          servers.map((server, index) => {
            const serverCameras = camerasByServer[server.id] ?? [];
            const isExpanded = expandedServers.has(server.id);
            return (
              <div key={server.id} className="flex flex-col">
                <div className="flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 cursor-pointer"
                  onClick={() => toggleServer(server.id)}>
                  <span className={`srvchip ${serverClass(index)} !p-0`}>
                    <span className="sw" />
                  </span>
                  <span className="mono truncate text-[11px] text-[var(--text-1)]">{server.display_name}</span>
                  <svg
                    className={`ml-auto transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    width="12"
                    height="12"
                  >
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={`vms-dot ${server.enabled ? "" : "warn"}`} />
                </div>
                {isExpanded && serverCameras.length > 0 && (
                  <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
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
                            "flex items-center gap-1.5 rounded px-1.5 py-1 cursor-grab text-[11px] transition-all",
                            isDragging ? "opacity-40 scale-95" : "",
                            isInGrid ? "font-semibold text-[var(--text-0)]" : "text-[var(--text-2)]",
                            "hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]",
                          ].join(" ")}
                        >
                          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" className="flex-shrink-0">
                            <rect x="1" y="3" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
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
          <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 text-[11px] text-[var(--text-2)]">
            Sin servidores
          </div>
        )}
      </div>

      <div className="-mx-2 -mb-3 flex items-center gap-2 border-t border-[var(--line)] px-3 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#5b9dff,#b07cff)] text-[11px] font-bold text-[var(--bg-0)]">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-[var(--text-0)]">
            {user?.username ?? "admin"}
          </div>
          <div className="mono text-[10px] text-[var(--text-3)]">{user?.role ?? "admin"}</div>
        </div>
      </div>
    </aside>
  );
}

function serverClass(index: number) {
  return (["a", "b", "c"] as const)[index >= 0 ? index % 3 : 0];
}

function categoryDot(category: string) {
  const map: Record<string, string> = {
    analytics: "bg-blue-400",
    recognition: "bg-purple-400",
    ai: "bg-green-400",
    security: "bg-orange-400",
    notifications: "bg-yellow-400",
  };
  return map[category] ?? "bg-[var(--text-3)]";
}