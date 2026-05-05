import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { useNavigate } from "react-router-dom";
import { listServers } from "../api/servers";
import { addFrigateCamera, AddCameraPayload, syncFrigateServer } from "../api/frigateConfig";

const FIELD = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";
const SELECT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]";
const CHECK = "h-4 w-4 rounded border-[var(--line)] bg-[var(--bg-2)] accent-[var(--acc)]";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-[var(--text-2)]">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

type StepId = 1 | 2 | 3 | 4 | 5;

const STEPS = [
  { id: 1 as StepId, label: "Servidor" },
  { id: 2 as StepId, label: "Streams RTSP" },
  { id: 3 as StepId, label: "Detección" },
  { id: 4 as StepId, label: "Grabación" },
  { id: 5 as StepId, label: "Confirmar" },
];

const TRACK_OPTIONS = ["person", "car", "truck", "bus", "bicycle", "motorcycle", "dog", "cat"];
const RECORD_MODES = [
  { value: "motion", label: "Solo movimiento" },
  { value: "active_objects", label: "Objetos activos" },
  { value: "all", label: "Continuo" },
] as const;

type ApiError = { response?: { data?: { detail?: string } } };

export default function CameraWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<StepId>(1);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Step 1
  const [serverId, setServerId] = useState("");

  // Step 2 — streams
  const [cameraName, setCameraName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rtspMain, setRtspMain] = useState("");
  const [rtspSub, setRtspSub] = useState("");
  const [hasAudio, setHasAudio] = useState(false);
  const [hasPtz, setHasPtz] = useState(false);

  // Step 3 — detect
  const [detectEnabled, setDetectEnabled] = useState(true);
  const [detectWidth, setDetectWidth] = useState(1280);
  const [detectHeight, setDetectHeight] = useState(720);
  const [detectFps, setDetectFps] = useState(5);
  const [trackObjects, setTrackObjects] = useState<string[]>(["person", "car", "truck"]);

  // Step 4 — record
  const [recordEnabled, setRecordEnabled] = useState(true);
  const [recordMode, setRecordMode] = useState<"all" | "motion" | "active_objects">("motion");
  const [recordDays, setRecordDays] = useState(7);
  const [snapshotsEnabled, setSnapshotsEnabled] = useState(true);
  const [snapshotsDays, setSnapshotsDays] = useState(10);

  const serversQuery = useQuery("wizard-servers", listServers);
  const servers = serversQuery.data ?? [];

  const addMut = useMutation(
    ({ sid, payload }: { sid: string; payload: AddCameraPayload }) => addFrigateCamera(sid, payload),
    {
      onSuccess: () => setDone(true),
      onError: (e: ApiError) => setError(e.response?.data?.detail ?? "Error al agregar la cámara"),
    },
  );

  const syncMut = useMutation((sid: string) => syncFrigateServer(sid));

  function toggleTrack(obj: string) {
    setTrackObjects((cur) =>
      cur.includes(obj) ? cur.filter((x) => x !== obj) : [...cur, obj],
    );
  }

  function validateStep(): string | null {
    if (step === 1 && !serverId) return "Seleccioná un servidor Frigate";
    if (step === 2) {
      if (!cameraName.trim()) return "Ingresá el nombre de la cámara";
      if (!/^[a-z0-9_-]+$/.test(cameraName)) return "Solo letras minúsculas, números, guiones y underscores";
      if (!displayName.trim()) return "Ingresá el nombre para mostrar";
      if (!rtspMain.trim()) return "Ingresá la URL RTSP principal";
      if (!rtspMain.startsWith("rtsp://")) return "La URL debe comenzar con rtsp://";
    }
    if (step === 4 && recordDays < 1) return "Días de retención debe ser al menos 1";
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => (s < 5 ? (s + 1) as StepId : s));
  }

  function prev() {
    setError(null);
    setStep((s) => (s > 1 ? (s - 1) as StepId : s));
  }

  async function submit() {
    setError(null);
    const payload: AddCameraPayload = {
      camera_name: cameraName,
      display_name: displayName,
      server_id: serverId,
      rtsp_main: rtspMain,
      rtsp_sub: rtspSub || null,
      detect_enabled: detectEnabled,
      detect_width: detectWidth,
      detect_height: detectHeight,
      detect_fps: detectFps,
      track_objects: trackObjects,
      record_enabled: recordEnabled,
      record_mode: recordMode,
      record_retain_days: recordDays,
      snapshots_enabled: snapshotsEnabled,
      snapshots_retain_days: snapshotsDays,
      has_audio: hasAudio,
      has_ptz: hasPtz,
      auto_save: true,
    };
    addMut.mutate({ sid: serverId, payload });
  }

  async function finish() {
    try { await syncMut.mutateAsync(serverId); } catch { /* best effort */ }
    navigate("/settings");
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--acc-soft)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.5" width="32" height="32">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-0)]">Cámara agregada</h2>
          <p className="mt-1 text-sm text-[var(--text-2)]">
            <strong>{displayName}</strong> fue configurada en Frigate correctamente.
          </p>
        </div>
        <div className="flex gap-3">
          <button type="button" className="vms-btn" onClick={() => { setDone(false); setStep(1); setCameraName(""); setDisplayName(""); setRtspMain(""); setRtspSub(""); }}>
            Agregar otra
          </button>
          <button type="button" className="vms-btn primary" onClick={finish} disabled={syncMut.isLoading}>
            {syncMut.isLoading ? "Sincronizando..." : "Ir a Ajustes"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Stepper */}
      <div className="vms-card p-4">
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-0 flex-1">
              <div className="flex flex-col items-center gap-1">
                <div className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition",
                  step === s.id ? "bg-[var(--acc)] text-[var(--bg-0)]" : step > s.id ? "bg-[var(--acc-soft)] text-[var(--acc)]" : "bg-[var(--bg-3)] text-[var(--text-3)]",
                ].join(" ")}>
                  {step > s.id ? "✓" : s.id}
                </div>
                <span className={`text-[10px] font-medium ${step === s.id ? "text-[var(--acc)]" : "text-[var(--text-3)]"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-1 mb-4 ${step > s.id ? "bg-[var(--acc)]" : "bg-[var(--line)]"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="vms-card p-5 space-y-4">
        {/* Step 1: Server */}
        {step === 1 && (
          <>
            <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Seleccionar servidor Frigate</h3>
            {serversQuery.isLoading ? (
              <p className="text-sm text-[var(--text-2)]">Cargando servidores...</p>
            ) : servers.length === 0 ? (
              <p className="text-sm text-[var(--warn)]">No hay servidores Frigate configurados. Agregá uno en Settings → Servidores.</p>
            ) : (
              <div className="space-y-3">
                {servers.map((srv) => (
                  <label key={srv.id} className={[
                    "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition",
                    serverId === srv.id ? "border-[var(--acc)] bg-[var(--acc-soft)]" : "border-[var(--line)] hover:border-[var(--acc)]",
                  ].join(" ")}>
                    <input type="radio" name="server" value={srv.id} checked={serverId === srv.id} onChange={() => setServerId(srv.id)} className="accent-[var(--acc)]" />
                    <div>
                      <div className="font-medium text-[var(--text-0)]">{srv.display_name}</div>
                      <div className="mono text-[11px] text-[var(--text-3)]">{srv.url}</div>
                    </div>
                    <span className={`ml-auto vms-pill ${srv.enabled ? "green" : "warn"}`}>
                      {srv.enabled ? "online" : "offline"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 2: Streams */}
        {step === 2 && (
          <>
            <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Configurar streams RTSP</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nombre de cámara *">
                <input
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="ej: entrada_principal"
                  className={FIELD}
                />
                <span className="text-[10px] text-[var(--text-3)]">Solo minúsculas, números, _ y -</span>
              </Field>
              <Field label="Nombre para mostrar *">
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ej: Entrada Principal" className={FIELD} />
              </Field>
            </div>
            <Field label="RTSP principal *">
              <input value={rtspMain} onChange={(e) => setRtspMain(e.target.value)} placeholder="rtsp://usuario:clave@192.168.1.x:554/stream1" className={FIELD} />
            </Field>
            <Field label="RTSP sub-stream (opcional — usado para detección)">
              <input value={rtspSub} onChange={(e) => setRtspSub(e.target.value)} placeholder="rtsp://usuario:clave@192.168.1.x:554/stream2" className={FIELD} />
            </Field>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hasAudio} onChange={(e) => setHasAudio(e.target.checked)} className={CHECK} />
                <span className="text-sm text-[var(--text-0)]">Tiene audio</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hasPtz} onChange={(e) => setHasPtz(e.target.checked)} className={CHECK} />
                <span className="text-sm text-[var(--text-0)]">Tiene PTZ</span>
              </label>
            </div>
          </>
        )}

        {/* Step 3: Detection */}
        {step === 3 && (
          <>
            <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Detección de objetos</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={detectEnabled} onChange={(e) => setDetectEnabled(e.target.checked)} className={CHECK} />
              <span className="text-sm font-medium text-[var(--text-0)]">Habilitar detección</span>
            </label>
            {detectEnabled && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Ancho px">
                    <input type="number" value={detectWidth} onChange={(e) => setDetectWidth(Number(e.target.value))} min={320} max={3840} step={32} className={FIELD} />
                  </Field>
                  <Field label="Alto px">
                    <input type="number" value={detectHeight} onChange={(e) => setDetectHeight(Number(e.target.value))} min={240} max={2160} step={32} className={FIELD} />
                  </Field>
                  <Field label="FPS detección">
                    <input type="number" value={detectFps} onChange={(e) => setDetectFps(Number(e.target.value))} min={1} max={30} className={FIELD} />
                  </Field>
                </div>
                <div>
                  <Label>Objetos a detectar</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TRACK_OPTIONS.map((obj) => (
                      <label key={obj} className={[
                        "flex items-center gap-1.5 rounded border px-2.5 py-1 cursor-pointer text-sm transition",
                        trackObjects.includes(obj) ? "border-[var(--acc)] bg-[var(--acc-soft)] text-[var(--acc-strong)]" : "border-[var(--line)] text-[var(--text-2)] hover:border-[var(--acc)]",
                      ].join(" ")}>
                        <input type="checkbox" checked={trackObjects.includes(obj)} onChange={() => toggleTrack(obj)} className="sr-only" />
                        {obj}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Step 4: Recording */}
        {step === 4 && (
          <>
            <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Grabación y snapshots</h3>
            <div className="space-y-4">
              <div className="rounded border border-[var(--line)] p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={recordEnabled} onChange={(e) => setRecordEnabled(e.target.checked)} className={CHECK} />
                  <span className="text-sm font-medium text-[var(--text-0)]">Habilitar grabación</span>
                </label>
                {recordEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Modo de grabación">
                      <select value={recordMode} onChange={(e) => setRecordMode(e.target.value as typeof recordMode)} className={SELECT}>
                        {RECORD_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Retención (días)">
                      <input type="number" value={recordDays} onChange={(e) => setRecordDays(Number(e.target.value))} min={1} max={365} className={FIELD} />
                    </Field>
                  </div>
                )}
              </div>
              <div className="rounded border border-[var(--line)] p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={snapshotsEnabled} onChange={(e) => setSnapshotsEnabled(e.target.checked)} className={CHECK} />
                  <span className="text-sm font-medium text-[var(--text-0)]">Habilitar snapshots</span>
                </label>
                {snapshotsEnabled && (
                  <Field label="Retención snapshots (días)">
                    <input type="number" value={snapshotsDays} onChange={(e) => setSnapshotsDays(Number(e.target.value))} min={1} max={365} className={FIELD} />
                  </Field>
                )}
              </div>
            </div>
          </>
        )}

        {/* Step 5: Confirm */}
        {step === 5 && (
          <>
            <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Confirmar y aplicar</h3>
            <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] text-sm">
              {[
                ["Servidor", servers.find((s) => s.id === serverId)?.display_name ?? serverId],
                ["Nombre", cameraName],
                ["Nombre visible", displayName],
                ["RTSP principal", rtspMain],
                ["RTSP sub", rtspSub || "—"],
                ["Detección", detectEnabled ? `${detectWidth}×${detectHeight} @ ${detectFps}fps` : "Desactivada"],
                ["Objetos", detectEnabled ? trackObjects.join(", ") : "—"],
                ["Grabación", recordEnabled ? `${recordMode} / ${recordDays}d` : "Desactivada"],
                ["Snapshots", snapshotsEnabled ? `${snapshotsDays}d` : "Desactivados"],
                ["Audio / PTZ", `${hasAudio ? "Audio" : "Sin audio"} / ${hasPtz ? "PTZ" : "Sin PTZ"}`],
              ].map(([label, val]) => (
                <div key={label} className="flex items-start gap-3 px-3 py-2">
                  <span className="w-32 shrink-0 text-[var(--text-3)]">{label}</span>
                  <span className="mono text-[var(--text-0)] break-all">{val}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-3)]">
              Al confirmar, se agregarán los streams go2rtc y la cámara al config de Frigate. Frigate se recargará automáticamente.
            </p>
          </>
        )}

        {/* Error */}
        {error && (
          <div className="rounded border border-[var(--warn)] bg-[rgba(255,90,90,0.08)] px-3 py-2 text-sm text-[var(--warn)]">
            {error}
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="flex justify-between">
        <button type="button" onClick={() => navigate("/settings")} className="vms-btn text-[var(--text-3)]">
          Cancelar
        </button>
        <div className="flex gap-2">
          {step > 1 && (
            <button type="button" onClick={prev} className="vms-btn" disabled={addMut.isLoading}>
              Atrás
            </button>
          )}
          {step < 5 ? (
            <button type="button" onClick={next} className="vms-btn primary" disabled={servers.length === 0}>
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              className="vms-btn primary"
              disabled={addMut.isLoading}
            >
              {addMut.isLoading ? "Aplicando..." : "Aplicar configuración"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
