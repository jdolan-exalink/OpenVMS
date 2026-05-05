import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
  FrigateServer,
  FrigateServerCreate,
  createServer,
  deleteServer,
  listServers,
  syncServer,
  updateServer,
} from "../../api/servers";

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-2)]">
        {label}{required && <span className="ml-0.5 text-[var(--warn)]">*</span>}
      </span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="vms-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">{title}</h3>
          <button type="button" onClick={onClose} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const EMPTY: FrigateServerCreate = {
  name: "", display_name: "", url: "", rtsp_base: "",
  mqtt_host: "", mqtt_port: 1883, mqtt_username: "", mqtt_password: "",
  api_key: "", recordings_path: "", config_path: "", enabled: true,
};

type ApiError = { response?: { data?: { detail?: string } } };

export default function ServersPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: servers = [], isLoading } = useQuery("settings-servers", listServers);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FrigateServer | null>(null);
  const [form, setForm] = useState<FrigateServerCreate>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const set = (k: keyof FrigateServerCreate, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const createMut = useMutation(createServer, {
    onSuccess: () => { qc.invalidateQueries("settings-servers"); closeModal(); },
    onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al crear"),
  });

  const updateMut = useMutation(
    ({ id, body }: { id: string; body: FrigateServerCreate }) => updateServer(id, body),
    {
      onSuccess: () => { qc.invalidateQueries("settings-servers"); closeModal(); },
      onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al actualizar"),
    },
  );

  const deleteMut = useMutation(deleteServer, {
    onSuccess: () => {
      qc.invalidateQueries("settings-servers");
      qc.invalidateQueries("settings-cameras");
    },
  });

  function normalize(f: FrigateServerCreate): FrigateServerCreate {
    return {
      ...f,
      mqtt_host: f.mqtt_host || null,
      mqtt_username: f.mqtt_username || null,
      mqtt_password: f.mqtt_password || null,
      api_key: f.api_key || null,
      recordings_path: f.recordings_path || null,
      config_path: f.config_path || null,
    };
  }

  function openCreate() { setEditing(null); setForm(EMPTY); setErr(null); setOpen(true); }

  function openEdit(s: FrigateServer) {
    setEditing(s);
    setForm({
      name: s.name, display_name: s.display_name, url: s.url, rtsp_base: s.rtsp_base,
      mqtt_host: s.mqtt_host ?? "", mqtt_port: s.mqtt_port,
      mqtt_username: s.mqtt_username ?? "", mqtt_password: "", api_key: "",
      recordings_path: s.recordings_path ?? "", config_path: s.config_path ?? "",
      enabled: s.enabled,
    });
    setErr(null); setOpen(true);
  }

  function closeModal() { setOpen(false); setEditing(null); setErr(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const body = normalize(form);
    if (editing) {
      const { name: _n, ...upd } = body;
      updateMut.mutate({ id: editing.id, body: upd as FrigateServerCreate });
    } else {
      createMut.mutate(body);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const r = await syncServer(id);
      qc.invalidateQueries("settings-servers");
      qc.invalidateQueries("settings-cameras");
      qc.invalidateQueries("live-cameras");
      alert(`Sync: +${r.added} añadidas · ${r.updated} actualizadas · ${r.unchanged} sin cambios`);
    } catch (e: unknown) {
      alert((e as ApiError).response?.data?.detail ?? "Error al sincronizar");
    } finally {
      setSyncingId(null);
    }
  }

  function confirmDelete(s: FrigateServer) {
    if (!confirm(`¿Eliminar "${s.display_name}"? Se eliminarán también sus cámaras.`)) return;
    deleteMut.mutate(s.id);
  }

  const busy = createMut.isLoading || updateMut.isLoading;

  return (
    <>
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Servidores Frigate</h3>
          <span className="mono text-[11px] text-[var(--text-3)]">{servers.length} configurados</span>
          {isAdmin && (
            <button type="button" className="vms-btn primary ml-auto" onClick={openCreate}>
              + Agregar servidor
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Nombre</th><th>URL</th><th>RTSP base</th><th>MQTT</th>
                <th>Estado</th><th>Últ. conexión</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 7 : 6}>Cargando...</td></tr>
              ) : servers.length ? servers.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-[var(--text-0)]">{s.display_name}</td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{s.url}</td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{s.rtsp_base}</td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{s.mqtt_host ?? "—"}</td>
                  <td><span className={`vms-pill ${s.enabled ? "green" : "warn"}`}>{s.enabled ? "habilitado" : "deshabilitado"}</span></td>
                  <td className="mono text-[11px] text-[var(--text-3)]">
                    {s.last_seen ? new Date(s.last_seen).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]"
                          onClick={() => handleSync(s.id)} disabled={syncingId === s.id}>
                          {syncingId === s.id ? "···" : "↻ Sync"}
                        </button>
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]"
                          onClick={() => openEdit(s)}>Editar</button>
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]"
                          onClick={() => confirmDelete(s)}>Eliminar</button>
                      </div>
                    </td>
                  )}
                </tr>
              )) : (
                <tr><td colSpan={isAdmin ? 7 : 6}>No hay servidores configurados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal title={editing ? "Editar servidor" : "Agregar servidor Frigate"} onClose={closeModal}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre interno" required>
                <input value={form.name} onChange={(e) => set("name", e.target.value)}
                  disabled={!!editing} pattern="^[a-z0-9_-]+$" placeholder="frigate_principal"
                  className={INPUT} required />
                {!editing && <p className="mt-1 text-[10px] text-[var(--text-3)]">Solo minúsculas, números, - y _</p>}
              </Field>
              <Field label="Nombre visible" required>
                <input value={form.display_name} onChange={(e) => set("display_name", e.target.value)}
                  placeholder="Servidor Principal" className={INPUT} required />
              </Field>
            </div>
            <Field label="URL Frigate (HTTP)" required>
              <input value={form.url} onChange={(e) => set("url", e.target.value)}
                placeholder="http://frigate:5000" className={INPUT} required />
            </Field>
            <Field label="Base RTSP — go2rtc" required>
              <input value={form.rtsp_base} onChange={(e) => set("rtsp_base", e.target.value)}
                placeholder="rtsp://frigate:8554" className={INPUT} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="MQTT host">
                <input value={form.mqtt_host ?? ""} onChange={(e) => set("mqtt_host", e.target.value)}
                  placeholder="mosquitto" className={INPUT} />
              </Field>
              <Field label="MQTT port">
                <input type="number" value={form.mqtt_port} onChange={(e) => set("mqtt_port", Number(e.target.value))}
                  className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="MQTT usuario">
                <input value={form.mqtt_username ?? ""} onChange={(e) => set("mqtt_username", e.target.value)}
                  placeholder="opcional" className={INPUT} />
              </Field>
              <Field label="MQTT contraseña">
                <input type="password" value={form.mqtt_password ?? ""} onChange={(e) => set("mqtt_password", e.target.value)}
                  placeholder="••••••" className={INPUT} />
              </Field>
            </div>
            <Field label="API key (user:pass — solo para puerto 8971)">
              <input type="password" value={form.api_key ?? ""} onChange={(e) => set("api_key", e.target.value)}
                placeholder="admin:password" className={INPUT} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ruta grabaciones">
                <input value={form.recordings_path ?? ""} onChange={(e) => set("recordings_path", e.target.value)}
                  placeholder="/media/frigate/recordings" className={INPUT} />
              </Field>
              <Field label="Ruta config Frigate">
                <input value={form.config_path ?? ""} onChange={(e) => set("config_path", e.target.value)}
                  placeholder="/etc/frigate/config.yml" className={INPUT} />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)}
                className="accent-[var(--acc)]" />
              <span className="text-sm text-[var(--text-1)]">Servidor habilitado</span>
            </label>
            {err && (
              <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{err}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="vms-btn">Cancelar</button>
              <button type="submit" disabled={busy} className="vms-btn primary disabled:opacity-60">
                {busy ? "Guardando..." : editing ? "Guardar cambios" : "Crear servidor"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
