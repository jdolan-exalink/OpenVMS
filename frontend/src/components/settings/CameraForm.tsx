import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import { Camera, CameraUpdate, deleteCamera, listCameras, updateCamera } from "../../api/cameras";
import { listServers } from "../../api/servers";
import { listPlugins, updatePluginConfig } from "../../api/plugins";
import type { Plugin } from "../../api/plugins";

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-2)]">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="vms-card w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">{title}</h3>
          <button type="button" onClick={onClose} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type ApiError = { response?: { data?: { detail?: string } } };

export default function CamerasPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: serversData = [] } = useQuery("settings-servers", listServers);
  const { data, isLoading } = useQuery("settings-cameras", () => listCameras({ page_size: 200 }));
  const cameras = data?.items ?? [];
  const { data: plugins = [] } = useQuery("plugins", listPlugins);

  const [filterServerId, setFilterServerId] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Camera | null>(null);
  const [form, setForm] = useState<CameraUpdate & { display_name: string }>({ display_name: "", enabled: true, has_audio: false, has_ptz: false, tags: [] });
  const [tagsRaw, setTagsRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const cameraPlugins = plugins.filter(
    (p: Plugin) => "enabled_cameras" in (p.config ?? {}),
  );

  const [pluginAssignments, setPluginAssignments] = useState<Record<string, boolean>>({});
  const [pluginSaveStatus, setPluginSaveStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  useEffect(() => {
    if (!editing) return;
    const initial = Object.fromEntries(
      cameraPlugins.map((p: Plugin) => [
        p.name,
        ((p.config["enabled_cameras"] as string[] | undefined) ?? []).includes(editing.frigate_name),
      ]),
    );
    setPluginAssignments(initial);
    setPluginSaveStatus("idle");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const pluginMut = useMutation(
    async () => {
      if (!editing) return;
      const tasks = cameraPlugins
        .filter((p: Plugin) => {
          const current = ((p.config["enabled_cameras"] as string[] | undefined) ?? []).includes(editing.frigate_name);
          return pluginAssignments[p.name] !== current;
        })
        .map((p: Plugin) => {
          const current: string[] = (p.config["enabled_cameras"] as string[] | undefined) ?? [];
          const assigned = pluginAssignments[p.name];
          const newList = assigned
            ? [...current, editing.frigate_name]
            : current.filter((n) => n !== editing.frigate_name);
          return updatePluginConfig(p.name, { ...p.config, enabled_cameras: newList });
        });
      await Promise.all(tasks);
    },
    {
      onSuccess: () => {
        qc.invalidateQueries("plugins");
        setPluginSaveStatus("ok");
        setTimeout(() => setPluginSaveStatus("idle"), 2500);
      },
      onError: () => setPluginSaveStatus("error"),
    },
  );

  const updateMut = useMutation(
    ({ id, body }: { id: string; body: CameraUpdate }) => updateCamera(id, body),
    {
      onSuccess: () => {
        qc.invalidateQueries("settings-cameras");
        qc.invalidateQueries("live-cameras");
        closeModal();
      },
      onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al actualizar"),
    },
  );

  const deleteMut = useMutation(deleteCamera, {
    onSuccess: () => {
      qc.invalidateQueries("settings-cameras");
      qc.invalidateQueries("live-cameras");
    },
  });

  const serverMap = new Map(serversData.map((s) => [s.id, s]));

  const visible = filterServerId === "all"
    ? cameras
    : cameras.filter((c) => c.server_id === filterServerId);

  function openEdit(c: Camera) {
    setEditing(c);
    setForm({ display_name: c.display_name, enabled: c.enabled, has_audio: c.has_audio, has_ptz: c.has_ptz, tags: c.tags });
    setTagsRaw(c.tags.join(", "));
    setErr(null);
    setOpen(true);
  }

  function closeModal() { setOpen(false); setEditing(null); setErr(null); setPluginSaveStatus("idle"); }

  function handlePluginSave() {
    setPluginSaveStatus("saving");
    pluginMut.mutate();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!editing) return;
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    updateMut.mutate({ id: editing.id, body: { ...form, tags } });
  }

  function confirmDelete(c: Camera) {
    if (!confirm(`¿Eliminar cámara "${c.display_name}"?`)) return;
    deleteMut.mutate(c.id);
  }

  return (
    <>
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Cámaras</h3>
          <span className="mono text-[11px] text-[var(--text-3)]">{cameras.length} sincronizadas</span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={filterServerId}
              onChange={(e) => setFilterServerId(e.target.value)}
              className="h-7 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-1)] outline-none"
            >
              <option value="all">Todos los servidores</option>
              {serversData.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate("/cameras/new")}
                className="vms-btn primary !h-7 !min-h-0 !px-2.5 !text-xs"
              >
                + Nueva cámara
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Nombre</th><th>Frigate name</th><th>Servidor</th>
                <th>Audio</th><th>PTZ</th><th>Tags</th><th>Estado</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 8 : 7}>Cargando...</td></tr>
              ) : visible.length ? visible.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-[var(--text-0)]">{c.display_name}</td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{c.frigate_name}</td>
                  <td className="text-[11px] text-[var(--text-2)]">{serverMap.get(c.server_id)?.display_name ?? "—"}</td>
                  <td><span className={`vms-pill ${c.has_audio ? "green" : ""}`}>{c.has_audio ? "sí" : "no"}</span></td>
                  <td><span className={`vms-pill ${c.has_ptz ? "info" : ""}`}>{c.has_ptz ? "sí" : "no"}</span></td>
                  <td className="mono text-[10px] text-[var(--text-3)]">{c.tags.length ? c.tags.join(", ") : "—"}</td>
                  <td><span className={`vms-pill ${c.enabled ? "green" : "warn"}`}>{c.enabled ? "activa" : "inactiva"}</span></td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]"
                          onClick={() => openEdit(c)}>Editar</button>
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]"
                          onClick={() => confirmDelete(c)}>Eliminar</button>
                      </div>
                    </td>
                  )}
                </tr>
              )) : (
                <tr><td colSpan={isAdmin ? 8 : 7}>No hay cámaras.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && editing && (
        <Modal title={`Editar — ${editing.frigate_name}`} onClose={closeModal}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Nombre visible">
              <input value={form.display_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                className={INPUT} required />
            </Field>
            <Field label="Tags (separados por coma)">
              <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="exterior, entrada, ptz" className={INPUT} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {(["enabled", "has_audio", "has_ptz"] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={!!form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
                    className="accent-[var(--acc)]" />
                  <span className="text-sm text-[var(--text-1)]">
                    {k === "enabled" ? "Activa" : k === "has_audio" ? "Audio" : "PTZ"}
                  </span>
                </label>
              ))}
            </div>
            <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-3 space-y-1">
              <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wide">Info de solo lectura</p>
              <p className="mono text-[11px] text-[var(--text-2)]">frigate: {editing.frigate_name}</p>
              {editing.rtsp_main && <p className="mono text-[11px] text-[var(--text-2)]">rtsp: {editing.rtsp_main}</p>}
            </div>

            {cameraPlugins.length > 0 && (
              <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-3 space-y-2">
                <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wide">
                  Plugins asignados
                </p>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                  {cameraPlugins.map((p: Plugin) => (
                    <label key={p.name} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!pluginAssignments[p.name]}
                        onChange={(e) =>
                          setPluginAssignments((prev) => ({ ...prev, [p.name]: e.target.checked }))
                        }
                        className="accent-[var(--acc)]"
                      />
                      <span className="text-xs text-[var(--text-1)]">
                        {p.display_name ?? p.name}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handlePluginSave}
                    disabled={pluginSaveStatus === "saving"}
                    className="vms-btn !h-7 !min-h-0 !px-2.5 !text-xs disabled:opacity-60"
                  >
                    {pluginSaveStatus === "saving" ? "Guardando..." : "Guardar plugins"}
                  </button>
                  {pluginSaveStatus === "ok" && (
                    <span className="text-xs text-green-400">Guardado</span>
                  )}
                  {pluginSaveStatus === "error" && (
                    <span className="text-xs text-[var(--warn)]">Error al guardar</span>
                  )}
                </div>
              </div>
            )}

            {err && <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="vms-btn">Cancelar</button>
              <button type="submit" disabled={updateMut.isLoading} className="vms-btn primary disabled:opacity-60">
                {updateMut.isLoading ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
