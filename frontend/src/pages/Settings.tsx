import { useState } from "react";
import ServersPanel from "../components/settings/ServerForm";
import CamerasPanel from "../components/settings/CameraForm";
import UsersPanel from "../components/settings/UserManagement";
import PluginsPanel from "../components/settings/PluginsPanel";
import ZoneWizardPanel from "../components/settings/ZoneWizardPanel";
import { useAuthStore } from "../store/authStore";

type Tab = "servers" | "cameras" | "users" | "plugins" | "zones";

const TABS: { id: Tab; label: string }[] = [
  { id: "servers", label: "Servidores" },
  { id: "cameras", label: "Cámaras" },
  { id: "users", label: "Usuarios" },
  { id: "plugins", label: "Plugins" },
  { id: "zones", label: "Zonas" },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("servers");
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-3">
      <div className="flex border-b border-[var(--line)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition",
              tab === t.id
                ? "border-[var(--acc)] text-[var(--acc-strong)]"
                : "border-transparent text-[var(--text-2)] hover:text-[var(--text-0)]",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "servers" && <ServersPanel isAdmin={isAdmin} />}
      {tab === "cameras" && <CamerasPanel isAdmin={isAdmin} />}
      {tab === "users" && <UsersPanel isAdmin={isAdmin} />}
      {tab === "plugins" && <PluginsPanel isAdmin={isAdmin} />}
      {tab === "zones" && <ZoneWizardPanel isAdmin={isAdmin} />}
    </div>
  );
}