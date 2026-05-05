import { useState } from "react";
import { useQuery, useMutation } from "react-query";
import { Camera } from "../../api/cameras";
import { createExport, downloadExport, getExportStatus } from "../../api/recordings";

function toLocalDatetime(unix: number) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetime(s: string) {
  return new Date(s).getTime() / 1000;
}

const INPUT = "mt-1 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";

interface ExportModalProps {
  cameras: Camera[];
  rangeStart: number;
  rangeEnd: number;
  onClose: () => void;
}

type ApiError = { response?: { data?: { detail?: string } } };

export default function ExportModal({ cameras, rangeStart, rangeEnd, onClose }: ExportModalProps) {
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? "");
  const [start, setStart] = useState(toLocalDatetime(rangeStart));
  const [end, setEnd] = useState(toLocalDatetime(Math.min(rangeStart + 3600, rangeEnd)));
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const createMut = useMutation(
    () => createExport({ camera_id: cameraId, start: new Date(fromLocalDatetime(start) * 1000).toISOString(), end: new Date(fromLocalDatetime(end) * 1000).toISOString() }),
    {
      onSuccess: (job) => { setJobId(job.job_id); setSubmitErr(null); },
      onError: (e: ApiError) => setSubmitErr(e.response?.data?.detail ?? "Error al crear exportación"),
    },
  );
  const downloadMut = useMutation(() => downloadExport(jobId!), {
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${jobId?.slice(0, 8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: () => setSubmitErr("No se pudo descargar el archivo. Vuelve a iniciar sesión si el problema continúa."),
  });

  const statusQuery = useQuery(
    ["export-status", jobId],
    () => getExportStatus(jobId!),
    {
      enabled: !!jobId,
      refetchInterval: (data) => (data?.status === "queued" || data?.status === "running" ? 2000 : false),
    },
  );

  const job = statusQuery.data;
  const isRunning = job?.status === "queued" || job?.status === "running";
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    const s = fromLocalDatetime(start);
    const en = fromLocalDatetime(end);
    if (en <= s) { setSubmitErr("La hora de fin debe ser posterior al inicio."); return; }
    if (en - s > 86400) { setSubmitErr("El rango no puede superar 24 horas."); return; }
    createMut.mutate();
  }

  function handleDownload() {
    if (!jobId) return;
    downloadMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}>
      <div className="vms-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-[var(--text-0)]">Exportar grabación</h3>
          <button type="button" onClick={onClose} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">✕</button>
        </div>

        {!jobId ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-2)]">Cámara</span>
              <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className={INPUT}>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-2)]">Inicio</span>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} required />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-2)]">Fin</span>
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} required />
            </label>
            <p className="text-[10px] text-[var(--text-3)]">Máximo 24 horas. El archivo se genera con FFmpeg en el servidor.</p>
            {submitErr && (
              <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{submitErr}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="vms-btn">Cancelar</button>
              <button type="submit" disabled={createMut.isLoading || !cameraId} className="vms-btn primary disabled:opacity-60">
                {createMut.isLoading ? "Creando..." : "Exportar"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Progress */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-[var(--text-1)]">
                  {isRunning ? "Generando archivo..." : isDone ? "Listo para descargar" : isFailed ? "Falló la exportación" : "En cola..."}
                </span>
                <span className="mono text-xs text-[var(--text-2)]">{job?.progress ?? 0}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[var(--bg-3)]">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${isFailed ? "bg-[var(--warn)]" : "bg-[var(--acc)]"}`}
                  style={{ width: `${job?.progress ?? 0}%` }}
                />
              </div>
            </div>

            {isFailed && job?.error && (
              <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
                {job.error}
              </p>
            )}
            {submitErr && (
              <p className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
                {submitErr}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="vms-btn">
                {isDone || isFailed ? "Cerrar" : "Cerrar (el job sigue en curso)"}
              </button>
              {isDone && (
                <button type="button" onClick={handleDownload} disabled={downloadMut.isLoading} className="vms-btn primary disabled:opacity-60">
                  {downloadMut.isLoading ? "Descargando..." : "↓ Descargar MP4"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
