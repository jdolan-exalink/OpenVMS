import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { User, UserCreate, UserRole, UserUpdate, createUser, deleteUser, listUsers, updateUser } from "../../api/users";
import { useAuthStore } from "../../store/authStore";

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";
const ROLES: UserRole[] = ["admin", "operator", "viewer"];
const ROLE_LABEL: Record<UserRole, string> = { admin: "Administrador", operator: "Operador", viewer: "Visor" };
const ROLE_PILL: Record<UserRole, string> = { admin: "warn", operator: "info", viewer: "green" };

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

const EMPTY_CREATE: UserCreate = { username: "", password: "", email: "", full_name: "", role: "viewer" };

export default function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [], isLoading } = useQuery("settings-users", listUsers);

  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [createForm, setCreateForm] = useState<UserCreate>(EMPTY_CREATE);
  const [editForm, setEditForm] = useState<UserUpdate>({});
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation(createUser, {
    onSuccess: () => { qc.invalidateQueries("settings-users"); closeModal(); },
    onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al crear usuario"),
  });

  const updateMut = useMutation(
    ({ id, body }: { id: string; body: UserUpdate }) => updateUser(id, body),
    {
      onSuccess: () => { qc.invalidateQueries("settings-users"); closeModal(); },
      onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al actualizar"),
    },
  );

  const deleteMut = useMutation(deleteUser, {
    onSuccess: () => qc.invalidateQueries("settings-users"),
    onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al eliminar"),
  });

  function openCreate() {
    setMode("create"); setCreateForm(EMPTY_CREATE); setErr(null);
  }

  function openEdit(u: User) {
    setEditing(u); setMode("edit");
    setEditForm({ email: u.email ?? "", full_name: u.full_name ?? "", role: u.role, is_active: u.is_active });
    setErr(null);
  }

  function closeModal() { setMode(null); setEditing(null); setErr(null); }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    createMut.mutate({
      ...createForm,
      email: createForm.email || null,
      full_name: createForm.full_name || null,
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!editing) return;
    updateMut.mutate({
      id: editing.id,
      body: { ...editForm, email: editForm.email || null, full_name: editForm.full_name || null },
    });
  }

  function confirmDelete(u: User) {
    if (u.id === currentUser?.id) { alert("No puedes eliminar tu propia cuenta."); return; }
    if (!confirm(`¿Eliminar usuario "${u.username}"?`)) return;
    deleteMut.mutate(u.id);
  }

  function formatDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Usuarios</h3>
          <span className="mono text-[11px] text-[var(--text-3)]">{users.length} registrados</span>
          {isAdmin && (
            <button type="button" className="vms-btn primary ml-auto" onClick={openCreate}>
              + Nuevo usuario
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="vms-table">
            <thead>
              <tr>
                <th>Usuario</th><th>Nombre</th><th>Email</th>
                <th>Rol</th><th>Estado</th><th>Último acceso</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 7 : 6}>Cargando...</td></tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-[var(--text-0)]">
                    {u.username}
                    {u.id === currentUser?.id && <span className="mono ml-1.5 text-[10px] text-[var(--acc-strong)]">(tú)</span>}
                  </td>
                  <td className="text-[var(--text-2)]">{u.full_name ?? "—"}</td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{u.email ?? "—"}</td>
                  <td><span className={`vms-pill ${ROLE_PILL[u.role as UserRole]}`}>{ROLE_LABEL[u.role as UserRole]}</span></td>
                  <td><span className={`vms-pill ${u.is_active ? "green" : "warn"}`}>{u.is_active ? "activo" : "inactivo"}</span></td>
                  <td className="mono text-[11px] text-[var(--text-3)]">{formatDate(u.last_login)}</td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]"
                          onClick={() => openEdit(u)}>Editar</button>
                        {u.id !== currentUser?.id && (
                          <button type="button" className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]"
                            onClick={() => confirmDelete(u)}>Eliminar</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mode === "create" && (
        <Modal title="Nuevo usuario" onClose={closeModal}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Usuario" required>
                <input value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="operador1" className={INPUT} required />
              </Field>
              <Field label="Contraseña" required>
                <input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••" className={INPUT} required minLength={6} />
              </Field>
            </div>
            <Field label="Nombre completo">
              <input value={createForm.full_name ?? ""} onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Juan Pérez" className={INPUT} />
            </Field>
            <Field label="Email">
              <input type="email" value={createForm.email ?? ""} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="juan@empresa.com" className={INPUT} />
            </Field>
            <Field label="Rol">
              <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                className={INPUT}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            {err && <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="vms-btn">Cancelar</button>
              <button type="submit" disabled={createMut.isLoading} className="vms-btn primary disabled:opacity-60">
                {createMut.isLoading ? "Creando..." : "Crear usuario"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {mode === "edit" && editing && (
        <Modal title={`Editar — ${editing.username}`} onClose={closeModal}>
          <form onSubmit={handleEdit} className="space-y-3">
            <Field label="Nombre completo">
              <input value={editForm.full_name ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Juan Pérez" className={INPUT} />
            </Field>
            <Field label="Email">
              <input type="email" value={editForm.email ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="juan@empresa.com" className={INPUT} />
            </Field>
            <Field label="Rol">
              <select value={editForm.role ?? editing.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                className={INPUT}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={editForm.is_active ?? editing.is_active}
                onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="accent-[var(--acc)]" />
              <span className="text-sm text-[var(--text-1)]">Cuenta activa</span>
            </label>
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
