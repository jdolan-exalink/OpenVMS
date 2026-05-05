import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { NavLink } from "react-router-dom";
import {
  Plugin,
  disablePlugin,
  enablePlugin,
  listPlugins,
  updatePluginConfig,
} from "../../api/plugins";
import SchemaForm, { JsonSchema } from "../plugins/SchemaForm";

type ApiError = { response?: { data?: { detail?: string } } };

const CATEGORY_META: Record<string, { icon: string; color: string; label: string }> = {
  recognition:   { icon: "🔍", color: "text-purple-400", label: "Reconocimiento" },
  analytics:     { icon: "📊", color: "text-blue-400",   label: "Analíticas"     },
  safety:        { icon: "🔥", color: "text-red-400",    label: "Seguridad"      },
  ai:            { icon: "🤖", color: "text-green-400",  label: "IA"             },
  notifications: { icon: "🔔", color: "text-yellow-400", label: "Notificaciones" },
  other:         { icon: "📦", color: "text-[var(--text-2)]", label: "Otros"     },
};

const CATEGORY_ORDER = ["recognition", "analytics", "safety", "ai", "notifications", "other"];

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={[
        "relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none",
        checked
          ? "border-[var(--acc)] bg-[var(--acc)]"
          : "border-[var(--line)] bg-[var(--bg-2)]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[20px]" : "translate-x-[2px]",
        ].join(" ")}
      >
        {checked && (
          <svg className="h-2.5 w-2.5 text-[var(--acc)]" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

// ── Config modal ──────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="vms-card w-full max-w-xl flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — siempre visible */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h3 className="m-0 text-sm font-semibold text-[var(--text-0)]">{title}</h3>
          <button type="button" onClick={onClose} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">
            ✕
          </button>
        </div>
        {/* Body — scrolleable */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function buildDefaults(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!schema.properties) return result;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) result[key] = prop.default;
  }
  return result;
}

function resolveInitialConfig(plugin: Plugin): Record<string, unknown> {
  if (plugin.config && Object.keys(plugin.config).length > 0) return plugin.config;
  if (plugin.default_config && Object.keys(plugin.default_config).length > 0) return plugin.default_config;
  return buildDefaults((plugin.config_schema ?? {}) as JsonSchema);
}

// ── Telegram quick-notify section ────────────────────────────────────────────

type TelegramNotifyCfg = {
  enabled: boolean;
  bot_token: string;
  chat_id: string;
  schedule: "always" | "range";
  time_from: string;
  time_to: string;
};

function TelegramQuickConfig({
  value,
  onChange,
}: {
  value: TelegramNotifyCfg;
  onChange: (v: TelegramNotifyCfg) => void;
}) {
  function set<K extends keyof TelegramNotifyCfg>(key: K, val: TelegramNotifyCfg[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--bg-2)]/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-1)]">✈️ Notificar por Telegram</span>
        <ToggleSwitch
          checked={value.enabled}
          onChange={() => set("enabled", !value.enabled)}
        />
      </div>

      {value.enabled && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[var(--text-3)]">Bot Token</label>
              <input
                type="password"
                value={value.bot_token}
                onChange={(e) => set("bot_token", e.target.value)}
                placeholder="123456:ABCdef…"
                className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 font-mono text-[11px] text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-3)]">Chat ID</label>
              <input
                type="text"
                value={value.chat_id}
                onChange={(e) => set("chat_id", e.target.value)}
                placeholder="-1001234567890"
                className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 font-mono text-[11px] text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="tg-schedule"
                checked={value.schedule === "always"}
                onChange={() => set("schedule", "always")}
                className="accent-[var(--acc)]"
              />
              <span className="text-[11px] text-[var(--text-1)]">Todo el día</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="tg-schedule"
                checked={value.schedule === "range"}
                onChange={() => set("schedule", "range")}
                className="accent-[var(--acc)]"
              />
              <span className="text-[11px] text-[var(--text-1)]">Horario</span>
            </label>
          </div>

          {value.schedule === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[var(--text-3)]">Desde</label>
                <input
                  type="time"
                  value={value.time_from}
                  onChange={(e) => set("time_from", e.target.value)}
                  className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 text-[11px] text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-3)]">Hasta</label>
                <input
                  type="time"
                  value={value.time_to}
                  onChange={(e) => set("time_to", e.target.value)}
                  className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 text-[11px] text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
                />
              </div>
            </div>
          )}

          <p className="text-[10px] text-[var(--text-3)]">
            Probá el bot en{" "}
            <span className="text-[var(--acc)] cursor-pointer" onClick={() => window.open("/plugins/notifications", "_self")}>
              Alertas Multicanal ↗
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function extractTgConfig(cfg: Record<string, unknown>): TelegramNotifyCfg {
  const raw = (cfg.telegram_notify ?? {}) as Partial<TelegramNotifyCfg>;
  return {
    enabled: raw.enabled ?? false,
    bot_token: raw.bot_token ?? "",
    chat_id: raw.chat_id ?? "",
    schedule: raw.time_from && raw.time_to ? "range" : (raw.schedule ?? "always"),
    time_from: raw.time_from ?? "00:00",
    time_to: raw.time_to ?? "06:00",
  };
}

function buildTgPayload(tg: TelegramNotifyCfg): Record<string, unknown> | undefined {
  if (!tg.enabled) return undefined;
  return {
    enabled: true,
    bot_token: tg.bot_token,
    chat_id: tg.chat_id,
    ...(tg.schedule === "range"
      ? { time_from: tg.time_from, time_to: tg.time_to }
      : {}),
  };
}

// ── Config editor ─────────────────────────────────────────────────────────────

function ConfigEditor({
  plugin,
  onClose,
  refetch,
}: {
  plugin: Plugin;
  onClose: () => void;
  refetch: () => void;
}) {
  const schema = (plugin.config_schema ?? {}) as JsonSchema;
  const hasSchema = schema.properties && Object.keys(schema.properties).length > 0;

  const initialCfg = resolveInitialConfig(plugin);
  const [formValue, setFormValue] = useState<Record<string, unknown>>(initialCfg);
  const [rawMode, setRawMode] = useState(!hasSchema);
  const [raw, setRaw] = useState(() => JSON.stringify(initialCfg, null, 2));
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [tgCfg, setTgCfg] = useState<TelegramNotifyCfg>(() =>
    extractTgConfig(initialCfg),
  );

  const showTelegram = plugin.name !== "notifications";

  const saveMut = useMutation(
    (config: Record<string, unknown>) => updatePluginConfig(plugin.name, config),
    {
      onSuccess: () => { refetch(); onClose(); },
      onError: (e: ApiError) => setErr(e.response?.data?.detail ?? "Error al guardar"),
    },
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const tgPayload = buildTgPayload(tgCfg);
    if (rawMode) {
      setParseErr(null);
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (tgPayload) parsed.telegram_notify = tgPayload;
        else delete parsed.telegram_notify;
        saveMut.mutate(parsed);
      } catch {
        setParseErr("JSON inválido");
      }
    } else {
      const merged = { ...formValue };
      if (tgPayload) merged.telegram_notify = tgPayload;
      else delete merged.telegram_notify;
      saveMut.mutate(merged);
    }
  }

  function syncRawToForm() {
    setParseErr(null);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setFormValue(parsed);
      setTgCfg(extractTgConfig(parsed));
    } catch {
      setParseErr("JSON inválido — no se pueden sincronizar los campos");
    }
  }

  const isNewPlugin = !plugin.id;

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--text-3)] leading-relaxed">{plugin.description}</p>
        {hasSchema && (
          <button
            type="button"
            onClick={() => {
              if (rawMode) syncRawToForm();
              else setRaw(JSON.stringify(formValue, null, 2));
              setRawMode(!rawMode);
            }}
            className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] shrink-0"
          >
            {rawMode ? "🎨 Formulario" : "{ } JSON"}
          </button>
        )}
      </div>

      {isNewPlugin && (
        <div className="rounded border border-[var(--acc)]/30 bg-[var(--acc)]/8 px-3 py-2 text-[11px] text-[var(--acc)]">
          Config inicial cargada — ajusta las cámaras en <code>enabled_cameras</code> y guarda para activar.
        </div>
      )}

      {rawMode || !hasSchema ? (
        <div>
          <label className="block text-xs font-medium text-[var(--text-2)]">
            Configuración (JSON)
          </label>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            spellCheck={false}
            className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2 font-mono text-[11px] text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
          />
          {parseErr && <p className="text-xs text-[var(--warn)]">{parseErr}</p>}
        </div>
      ) : (
        <SchemaForm schema={schema} value={formValue} onChange={setFormValue} />
      )}

      {showTelegram && (
        <TelegramQuickConfig value={tgCfg} onChange={setTgCfg} />
      )}

      {err && (
        <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
          {err}
        </p>
      )}

      {/* Footer sticky */}
      <div className="sticky bottom-0 -mx-5 px-5 py-4 mt-4 bg-[var(--bg-1)] border-t border-[var(--line)] flex justify-end gap-2">
        <button type="button" onClick={onClose} className="vms-btn">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saveMut.isLoading}
          className="vms-btn primary disabled:opacity-60"
        >
          {saveMut.isLoading ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}

// ── Plugin row ────────────────────────────────────────────────────────────────

function PluginRow({
  plugin: p,
  isAdmin,
  busy,
  onConfig,
  onToggle,
}: {
  plugin: Plugin;
  isAdmin: boolean;
  busy: boolean;
  onConfig: () => void;
  onToggle: () => void;
}) {
  const label = p.display_name || p.name;

  return (
    <div className="flex items-center gap-3 pl-8 pr-4 py-2.5 transition hover:bg-[var(--bg-2)]/40">
      {/* Tree connector */}
      <span className="text-[var(--line)] text-[11px] select-none shrink-0">└</span>

      {/* Icon */}
      {p.sidebar_icon && (
        <span className="text-sm shrink-0" title={p.category}>{p.sidebar_icon}</span>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-[13px] text-[var(--text-0)]">{label}</span>
          <span className="mono text-[10px] text-[var(--text-3)]">v{p.version}</span>
          {p.requires_gpu && (
            <span className="vms-pill !bg-yellow-500/20 !text-yellow-400 !text-[9px]" title="Requiere GPU">GPU</span>
          )}
          {p.is_active && (
            <span className="vms-pill green !text-[9px]">activo</span>
          )}
          {p.has_sidebar_page && p.is_active && (
            <NavLink
              to={`/plugins/${p.sidebar_route || p.name}`}
              className="vms-pill !bg-[var(--acc)]/15 !text-[var(--acc)] hover:!bg-[var(--acc)]/25 !text-[9px]"
            >
              Abrir ↗
            </NavLink>
          )}
        </div>
        {p.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-3)]">{p.description}</p>
        )}
      </div>

      {/* Actions */}
      {isAdmin && (
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            title="Configurar"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-2)] transition hover:bg-[var(--bg-2)] hover:text-[var(--text-0)]"
            onClick={onConfig}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M13.3 6.7 12 6a4.9 4.9 0 0 0 0-1.4l1.2-.7a1 1 0 0 0 .4-1.3l-.5-.9a1 1 0 0 0-1.3-.4l-1.2.7A4.8 4.8 0 0 0 9.3 2V.7A1 1 0 0 0 8.3 0h-1a1 1 0 0 0-1 1v1.3a5 5 0 0 0-1.3.7L3.8 2.3a1 1 0 0 0-1.3.4l-.5.9a1 1 0 0 0 .4 1.3L3.6 5.6A5.1 5.1 0 0 0 3.5 8v.1L2.4 8.8a1 1 0 0 0-.4 1.3l.5.9a1 1 0 0 0 1.3.4L5 10.7a5 5 0 0 0 1.3.7V13a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.6a4.8 4.8 0 0 0 1.3-.7l1.2.7a1 1 0 0 0 1.3-.4l.5-.9a1 1 0 0 0-.4-1.3l-1-.6c.1-.4.1-.8.1-1.2Z" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
          <ToggleSwitch checked={p.enabled} onChange={onToggle} disabled={busy} />
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function PluginsPanel({ isAdmin }: { isAdmin: boolean }) {
  const pluginsQuery = useQuery(["settings-plugins"], listPlugins);
  const { data: plugins = [], isLoading } = pluginsQuery;
  const [configPlugin, setConfigPlugin] = useState<Plugin | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const enableMut = useMutation(enablePlugin, {
    onSuccess: () => pluginsQuery.refetch(),
    onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al habilitar"),
  });

  const disableMut = useMutation(disablePlugin, {
    onSuccess: () => pluginsQuery.refetch(),
    onError: (e: ApiError) => alert(e.response?.data?.detail ?? "Error al deshabilitar"),
  });

  function togglePlugin(p: Plugin) {
    if (p.enabled) {
      disableMut.mutate(p.name);
    } else {
      if (!p.id) {
        setConfigPlugin(p);
        return;
      }
      enableMut.mutate(p.name);
    }
  }

  function toggleCategory(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const isBusy = (name: string) =>
    (enableMut.isLoading && enableMut.variables === name) ||
    (disableMut.isLoading && disableMut.variables === name);

  const filtered = plugins.filter(
    (p) =>
      !search ||
      (p.display_name ?? p.name).toLowerCase().includes(search.toLowerCase()) ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  const byCategory = filtered.reduce(
    (acc, p) => {
      const cat = p.category ?? "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    },
    {} as Record<string, Plugin[]>,
  );

  const sortedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory[c]),
    ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  const activeCount = plugins.filter((p) => p.is_active).length;

  return (
    <>
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Plugins del sistema</h3>
          <div className="flex items-center gap-2">
            <span className="mono text-[11px] text-[var(--text-3)]">
              {activeCount} activos / {plugins.length} total
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar…"
              className="h-7 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </div>
        </div>

        {isLoading && (
          <div className="p-4 text-sm text-[var(--text-2)]">Cargando plugins…</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="p-4 text-sm text-[var(--text-2)]">
            {search ? "Sin resultados" : "No hay plugins registrados."}
          </div>
        )}

        {sortedCategories.map((category) => {
          const meta = CATEGORY_META[category] ?? CATEGORY_META.other;
          const catPlugins = byCategory[category] ?? [];
          const isCollapsed = collapsed.has(category);

          return (
            <div key={category} className="border-t border-[var(--line)]">
              {/* Category header — clickable tree node */}
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-[var(--bg-2)]/30"
              >
                <span className="text-[var(--line)] text-xs select-none">
                  {isCollapsed ? "▶" : "▼"}
                </span>
                <span className={`text-sm font-semibold ${meta.color}`}>
                  {meta.icon} {meta.label}
                </span>
                <span className="text-[11px] text-[var(--text-3)]">
                  ({catPlugins.length})
                </span>
                {catPlugins.some((p) => p.is_active) && (
                  <span className="ml-1 text-[10px] text-[var(--acc)]">
                    {catPlugins.filter((p) => p.is_active).length} activo{catPlugins.filter((p) => p.is_active).length !== 1 ? "s" : ""}
                  </span>
                )}
              </button>

              {/* Plugin rows */}
              {!isCollapsed && (
                <div className="divide-y divide-[var(--line)]/50 pb-1">
                  {catPlugins.map((p) => (
                    <PluginRow
                      key={p.name}
                      plugin={p}
                      isAdmin={isAdmin}
                      busy={isBusy(p.name)}
                      onConfig={() => setConfigPlugin(p)}
                      onToggle={() => togglePlugin(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {configPlugin && (
        <Modal
          title={`Configuración — ${configPlugin.display_name || configPlugin.name}`}
          onClose={() => setConfigPlugin(null)}
        >
          <ConfigEditor
            plugin={configPlugin}
            onClose={() => setConfigPlugin(null)}
            refetch={pluginsQuery.refetch}
          />
        </Modal>
      )}
    </>
  );
}
