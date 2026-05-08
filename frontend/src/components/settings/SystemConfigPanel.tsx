import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getSystemConfig, updateSystemConfig } from "../../api/systemConfig";
import type { SystemConfig } from "../../api/systemConfig";

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";
const TEXTAREA = "mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)] font-mono resize-y min-h-[80px]";

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-2)]">{label}</span>
      {description && <p className="text-[10px] text-[var(--text-3)] mt-0.5">{description}</p>}
      {children}
    </label>
  );
}

type ApiError = { response?: { data?: { detail?: string } } };

export default function SystemConfigPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery("system-config", getSystemConfig);

  const [form, setForm] = useState<Omit<SystemConfig, "cors_origins">>({
    ome_webrtc_base: "",
    ome_llhls_base: "",
    go2rtc_rtsp_host: "",
  });
  const [corsRaw, setCorsRaw] = useState("");
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        ome_webrtc_base: data.ome_webrtc_base,
        ome_llhls_base: data.ome_llhls_base,
        go2rtc_rtsp_host: data.go2rtc_rtsp_host,
      });
      setCorsRaw(data.cors_origins.join("\n"));
    }
  }, [data]);

  const saveMut = useMutation(
    (updates: Partial<SystemConfig>) => updateSystemConfig(updates),
    {
      onSuccess: () => {
        qc.invalidateQueries("system-config");
        setSuccess(true);
        setErr(null);
        setTimeout(() => setSuccess(false), 3000);
      },
      onError: (e: ApiError) => {
        setErr(e.response?.data?.detail ?? "Error al guardar");
        setSuccess(false);
      },
    },
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cors_origins = corsRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    saveMut.mutate({ ...form, cors_origins });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (isLoading) {
    return <div className="vms-card p-5 text-sm text-[var(--text-2)]">Cargando configuración...</div>;
  }

  return (
    <div className="vms-card">
      <div className="vms-card-hd">
        <h3>Configuración del sistema</h3>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-5">
        <section>
          <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-3">
            Streaming — OvenMediaEngine
          </p>
          <div className="space-y-3">
            <Field label="OME WebRTC Base">
              <input
                value={form.ome_webrtc_base}
                onChange={set("ome_webrtc_base")}
                placeholder="ws://ome:3333/app"
                className={INPUT}
              />
            </Field>
            <Field label="OME LL-HLS Base">
              <input
                value={form.ome_llhls_base}
                onChange={set("ome_llhls_base")}
                placeholder="http://ome:3334/app"
                className={INPUT}
              />
            </Field>
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-3">
            go2rtc
          </p>
          <div className="space-y-3">
            <Field
              label="Host RTSP para Frigate"
              description="Dirección que Frigate usa para pull desde go2rtc"
            >
              <input
                value={form.go2rtc_rtsp_host}
                onChange={set("go2rtc_rtsp_host")}
                placeholder="127.0.0.1:8554"
                className={INPUT}
              />
            </Field>
            <Field label="CORS Origins" description="Una URL por línea">
              <textarea
                value={corsRaw}
                onChange={(e) => setCorsRaw(e.target.value)}
                placeholder="http://localhost:3000"
                className={TEXTAREA}
              />
            </Field>
          </div>
        </section>

        <div className="rounded border border-[var(--acc)] bg-[var(--acc-soft,_color-mix(in_srgb,var(--acc)_10%,transparent))] px-3 py-2 text-xs text-[var(--text-1)]">
          Los cambios en URLs OME requieren re-sincronizar las cámaras para actualizar los streams almacenados.
        </div>

        {err && (
          <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
            {err}
          </p>
        )}
        {success && (
          <p className="rounded border border-green-500 bg-green-500/10 px-3 py-2 text-sm text-green-400">
            Configuración guardada correctamente.
          </p>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={saveMut.isLoading} className="vms-btn primary disabled:opacity-60">
            {saveMut.isLoading ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>
      </form>
    </div>
  );
}
