import { useRef, useState } from "react";
import { useQuery } from "react-query";
import { listCameras } from "../../api/cameras";
import { getSemanticStats } from "../../api/plugins";

interface SearchResult {
  id: number;
  camera_id: string | null;
  event_time: string | null;
  description: string | null;
  similarity: number;
  metadata: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

async function searchSemantic(
  q: string,
  cameraId: string | undefined,
  limit: number,
  threshold: number,
): Promise<SearchResponse> {
  const params: Record<string, string | number> = { q, limit, threshold };
  if (cameraId) params.camera_id = cameraId;
  const { apiClient } = await import("../../api/client");
  const resp = await apiClient.get<SearchResponse>("/plugins/semantic_search/search", { params });
  return resp.data;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SemanticSearchPage() {
  const [query, setQuery] = useState("");
  const [cameraId, setCameraId] = useState<string>("all");
  const [threshold, setThreshold] = useState(0.25);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: camerasData } = useQuery("semantic-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasData?.items ?? [];

  const { data: stats } = useQuery("semantic-stats", () => getSemanticStats(), {
    retry: false,
    refetchInterval: 60000,
  });

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const data = await searchSemantic(
        q,
        cameraId !== "all" ? cameraId : undefined,
        20,
        threshold,
      );
      setResults(data.results);
      setLastQuery(data.query);
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : "Error al realizar la búsqueda";
      setError(msg);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") doSearch();
  }

  const camById = new Map(cameras.map((c) => [c.id, c]));
  const initialized = stats?.initialized ?? false;

  return (
    <div className="space-y-3">
      <div className="vms-card p-3">
        <h2 className="m-0 text-base font-semibold text-[var(--text-0)]">🔍 Búsqueda Semántica (CLIP)</h2>
      </div>

      {!initialized && (
        <div className="vms-card p-3 border border-yellow-500/30 bg-yellow-500/5">
          <p className="text-sm text-yellow-400">
            El plugin no está inicializado. Requiere GPU, modelo CLIP y extensión <span className="mono">pgvector</span> en PostgreSQL.
            Habilítalo desde Settings → Plugins y asegúrate de que <span className="mono">pgvector</span> esté instalado.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Embeddings indexados</span>
          <span className="text-2xl font-bold text-[var(--acc)]">{stats?.total_embeddings ?? "—"}</span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Frame más reciente</span>
          <span className="text-sm font-semibold text-[var(--text-0)]">
            {stats?.newest ? fmtTime(stats.newest) : "—"}
          </span>
        </div>
        <div className="vms-card p-4 flex flex-col gap-1">
          <span className="text-xs text-[var(--text-3)]">Estado</span>
          <span className={`text-sm font-semibold ${initialized ? "text-green-400" : "text-[var(--text-3)]"}`}>
            {initialized ? "Activo" : "No inicializado"}
          </span>
        </div>
      </div>

      <div className="vms-card p-3 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-0)]">Buscar por descripción</h3>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ej: persona con casco rojo, auto en zona prohibida..."
            className="flex-1 h-9 rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--acc)]"
          />
          <button
            type="button"
            onClick={doSearch}
            disabled={searching || !query.trim()}
            className="vms-btn !px-5 disabled:opacity-50"
          >
            {searching ? "Buscando..." : "Buscar"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-2)]">Cámara:</label>
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="h-8 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 text-sm text-[var(--text-0)]"
            >
              <option value="all">Todas</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-2)]">Similitud mínima:</label>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="mono text-xs text-[var(--text-2)]">{(threshold * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="vms-card p-3 border border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {results !== null && (
        <div className="vms-card">
          <div className="vms-card-hd">
            <h3>Resultados para &ldquo;{lastQuery}&rdquo;</h3>
            <span className="mono text-[11px] text-[var(--text-3)]">{results.length} coincidencias</span>
          </div>
          {results.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-2)]">
              Sin resultados. Prueba con una descripción diferente o reduce la similitud mínima.
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {results.map((r) => {
                const cam = r.camera_id ? camById.get(r.camera_id) : undefined;
                const simPct = Math.round(r.similarity * 100);
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3">
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {r.event_time && (
                          <span className="mono text-[11px] text-[var(--text-3)]">{fmtTime(r.event_time)}</span>
                        )}
                        {cam && <span className="text-xs text-[var(--text-2)]">{cam.display_name}</span>}
                        {!cam && r.camera_id && (
                          <span className="mono text-[11px] text-[var(--text-3)]">{r.camera_id}</span>
                        )}
                      </div>
                      {r.description && (
                        <p className="text-sm text-[var(--text-0)] line-clamp-2">{r.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`mono text-sm font-bold ${simPct >= 70 ? "text-green-400" : simPct >= 50 ? "text-yellow-400" : "text-[var(--text-2)]"}`}
                      >
                        {simPct}%
                      </div>
                      <div className="text-[10px] text-[var(--text-3)]">similitud</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {results === null && !searching && (
        <div className="vms-card p-6 text-center">
          <p className="text-sm text-[var(--text-3)]">
            Escribe una descripción en lenguaje natural para buscar frames similares indexados por CLIP.
          </p>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            Ejemplos: &ldquo;persona con mochila&rdquo;, &ldquo;vehículo en zona prohibida&rdquo;, &ldquo;multitud&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
