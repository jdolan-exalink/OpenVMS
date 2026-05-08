import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import type { FrigateServer, FrigateServerCreate } from "../../api/servers";
import { createServer, syncServer } from "../../api/servers";
import { testServerConnection } from "../../api/systemConfig";
import type { TestConnectionResult } from "../../api/systemConfig";

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-2)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--warn)]">*</span>}
      </span>
      {children}
    </label>
  );
}

function toName(s: string) {
  return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

function suggestRtsp(url: string) {
  try {
    const u = new URL(url);
    return `rtsp://${u.hostname}:8554`;
  } catch {
    return "";
  }
}

type ApiError = { response?: { data?: { detail?: string } } };

type SyncResult = { added: number; updated: number; unchanged: number };

export default function ServerWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (server: FrigateServer) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [name, setName] = useState("");
  const [rtspBase, setRtspBase] = useState("");
  const [mqttOpen, setMqttOpen] = useState(false);
  const [mqttHost, setMqttHost] = useState("");
  const [mqttPort, setMqttPort] = useState(1883);
  const [mqttUser, setMqttUser] = useState("");
  const [mqttPass, setMqttPass] = useState("");

  const [createdServer, setCreatedServer] = useState<FrigateServer | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [stepErr, setStepErr] = useState<string | null>(null);

  const createMut = useMutation(createServer, {
    onSuccess: async (server) => {
      setCreatedServer(server);
      qc.invalidateQueries("settings-servers");
      try {
        const sr = await syncServer(server.id);
        setSyncResult(sr);
        qc.invalidateQueries("settings-cameras");
        qc.invalidateQueries("live-cameras");
      } catch {
        setSyncResult(null);
      }
    },
    onError: (e: ApiError) => setStepErr(e.response?.data?.detail ?? "Error al crear servidor"),
  });

  async function handleTest() {
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testServerConnection(url);
      setTestResult(r);
    } catch {
      setTestResult({ online: false, version: null, cameras: [], error: "Error de red" });
    } finally {
      setTesting(false);
    }
  }

  function handleStep1Next() {
    setStep(2);
    if (!rtspBase) setRtspBase(suggestRtsp(url));
  }

  function handleDisplayNameChange(v: string) {
    setDisplayName(v);
    setName(toName(v));
  }

  function handleStep3Submit() {
    setStepErr(null);
    const body: FrigateServerCreate = {
      name,
      display_name: displayName,
      url,
      rtsp_base: rtspBase,
      mqtt_host: mqttOpen && mqttHost ? mqttHost : null,
      mqtt_port: mqttOpen ? mqttPort : 1883,
      mqtt_username: mqttOpen && mqttUser ? mqttUser : null,
      mqtt_password: mqttOpen && mqttPass ? mqttPass : null,
      enabled: true,
    };
    createMut.mutate(body);
  }

  function handleFinish() {
    if (createdServer) onCreated(createdServer);
    onClose();
  }

  const steps = ["Conexión", "Configuración", "Confirmar"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="vms-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Agregar servidor Frigate</h3>
          <button type="button" onClick={onClose} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-0 mb-6">
          {steps.map((label, i) => {
            const idx = i + 1;
            const active = step === idx;
            const done = step > idx;
            return (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={[
                      "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition",
                      active
                        ? "border-[var(--acc)] bg-[var(--acc)] text-white"
                        : done
                        ? "border-[var(--acc)] bg-transparent text-[var(--acc)]"
                        : "border-[var(--line)] bg-transparent text-[var(--text-3)]",
                    ].join(" ")}
                  >
                    {done ? "✓" : idx}
                  </div>
                  <span
                    className={[
                      "text-[10px] mt-1",
                      active ? "text-[var(--acc-strong)]" : "text-[var(--text-3)]",
                    ].join(" ")}
                  >
                    {label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={[
                      "flex-1 h-px mx-2 mt-[-10px]",
                      done ? "bg-[var(--acc)]" : "bg-[var(--line)]",
                    ].join(" ")}
                  />
                )}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <Field label="URL del servidor Frigate" required>
              <div className="flex gap-2 mt-1">
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setTestResult(null); }}
                  placeholder="http://frigate:5000"
                  className="h-9 flex-1 rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!url || testing}
                  className="vms-btn !h-9 !px-3 disabled:opacity-50"
                >
                  {testing ? "···" : "Probar"}
                </button>
              </div>
            </Field>

            {testResult && (
              <div
                className={[
                  "rounded border px-3 py-2 text-sm space-y-1",
                  testResult.online
                    ? "border-green-500 bg-green-500/10"
                    : "border-[var(--warn)] bg-[var(--warn-soft)]",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 font-medium">
                  <span>{testResult.online ? "✓" : "✗"}</span>
                  <span className={testResult.online ? "text-green-400" : "text-[var(--warn)]"}>
                    {testResult.online
                      ? `Conectado — Frigate ${testResult.version ?? ""}`
                      : `Sin conexión${testResult.error ? ` (${testResult.error})` : ""}`}
                  </span>
                </div>
                {testResult.online && testResult.cameras.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wide mb-1">
                      {testResult.cameras.length} cámara{testResult.cameras.length !== 1 ? "s" : ""} encontrada{testResult.cameras.length !== 1 ? "s" : ""}
                    </p>
                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                      {testResult.cameras.map((c) => (
                        <p key={c} className="mono text-[11px] text-[var(--text-2)]">
                          {c}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="vms-btn">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStep1Next}
                disabled={!testResult?.online}
                className="vms-btn primary disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre visible" required>
                <input
                  value={displayName}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="Servidor Principal"
                  className={INPUT}
                  required
                />
              </Field>
              <Field label="Nombre interno" required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  pattern="^[a-z0-9_-]+$"
                  placeholder="servidor_principal"
                  className={INPUT}
                  required
                />
                <p className="mt-0.5 text-[10px] text-[var(--text-3)]">Solo minúsculas, números, - y _</p>
              </Field>
            </div>
            <Field label="Base RTSP — go2rtc" required>
              <input
                value={rtspBase}
                onChange={(e) => setRtspBase(e.target.value)}
                placeholder="rtsp://frigate:8554"
                className={INPUT}
                required
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 mt-1">
              <input
                type="checkbox"
                checked={mqttOpen}
                onChange={(e) => setMqttOpen(e.target.checked)}
                className="accent-[var(--acc)]"
              />
              <span className="text-sm text-[var(--text-1)]">Configurar MQTT</span>
            </label>
            {mqttOpen && (
              <div className="space-y-3 rounded border border-[var(--line)] p-3 bg-[var(--bg-2)]">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="MQTT host">
                    <input value={mqttHost} onChange={(e) => setMqttHost(e.target.value)} placeholder="mosquitto" className={INPUT} />
                  </Field>
                  <Field label="MQTT port">
                    <input type="number" value={mqttPort} onChange={(e) => setMqttPort(Number(e.target.value))} className={INPUT} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Usuario">
                    <input value={mqttUser} onChange={(e) => setMqttUser(e.target.value)} placeholder="opcional" className={INPUT} />
                  </Field>
                  <Field label="Contraseña">
                    <input type="password" value={mqttPass} onChange={(e) => setMqttPass(e.target.value)} placeholder="••••••" className={INPUT} />
                  </Field>
                </div>
              </div>
            )}
            <div className="flex justify-between gap-2 pt-1">
              <button type="button" onClick={() => setStep(1)} className="vms-btn">
                ← Atrás
              </button>
              <button
                type="button"
                onClick={() => { setStepErr(null); setStep(3); }}
                disabled={!displayName || !name || !rtspBase}
                className="vms-btn primary disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {!createdServer ? (
              <>
                <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-4 space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-2">
                    Resumen
                  </p>
                  <Row label="Nombre visible" value={displayName} />
                  <Row label="Nombre interno" value={name} />
                  <Row label="URL" value={url} />
                  <Row label="RTSP base" value={rtspBase} />
                  {mqttOpen && mqttHost && <Row label="MQTT host" value={mqttHost} />}
                </div>
                {stepErr && (
                  <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
                    {stepErr}
                  </p>
                )}
                <div className="flex justify-between gap-2">
                  <button type="button" onClick={() => setStep(2)} className="vms-btn">
                    ← Atrás
                  </button>
                  <button
                    type="button"
                    onClick={handleStep3Submit}
                    disabled={createMut.isLoading}
                    className="vms-btn primary disabled:opacity-60"
                  >
                    {createMut.isLoading ? "Creando..." : "Crear y sincronizar"}
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded border border-green-500 bg-green-500/10 px-3 py-3 text-sm text-green-400 space-y-1">
                  <p className="font-semibold">Servidor creado correctamente</p>
                  {syncResult ? (
                    <p className="text-[11px]">
                      Sync: +{syncResult.added} añadidas · {syncResult.updated} actualizadas · {syncResult.unchanged} sin cambios
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--text-3)]">No se pudo sincronizar cámaras automáticamente.</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={handleFinish} className="vms-btn primary">
                    Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-[var(--text-3)] w-28 shrink-0">{label}</span>
      <span className="mono text-[11px] text-[var(--text-1)] break-all">{value}</span>
    </div>
  );
}
