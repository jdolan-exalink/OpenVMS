import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { listCameras } from "../../api/cameras";
import type { Camera } from "../../api/cameras";
import { testTelegram, updatePluginConfig } from "../../api/plugins";
import type { NotificationRule, Plugin } from "../../api/plugins";
import { apiClient } from "../../api/client";

const COMMON_LABELS = ["person", "car", "truck", "bus", "motorcycle", "bicycle", "fire", "smoke"];

const EMPTY_RULE: NotificationRule = {
  name: "",
  enabled: true,
  cameras: [],
  labels: ["person"],
  zones: [],
  time_from: "",
  time_to: "",
  min_score: 0.5,
  cooldown_seconds: 60,
  cooldown_scope: "camera_label",
  channel: "telegram",
  telegram: { bot_token: "", chat_id: "" },
  webhook: { url: "" },
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const camerasQ = useQuery(["cameras"], () => listCameras({ page_size: 200 }));
  const cameras = camerasQ.data?.items ?? [];

  const pluginQ = useQuery(["plugin", "notifications"], () =>
    apiClient.get<Plugin>("/plugins/notifications").then((r) => r.data),
  );
  const rules: NotificationRule[] = (pluginQ.data?.config?.rules ?? []) as NotificationRule[];
  const pluginEnabled = pluginQ.data?.enabled ?? false;

  // Telegram tester
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgStatus, setTgStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [tgError, setTgError] = useState("");

  async function handleTestTelegram() {
    if (!tgToken || !tgChatId) return;
    setTgStatus("testing");
    setTgError("");
    try {
      await testTelegram(tgToken, tgChatId);
      setTgStatus("ok");
    } catch (e: unknown) {
      setTgStatus("error");
      const err = e as { response?: { data?: { detail?: string } } };
      setTgError(err?.response?.data?.detail ?? "Error de conexión con Telegram");
    }
  }

  // Rule editor state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formRule, setFormRule] = useState<NotificationRule>(EMPTY_RULE);

  const saveMut = useMutation(
    (newRules: NotificationRule[]) =>
      updatePluginConfig("notifications", { rules: newRules }),
    { onSuccess: () => qc.invalidateQueries(["plugin", "notifications"]) },
  );

  function startAdd() {
    setFormRule({
      ...EMPTY_RULE,
      telegram: { bot_token: tgToken, chat_id: tgChatId },
    });
    setEditingIndex(null);
    setIsAdding(true);
  }

  function startEdit(idx: number) {
    setFormRule({ ...rules[idx] });
    setEditingIndex(idx);
    setIsAdding(false);
  }

  function cancelForm() {
    setIsAdding(false);
    setEditingIndex(null);
  }

  function saveRule() {
    if (!formRule.name.trim()) return;
    const newRules = [...rules];
    if (editingIndex !== null) {
      newRules[editingIndex] = formRule;
    } else {
      newRules.push(formRule);
    }
    saveMut.mutate(newRules, { onSuccess: cancelForm });
  }

  function deleteRule(idx: number) {
    saveMut.mutate(rules.filter((_, i) => i !== idx));
  }

  const showForm = isAdding || editingIndex !== null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div>
            <h1 className="m-0 text-lg font-bold text-[var(--text-0)]">Alertas Multicanal</h1>
            <p className="text-xs text-[var(--text-3)]">
              Notificaciones por Telegram o Webhook según reglas de detección configurables
            </p>
          </div>
        </div>
        {!pluginEnabled && (
          <span className="rounded bg-[var(--warn)]/20 px-2 py-1 text-[11px] font-medium text-[var(--warn)]">
            Plugin desactivado — actívalo en Settings → Plugins
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Reglas activas" value={rules.filter((r) => r.enabled !== false).length} icon="📋" />
        <StatCard
          label="Telegram"
          value={rules.filter((r) => r.channel === "telegram").length}
          icon="✈️"
        />
        <StatCard
          label="Webhook"
          value={rules.filter((r) => r.channel === "webhook").length}
          icon="🔗"
        />
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-4">
        {/* Left: Rules list */}
        <div className="vms-card flex flex-col">
          <div className="vms-card-hd">
            <h3>Reglas de notificación</h3>
            <button onClick={startAdd} className="vms-btn primary !h-7 !min-h-0 !px-2 !text-xs">
              + Nueva regla
            </button>
          </div>

          {showForm && (
            <div className="border-b border-[var(--line)] bg-[var(--bg-2)] p-4">
              <RuleForm
                rule={formRule}
                onChange={setFormRule}
                cameras={cameras}
                onSave={saveRule}
                onCancel={cancelForm}
                saving={saveMut.isLoading}
                isEdit={editingIndex !== null}
              />
            </div>
          )}

          <div className="divide-y divide-[var(--line)]">
            {rules.map((rule, idx) => (
              <RuleRow
                key={idx}
                rule={rule}
                isEditing={editingIndex === idx}
                onEdit={() => startEdit(idx)}
                onDelete={() => deleteRule(idx)}
              />
            ))}
            {rules.length === 0 && !showForm && (
              <p className="p-6 text-center text-xs text-[var(--text-3)]">
                Sin reglas configuradas. Haz clic en «Nueva regla» para comenzar.
              </p>
            )}
          </div>
        </div>

        {/* Right: Telegram tester + help */}
        <div className="flex flex-col gap-3">
          <div className="vms-card">
            <div className="vms-card-hd">
              <h3>✈️ Probar Telegram</h3>
            </div>
            <div className="space-y-2 p-3 pt-0">
              <div>
                <label className="block text-[10px] text-[var(--text-3)]">Bot Token</label>
                <input
                  type="password"
                  value={tgToken}
                  onChange={(e) => {
                    setTgToken(e.target.value);
                    setTgStatus("idle");
                  }}
                  placeholder="123456:ABCdef…"
                  className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 font-mono text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-3)]">Chat ID</label>
                <input
                  type="text"
                  value={tgChatId}
                  onChange={(e) => {
                    setTgChatId(e.target.value);
                    setTgStatus("idle");
                  }}
                  placeholder="-1001234567890"
                  className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 font-mono text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
                />
              </div>
              {tgStatus === "ok" && (
                <p className="text-[10px] text-green-400">✅ Mensaje enviado correctamente</p>
              )}
              {tgStatus === "error" && (
                <p className="text-[10px] text-[var(--warn)]">❌ {tgError}</p>
              )}
              <button
                onClick={handleTestTelegram}
                disabled={!tgToken || !tgChatId || tgStatus === "testing"}
                className="vms-btn primary w-full !text-xs disabled:opacity-50"
              >
                {tgStatus === "testing" ? "Enviando…" : "📨 Enviar mensaje de prueba"}
              </button>
            </div>
          </div>

          <div className="vms-card p-3">
            <p className="text-[10px] font-semibold text-[var(--text-2)]">¿Cómo configurar el bot?</p>
            <ol className="mt-1 space-y-1 text-[10px] leading-relaxed text-[var(--text-3)]">
              <li>1. Busca <span className="font-mono">@BotFather</span> en Telegram</li>
              <li>2. Escribe <span className="font-mono">/newbot</span> y sigue los pasos</li>
              <li>3. Copia el token que te entrega</li>
              <li>4. Envía <span className="font-mono">/start</span> al bot desde el chat destino</li>
              <li>5. Para grupos: el Chat ID empieza con <span className="font-mono">-100…</span></li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="vms-card flex items-center gap-3 p-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-2xl font-bold text-[var(--text-0)]">{value}</div>
        <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  isEditing,
  onEdit,
  onDelete,
}: {
  rule: NotificationRule;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 transition ${
        isEditing ? "bg-[var(--acc)]/5" : "hover:bg-[var(--bg-2)]"
      }`}
    >
      <span className="mt-0.5 shrink-0 text-lg">{rule.channel === "telegram" ? "✈️" : "🔗"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-0)]">
            {rule.name || "Sin nombre"}
          </span>
          {rule.enabled === false && (
            <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[9px] text-[var(--text-3)]">
              pausada
            </span>
          )}
          {rule.time_from && rule.time_to && (
            <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[9px] text-[var(--text-3)]">
              🕐 {rule.time_from}–{rule.time_to}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[10px] text-[var(--text-3)]">
            📷 {rule.cameras.length > 0 ? rule.cameras.join(", ") : "todas las cámaras"}
          </span>
          {rule.labels.length > 0 && (
            <span className="text-[10px] text-[var(--text-3)]">· {rule.labels.join(", ")}</span>
          )}
          <span className="text-[10px] text-[var(--text-3)]">· cooldown {rule.cooldown_seconds}s</span>
          <span className="text-[10px] text-[var(--text-3)]">· {rule.cooldown_scope ?? "camera_label"}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <button onClick={onEdit} className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px]">
          Editar
        </button>
        <button
          onClick={onDelete}
          className="vms-btn !h-6 !min-h-0 !px-2 !text-[10px] !text-[var(--warn)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function RuleForm({
  rule,
  onChange,
  cameras,
  onSave,
  onCancel,
  saving,
  isEdit,
}: {
  rule: NotificationRule;
  onChange: (r: NotificationRule) => void;
  cameras: Camera[];
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  function set<K extends keyof NotificationRule>(key: K, value: NotificationRule[K]) {
    onChange({ ...rule, [key]: value });
  }

  function toggleCamera(name: string) {
    const cams = rule.cameras.includes(name)
      ? rule.cameras.filter((c) => c !== name)
      : [...rule.cameras, name];
    set("cameras", cams);
  }

  function toggleLabel(label: string) {
    const labels = rule.labels.includes(label)
      ? rule.labels.filter((l) => l !== label)
      : [...rule.labels, label];
    set("labels", labels);
  }

  const tg = rule.telegram ?? { bot_token: "", chat_id: "" };
  const wh = rule.webhook ?? { url: "" };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      <p className="col-span-2 -mb-1 text-xs font-semibold text-[var(--text-1)]">
        {isEdit ? "Editar regla" : "Nueva regla"}
      </p>

      {/* Name */}
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">Nombre *</label>
        <input
          type="text"
          value={rule.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Personas en patio nocturno…"
          className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
      </div>
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">Estado</label>
        <button
          type="button"
          onClick={() => set("enabled", rule.enabled === false)}
          className={`mt-0.5 h-[31px] w-full rounded border px-2 text-left text-xs ${
            rule.enabled === false
              ? "border-[var(--line)] bg-[var(--bg-1)] text-[var(--text-2)]"
              : "border-[var(--acc)] bg-[var(--acc)]/10 text-[var(--acc)]"
          }`}
        >
          {rule.enabled === false ? "Pausada" : "Activa"}
        </button>
      </div>

      {/* Cameras */}
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">
          Cámaras <span className="opacity-60">(vacío = todas)</span>
        </label>
        <div className="mt-1 max-h-28 overflow-y-auto rounded border border-[var(--line)] bg-[var(--bg-1)] p-1">
          {cameras.length === 0 ? (
            <p className="p-1 text-[10px] text-[var(--text-3)]">Sin cámaras registradas</p>
          ) : (
            cameras.map((cam) => (
              <label
                key={cam.id}
                className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--bg-2)]"
              >
                <input
                  type="checkbox"
                  checked={rule.cameras.includes(cam.name)}
                  onChange={() => toggleCamera(cam.name)}
                  className="h-3 w-3 accent-[var(--acc)]"
                />
                <span className="text-[11px] text-[var(--text-1)]">
                  {cam.display_name || cam.name}
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Labels */}
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">
          Detecciones <span className="opacity-60">(vacío = todas)</span>
        </label>
        <div className="mt-1 grid grid-cols-2 gap-0.5 rounded border border-[var(--line)] bg-[var(--bg-1)] p-1">
          {COMMON_LABELS.map((label) => (
            <label
              key={label}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--bg-2)]"
            >
              <input
                type="checkbox"
                checked={rule.labels.includes(label)}
                onChange={() => toggleLabel(label)}
                className="h-3 w-3 accent-[var(--acc)]"
              />
              <span className="text-[11px] text-[var(--text-1)]">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Time range */}
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">
          Hora inicio <span className="opacity-60">(vacío = siempre)</span>
        </label>
        <input
          type="time"
          value={rule.time_from ?? ""}
          onChange={(e) => set("time_from", e.target.value)}
          className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
      </div>
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">Hora fin</label>
        <input
          type="time"
          value={rule.time_to ?? ""}
          onChange={(e) => set("time_to", e.target.value)}
          className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
      </div>

      {/* Score + Cooldown */}
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">
          Confianza mínima:{" "}
          <span className="font-medium text-[var(--text-1)]">
            {(rule.min_score * 100).toFixed(0)}%
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={rule.min_score}
          onChange={(e) => set("min_score", parseFloat(e.target.value))}
          className="mt-1 w-full accent-[var(--acc)]"
        />
      </div>
      <div>
        <label className="block text-[10px] text-[var(--text-3)]">Cooldown (segundos)</label>
        <input
          type="number"
          min={10}
          max={3600}
          value={rule.cooldown_seconds}
          onChange={(e) => set("cooldown_seconds", parseInt(e.target.value) || 60)}
          className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
      </div>
      <div className="col-span-2 grid grid-cols-3 gap-2">
        {([
          ["camera_label", "Por cámara + detección"],
          ["camera", "Por cámara"],
          ["global", "Global"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => set("cooldown_scope", value)}
            className={`rounded border px-2 py-1.5 text-xs ${
              (rule.cooldown_scope ?? "camera_label") === value
                ? "border-[var(--acc)] bg-[var(--acc)]/10 text-[var(--acc)]"
                : "border-[var(--line)] bg-[var(--bg-1)] text-[var(--text-2)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Channel */}
      <div className="col-span-2">
        <label className="block text-[10px] text-[var(--text-3)]">Canal de envío</label>
        <div className="mt-1 flex gap-4">
          {(["telegram", "webhook"] as const).map((ch) => (
            <label key={ch} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="channel"
                value={ch}
                checked={rule.channel === ch}
                onChange={() => set("channel", ch)}
                className="accent-[var(--acc)]"
              />
              <span className="text-xs text-[var(--text-1)]">
                {ch === "telegram" ? "✈️ Telegram" : "🔗 Webhook"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Telegram fields */}
      {rule.channel === "telegram" && (
        <>
          <div>
            <label className="block text-[10px] text-[var(--text-3)]">Bot Token</label>
            <input
              type="password"
              value={tg.bot_token}
              onChange={(e) => set("telegram", { ...tg, bot_token: e.target.value })}
              placeholder="123456:ABCdef…"
              className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 font-mono text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--text-3)]">Chat ID</label>
            <input
              type="text"
              value={tg.chat_id}
              onChange={(e) => set("telegram", { ...tg, chat_id: e.target.value })}
              placeholder="-1001234567890"
              className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 font-mono text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
            />
          </div>
        </>
      )}

      {/* Webhook field */}
      {rule.channel === "webhook" && (
        <div className="col-span-2">
          <label className="block text-[10px] text-[var(--text-3)]">URL del Webhook</label>
          <input
            type="url"
            value={wh.url}
            onChange={(e) => set("webhook", { ...wh, url: e.target.value })}
            placeholder="https://hooks.example.com/notify"
            className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 font-mono text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
          />
        </div>
      )}

      {/* Actions */}
      <div className="col-span-2 flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="vms-btn !h-7 !min-h-0 !px-3 !text-xs">
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={saving || !rule.name.trim()}
          className="vms-btn primary !h-7 !min-h-0 !px-3 !text-xs disabled:opacity-50"
        >
          {saving ? "Guardando…" : isEdit ? "Actualizar regla" : "Agregar regla"}
        </button>
      </div>
    </div>
  );
}
