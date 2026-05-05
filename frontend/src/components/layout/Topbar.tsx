import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "react-query";
import { listServers } from "../../api/servers";
import { useAuthStore } from "../../store/authStore";
import { useEventStore } from "../../store/eventStore";
import { useSidebar } from "./SidebarContext";

const mobileItems = [
  { to: "/", label: "Dashboard" },
  { to: "/live", label: "Live" },
  { to: "/events", label: "Events" },
  { to: "/playback", label: "Playback" },
  { to: "/settings", label: "Settings" },
];

export default function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const serversQuery = useQuery("topbar-servers", listServers, { refetchInterval: 30000 });
  const page = pageMeta(location.pathname);
  const unread = useEventStore((s) => s.unread);
  const isPanelOpen = useEventStore((s) => s.isPanelOpen);
  const togglePanel = useEventStore((s) => s.togglePanel);
  const { collapsed, setCollapsed } = useSidebar();
  const servers = serversQuery.data ?? [];
  const enabledServers = servers.filter((server) => server.enabled).length;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="vms-topbar">
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="vms-btn !px-2 shrink-0"
          title="Expandir sidebar"
        >
          <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
            <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div className="min-w-0">
        <h1 className="m-0 text-[17px] font-semibold text-[var(--text-0)]">{page.title}</h1>
        <div className="mono text-xs text-[var(--text-3)]">/ {page.subtitle}</div>
      </div>
      <span className="flex-1" />
      <span className="vms-btn hidden md:inline-flex">
        <span className={`vms-dot ${enabledServers ? "" : "warn"}`} />
        {serversQuery.isLoading ? "verificando" : `${enabledServers}/${servers.length} servidores`}
      </span>
      <div className="hidden w-[280px] items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-2)] lg:flex">
        <span className="mono">⌕</span>
        <span className="truncate">Buscar camara, evento, placa...</span>
        <span className="mono ml-auto text-[10px] text-[var(--text-3)]">Ctrl K</span>
      </div>
      <div className="hidden min-w-0 text-right md:block">
        <div className="truncate text-xs font-medium text-[var(--text-0)]">
          {user?.full_name ?? user?.username ?? "admin"}
        </div>
        <div className="mono text-[10px] text-[var(--text-3)]">{user?.role ?? "admin"}</div>
      </div>
      <button
        type="button"
        onClick={togglePanel}
        className={`ep-toggle vms-btn !px-2.5 gap-1.5${isPanelOpen ? " !border-[rgba(0,208,132,0.5)] !text-[var(--acc-strong)]" : ""}`}
        title={isPanelOpen ? "Cerrar eventos" : "Ver eventos en vivo"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {unread > 0 && (
          <span className="mono text-[11px] font-bold">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      <button type="button" onClick={handleLogout} className="vms-btn">
        Salir
      </button>

      <nav className="flex gap-2 overflow-x-auto border-t border-slate-800 px-4 py-2 lg:hidden">
        {mobileItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "whitespace-nowrap rounded px-3 py-2 text-xs font-medium",
                isActive ? "bg-slate-800 text-white" : "text-slate-300",
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

function pageMeta(pathname: string) {
  if (pathname.startsWith("/live")) return { title: "LiveView", subtitle: "monitoreo en vivo" };
  if (pathname.startsWith("/events")) return { title: "Eventos", subtitle: "historico y feed live" };
  if (pathname.startsWith("/playback")) return { title: "Playback", subtitle: "revision sincronizada" };
  if (pathname.startsWith("/settings")) return { title: "Settings", subtitle: "servidores, camaras y usuarios" };
  return { title: "Dashboard", subtitle: "resumen general" };
}
