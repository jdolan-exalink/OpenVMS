import { useState } from "react";
import { EventListParams } from "../../api/events";
import { Camera } from "../../api/cameras";
import { FrigateServer } from "../../api/servers";
import { PLUGIN_SOURCE_OPTIONS } from "../../utils/pluginMeta";

const SELECT = "h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-1)] outline-none focus:border-[var(--acc)]";
const DATE_INPUT = "h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]";

const LABEL_OPTIONS = [
  { value: "", label: "Todos los tipos" },
  { value: "person",     label: "Persona" },
  { value: "car",        label: "Auto" },
  { value: "truck",      label: "Camión" },
  { value: "bus",        label: "Bus" },
  { value: "bicycle",    label: "Bicicleta" },
  { value: "motorcycle", label: "Moto" },
  { value: "dog",        label: "Perro" },
  { value: "cat",        label: "Gato" },
  { value: "lpr",        label: "LPR / Placa" },
];

export type FiltersState = Omit<EventListParams, "cursor" | "limit">;

interface EventFiltersProps {
  cameras: Camera[];
  servers: FrigateServer[];
  onApply: (f: FiltersState) => void;
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function EventFiltersBar({ cameras, servers, onApply }: EventFiltersProps) {
  const [label, setLabel] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [serverId, setServerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [plate, setPlate] = useState("");
  const [hasClip, setHasClip] = useState<boolean | undefined>(undefined);
  const [isProtected, setIsProtected] = useState<boolean | undefined>(undefined);
  const [source, setSource] = useState("");

  function buildFilters(): FiltersState {
    const f: FiltersState = {};
    if (label)    f.label    = label;
    if (cameraId) f.camera_id = cameraId;
    if (serverId) f.server_id = serverId;
    if (startDate) f.start   = new Date(`${startDate}T00:00:00`).toISOString();
    if (endDate)   f.end     = new Date(`${endDate}T23:59:59`).toISOString();
    if (plate)     f.plate   = plate;
    if (hasClip != null) f.has_clip = hasClip;
    if (isProtected != null) f.is_protected = isProtected;
    if (source)    f.source   = source;
    return f;
  }

  function handleApply() { onApply(buildFilters()); }

  function handleClear() {
    setLabel(""); setCameraId(""); setServerId("");
    setStartDate(""); setEndDate(""); setPlate("");
    setHasClip(undefined); setIsProtected(undefined); setSource("");
    onApply({});
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleApply();
  }

  const activeCount = [label, cameraId, serverId, startDate, endDate, plate, hasClip != null, isProtected != null, source].filter(Boolean).length;

  return (
    <div className="vms-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Label */}
        <select value={label} onChange={(e) => setLabel(e.target.value)} className={SELECT}>
          {LABEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Camera */}
        <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className={SELECT}>
          <option value="">Todas las cámaras</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>

        {/* Server */}
        <select value={serverId} onChange={(e) => setServerId(e.target.value)} className={SELECT}>
          <option value="">Todos los servidores</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
        </select>

        {/* Source / Plugin */}
        <select
          value={source}
          onChange={(e) => { setSource(e.target.value); }}
          className={SELECT}
          style={source && source !== "frigate" && source !== "plugin" && source !== "" ? { borderColor: "#94a3b8" } : {}}
        >
          {PLUGIN_SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Date range */}
        <div className="flex items-center gap-1">
          <input type="date" value={startDate} max={todayDateStr()}
            onChange={(e) => setStartDate(e.target.value)} className={DATE_INPUT} />
          <span className="text-xs text-[var(--text-3)]">—</span>
          <input type="date" value={endDate} max={todayDateStr()}
            onChange={(e) => setEndDate(e.target.value)} className={DATE_INPUT} />
        </div>

        {/* Plate search */}
        <input
          type="text" value={plate} onChange={(e) => setPlate(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Placa..."
          className="h-8 w-28 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />

        {/* Has clip toggle */}
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={hasClip === true}
            onChange={(e) => setHasClip(e.target.checked ? true : undefined)}
            className="accent-[var(--acc)]"
          />
          <span className="text-xs text-[var(--text-2)]">Con clip</span>
        </label>

        {/* Protected filter */}
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={isProtected === true}
            onChange={(e) => setIsProtected(e.target.checked ? true : undefined)}
            className="accent-[#FBBF24]"
          />
          <span className="text-xs text-[var(--text-2)]">Protegidos</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 && (
            <button type="button" onClick={handleClear} className="vms-btn !h-8 !text-xs">
              Limpiar {activeCount > 0 && `(${activeCount})`}
            </button>
          )}
          <button type="button" onClick={handleApply} className="vms-btn primary !h-8 !text-xs">
            Buscar
          </button>
        </div>
      </div>
    </div>
  );
}
