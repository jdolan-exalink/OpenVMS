import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import {
  LprBlacklist,
  LprPlate,
  addToBlacklist,
  listBlacklist,
  listPlates,
  removeFromBlacklist,
  searchPlates,
} from "../../api/plugins";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "medium" });
}

function StatusPill({ blacklisted }: { blacklisted: boolean }) {
  return blacklisted ? (
    <span className="rounded bg-[var(--warn)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
      LISTA NEGRA
    </span>
  ) : (
    <span className="rounded bg-[var(--acc)]/15 px-1.5 py-0.5 text-[10px] text-[var(--acc)]">OK</span>
  );
}

export default function LprPage() {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<LprPlate[]>([]);
  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [blErr, setBlErr] = useState<string | null>(null);

  const platesQ = useQuery(["lpr-plates"], () => listPlates({ limit: 200 }), { refetchInterval: 15000 });
  const blacklistQ = useQuery(["lpr-blacklist"], listBlacklist, { refetchInterval: 30000 });

  const plates = platesQ.data ?? [];
  const blacklist = blacklistQ.data ?? [];

  const totalToday = plates.filter((p) => {
    const d = new Date(p.detected_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  const alertsToday = plates.filter((p) => {
    const d = new Date(p.detected_at);
    const now = new Date();
    return p.is_blacklisted && d.toDateString() === now.toDateString();
  }).length;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    try {
      const results = await searchPlates(search.trim());
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }

  const addMut = useMutation(
    () => addToBlacklist(newPlate.trim().toUpperCase(), newReason.trim() || undefined),
    {
      onSuccess: () => {
        setNewPlate("");
        setNewReason("");
        setBlErr(null);
        blacklistQ.refetch();
        platesQ.refetch();
      },
      onError: (e: { response?: { data?: { detail?: string } } }) => {
        setBlErr(e.response?.data?.detail ?? "Error al agregar");
      },
    },
  );

  const removeMut = useMutation(removeFromBlacklist, {
    onSuccess: () => {
      blacklistQ.refetch();
      platesQ.refetch();
    },
  });

  const displayPlates = search.trim() && searchResults.length > 0 ? searchResults : plates;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🚗</span>
        <div>
          <h1 className="m-0 text-lg font-bold text-[var(--text-0)]">LPR — Reconocimiento de Matrículas</h1>
          <p className="text-xs text-[var(--text-3)]">Historial de detecciones y gestión de lista negra</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Detectadas hoy" value={totalToday} icon="📷" />
        <StatCard label="Alertas hoy" value={alertsToday} icon="🚨" warn={alertsToday > 0} />
        <StatCard label="En lista negra" value={blacklist.length} icon="🚫" />
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4">
        {/* Plates table */}
        <div className="vms-card flex flex-col gap-0">
          <div className="vms-card-hd">
            <h3>Detecciones recientes</h3>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (!e.target.value) setSearchResults([]);
                }}
                placeholder="Buscar matrícula…"
                className="h-7 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
              />
              <button type="submit" disabled={searching} className="vms-btn !h-7 !min-h-0 !px-2 !text-xs">
                {searching ? "…" : "Buscar"}
              </button>
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setSearchResults([]); }}
                  className="vms-btn !h-7 !min-h-0 !px-2 !text-xs"
                >
                  ✕
                </button>
              )}
            </form>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="px-4 py-2 text-left font-medium">Matrícula</th>
                  <th className="px-4 py-2 text-left font-medium">Confianza</th>
                  <th className="px-4 py-2 text-left font-medium">Cámara</th>
                  <th className="px-4 py-2 text-left font-medium">Fecha/Hora</th>
                  <th className="px-4 py-2 text-left font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {displayPlates.map((p) => (
                  <PlateRow
                    key={p.id}
                    plate={p}
                    isBlacklisted={blacklist.some((b) => b.plate_number === p.plate_number)}
                    onBlacklist={() => {
                      setNewPlate(p.plate_number);
                      setNewReason("");
                    }}
                  />
                ))}
                {displayPlates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-3)]">
                      {platesQ.isLoading ? "Cargando…" : "Sin detecciones"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Blacklist panel */}
        <div className="flex flex-col gap-3">
          <div className="vms-card">
            <div className="vms-card-hd">
              <h3>Agregar a lista negra</h3>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }}
              className="space-y-2 p-3 pt-0"
            >
              <input
                type="text"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                placeholder="Matrícula…"
                required
                className="w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] outline-none font-mono uppercase focus:border-[var(--acc)]"
              />
              <input
                type="text"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Motivo (opcional)…"
                className="w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
              />
              {blErr && <p className="text-[10px] text-[var(--warn)]">{blErr}</p>}
              <button
                type="submit"
                disabled={addMut.isLoading || !newPlate.trim()}
                className="vms-btn primary w-full !text-xs disabled:opacity-50"
              >
                {addMut.isLoading ? "Agregando…" : "🚫 Agregar a lista negra"}
              </button>
            </form>
          </div>

          <div className="vms-card flex-1">
            <div className="vms-card-hd">
              <h3>Lista negra</h3>
              <span className="mono text-[10px] text-[var(--text-3)]">{blacklist.length} entradas</span>
            </div>
            <div className="max-h-80 divide-y divide-[var(--line)] overflow-auto">
              {blacklist.map((entry) => (
                <BlacklistRow
                  key={entry.id}
                  entry={entry}
                  onRemove={() => removeMut.mutate(entry.id)}
                />
              ))}
              {blacklist.length === 0 && (
                <p className="p-3 text-xs text-[var(--text-3)]">Lista negra vacía</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, warn }: { label: string; value: number; icon: string; warn?: boolean }) {
  return (
    <div className="vms-card flex items-center gap-3 p-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className={`text-2xl font-bold ${warn ? "text-[var(--warn)]" : "text-[var(--text-0)]"}`}>
          {value}
        </div>
        <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      </div>
    </div>
  );
}

function PlateRow({
  plate,
  isBlacklisted,
  onBlacklist,
}: {
  plate: LprPlate;
  isBlacklisted: boolean;
  onBlacklist: () => void;
}) {
  return (
    <tr className={`transition hover:bg-[var(--bg-2)] ${plate.is_blacklisted ? "bg-[var(--warn)]/5" : ""}`}>
      <td className="px-4 py-2">
        <span className="mono font-semibold text-[var(--text-0)]">{plate.plate_number}</span>
      </td>
      <td className="px-4 py-2 text-[var(--text-2)]">
        {plate.plate_score != null ? `${(plate.plate_score * 100).toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-2 text-[var(--text-2)]">
        <span className="mono text-[10px]">{plate.camera_id?.slice(0, 8) ?? "—"}</span>
      </td>
      <td className="px-4 py-2 text-[var(--text-3)]">{fmt(plate.detected_at)}</td>
      <td className="px-4 py-2">
        <StatusPill blacklisted={plate.is_blacklisted} />
      </td>
      <td className="px-4 py-2">
        {!isBlacklisted && (
          <button
            type="button"
            onClick={onBlacklist}
            className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px] !text-[var(--warn)]"
          >
            Bloquear
          </button>
        )}
      </td>
    </tr>
  );
}

function BlacklistRow({ entry, onRemove }: { entry: LprBlacklist; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="mono text-xs font-semibold text-[var(--text-0)]">{entry.plate_number}</div>
        {entry.reason && <div className="truncate text-[10px] text-[var(--text-3)]">{entry.reason}</div>}
        <div className="text-[9px] text-[var(--text-3)]">{fmt(entry.added_at)}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="vms-btn !h-5 !min-h-0 !px-1.5 !text-[9px] !text-[var(--warn)] shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
