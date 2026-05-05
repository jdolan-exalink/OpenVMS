import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import EventSidebar from "../events/EventSidebar";
import { useAuthStore } from "../../store/authStore";
import { useEventStore } from "../../store/eventStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useSidebar } from "./SidebarContext";

export default function Layout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isPanelOpen = useEventStore((s) => s.isPanelOpen);
  const { collapsed } = useSidebar();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useWebSocket();

  return (
    <div className={`vms-shell${isPanelOpen ? " panel-open" : ""}`}>
      <Sidebar />
      <div className={`vms-main${collapsed ? " sidebar-collapsed" : ""}`}>
        <Topbar />
        <main className="vms-content">
          {isLoading ? (
            <div className="vms-card p-4 text-sm text-[var(--text-2)]">
              Cargando sesion...
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      {isAuthenticated && <EventSidebar />}
    </div>
  );
}
