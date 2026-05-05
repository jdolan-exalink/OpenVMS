import { useQuery } from "react-query";
import { Camera, listCameras } from "../api/cameras";
import { listEvents, VmsEvent } from "../api/events";
import { FrigateServer, listServers } from "../api/servers";

type DashboardData = {
  servers: FrigateServer[];
  cameras: Camera[];
  totalCameras: number;
  events: VmsEvent[];
};

async function loadDashboard(): Promise<DashboardData> {
  const [servers, cameras, events] = await Promise.all([
    listServers(),
    listCameras({ page_size: 200 }),
    listEvents({ limit: 100 }),
  ]);

  return {
    servers,
    cameras: cameras.items,
    totalCameras: cameras.total,
    events: events.items,
  };
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery("dashboard", loadDashboard, { refetchInterval: 30000 });

  const enabledServers = data?.servers.filter((server) => server.enabled).length ?? 0;
  const totalServers = data?.servers.length ?? 0;
  const activeCameras = data?.cameras.filter((camera) => camera.enabled).length ?? 0;
  const events24h = countEventsSince(data?.events ?? [], 24);
  const activeAlerts = (data?.events ?? []).filter((event) => event.end_time === null).length;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn)]">
          No se pudo cargar el resumen real del sistema.
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-4">
        <StatCard label="Camaras activas" value={isLoading ? "..." : `${activeCameras}/${data?.totalCameras ?? 0}`} detail="registradas" />
        <StatCard label="Servidores" value={isLoading ? "..." : `${enabledServers}/${totalServers}`} detail="habilitados" />
        <StatCard label="Eventos 24h" value={isLoading ? "..." : String(events24h)} detail="base real" />
        <StatCard label="Alertas activas" value={isLoading ? "..." : String(activeAlerts)} detail="sin cierre" tone={activeAlerts ? "warn" : "green"} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.9fr]">
        <CameraMap cameras={data?.cameras ?? []} servers={data?.servers ?? []} isLoading={isLoading} />
        <DetectionsChart events={data?.events ?? []} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.9fr]">
        <RecentEvents events={(data?.events ?? []).slice(0, 8)} cameras={data?.cameras ?? []} servers={data?.servers ?? []} isLoading={isLoading} />
        <ServerStatus servers={data?.servers ?? []} cameras={data?.cameras ?? []} isLoading={isLoading} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone = "green",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "green" | "warn";
}) {
  return (
    <div className="vms-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[28px] font-bold text-[var(--text-0)]">{value}</span>
        <span className={`vms-pill ${tone}`}>{detail}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-[var(--bg-3)]">
        <div className={`h-full ${tone === "warn" ? "bg-[var(--warn)]" : "bg-[var(--acc)]"}`} style={{ width: value === "0" ? "8%" : "72%" }} />
      </div>
    </div>
  );
}

function CameraMap({ cameras, servers, isLoading }: { cameras: Camera[]; servers: FrigateServer[]; isLoading: boolean }) {
  const serverById = mapById(servers);

  return (
    <section className="vms-card min-h-[320px]">
      <div className="vms-card-hd">
        <h3>Mapa de camaras</h3>
        <span className="mono ml-auto text-[11px] text-[var(--text-3)]">{isLoading ? "cargando" : `${cameras.length} reales`}</span>
      </div>
      <div className="relative min-h-[280px] bg-[#0a0d12]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="map-grid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="0.2" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#map-grid)" />
          <path
            d="M 8 12 L 84 12 L 84 38 L 60 38 L 60 56 L 84 56 L 84 88 L 8 88 Z"
            fill="rgba(0,208,132,.03)"
            stroke="rgba(207,214,226,.18)"
            strokeWidth="0.4"
          />
          <path d="M 8 38 L 60 38 M 8 56 L 60 56" stroke="rgba(207,214,226,.1)" strokeWidth="0.3" strokeDasharray="1 1" />
        </svg>
        {isLoading ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-[var(--text-2)]">Cargando camaras...</div>
        ) : cameras.length ? (
          cameras.map((camera, index) => {
            const position = cameraPosition(camera, index, cameras.length);
            const serverIndex = servers.findIndex((server) => server.id === camera.server_id);
            const server = serverById.get(camera.server_id);
            return (
              <div
                key={camera.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                title={`${camera.display_name} · ${server?.display_name ?? "sin servidor"}`}
              >
                <div
                  className="h-3 w-3 rounded-full border-2 border-[var(--bg-1)]"
                  style={{
                    background: camera.enabled ? `var(--srv-${serverClass(serverIndex)})` : "var(--text-3)",
                    boxShadow: camera.enabled ? "0 0 0 3px rgba(0,208,132,.15), 0 0 12px rgba(0,208,132,.45)" : "none",
                  }}
                />
                <span className="mono max-w-[110px] truncate rounded bg-[rgba(13,15,20,.86)] px-1 py-px text-[9px] text-[var(--text-2)]">
                  {camera.display_name}
                </span>
              </div>
            );
          })
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-[var(--text-2)]">No hay camaras sincronizadas.</div>
        )}
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          {servers.map((server, index) => (
            <span key={server.id} className={`srvchip ${serverClass(index)}`}>
              <span className="sw" />
              {server.display_name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetectionsChart({ events }: { events: VmsEvent[] }) {
  const buckets = buildEventBuckets(events);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.person + bucket.vehicle + bucket.lpr + bucket.other));

  return (
    <section className="vms-card">
      <div className="vms-card-hd">
        <h3>Detecciones por tipo</h3>
        <span className="ml-auto flex gap-3 text-[11px] text-[var(--text-2)]">
          <Legend color="var(--acc)" label="persona" />
          <Legend color="var(--info)" label="vehiculo" />
          <Legend color="var(--warn)" label="LPR" />
        </span>
      </div>
      <div className="flex h-[280px] items-end gap-1.5 px-4 pb-2 pt-5">
        {buckets.map((bucket) => {
          const total = bucket.person + bucket.vehicle + bucket.lpr + bucket.other;
          return (
            <div key={bucket.label} className="flex h-full flex-1 flex-col items-center gap-1.5">
              <div className="flex h-full w-full flex-col justify-end">
                <div className="flex w-full flex-col overflow-hidden rounded-t bg-[var(--bg-3)]" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                  <Segment color="var(--warn)" value={bucket.lpr} total={total} />
                  <Segment color="var(--info)" value={bucket.vehicle} total={total} />
                  <Segment color="var(--acc)" value={bucket.person} total={total} />
                  <Segment color="var(--text-3)" value={bucket.other} total={total} />
                </div>
              </div>
              <div className="mono text-[10px] text-[var(--text-3)]">{bucket.label}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Segment({ color, value, total }: { color: string; value: number; total: number }) {
  if (!value || !total) return null;
  return <div style={{ background: color, height: `${(value / total) * 100}%` }} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function RecentEvents({
  events,
  cameras,
  servers,
  isLoading,
}: {
  events: VmsEvent[];
  cameras: Camera[];
  servers: FrigateServer[];
  isLoading: boolean;
}) {
  const cameraById = mapById(cameras);
  const serverById = mapById(servers);

  return (
    <section className="vms-card">
      <div className="vms-card-hd">
        <h3>Ultimos eventos</h3>
        <span className="vms-pill green"><span className="vms-dot" />datos reales</span>
        <span className="mono ml-auto text-[11px] text-[var(--text-3)]">{events.length} cargados</span>
      </div>
      <table className="vms-table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Snapshot</th>
            <th>Servidor</th>
            <th>Camara</th>
            <th>Tipo</th>
            <th>Media</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6}>Cargando eventos...</td></tr>
          ) : events.length ? (
            events.map((event) => {
              const camera = event.camera_id ? cameraById.get(event.camera_id) : undefined;
              const server = event.server_id ? serverById.get(event.server_id) : undefined;
              const serverIndex = servers.findIndex((item) => item.id === event.server_id);
              return (
                <tr key={event.id}>
                  <td className="mono text-[var(--text-2)]">{formatTime(event.start_time)}</td>
                  <td><div className="video-thumb h-10 w-16" /></td>
                  <td><span className={`srvchip ${serverClass(serverIndex)}`}><span className="sw" />{server?.display_name ?? "sin servidor"}</span></td>
                  <td className="mono text-[11px]">{camera?.display_name ?? "sin camara"}</td>
                  <td>
                    <span className={`rounded px-2 py-1 text-[11px] font-medium ${event.label === "car" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--bg-3)] text-[var(--text-1)]"}`}>
                      {event.plate_number ? `${event.label} · ${event.plate_number}` : event.label}
                    </span>
                  </td>
                  <td className="mono text-[11px] text-[var(--text-2)]">{event.has_clip ? "clip" : event.has_snapshot ? "snapshot" : "metadata"}</td>
                </tr>
              );
            })
          ) : (
            <tr><td colSpan={6}>Sin eventos reales importados todavia.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ServerStatus({ servers, cameras, isLoading }: { servers: FrigateServer[]; cameras: Camera[]; isLoading: boolean }) {
  return (
    <section className="vms-card">
      <div className="vms-card-hd">
        <h3>Estado de servidores Frigate</h3>
      </div>
      <table className="vms-table">
        <thead>
          <tr>
            <th>Servidor</th>
            <th>Estado</th>
            <th>Camaras</th>
            <th>Endpoint</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={4}>Cargando servidores...</td></tr>
          ) : servers.length ? (
            servers.map((server, index) => (
              <tr key={server.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <span className={`srvchip ${serverClass(index)}`}><span className="sw" />{server.display_name}</span>
                  </div>
                </td>
                <td>
                  <span className={`vms-pill ${server.enabled ? "green" : "warn"}`}>
                    <span className={`vms-dot ${server.enabled ? "" : "warn"}`} />
                    {server.enabled ? "habilitado" : "deshabilitado"}
                  </span>
                </td>
                <td className="mono text-[11px] text-[var(--text-2)]">{cameras.filter((camera) => camera.server_id === server.id).length}</td>
                <td className="mono text-[11px] text-[var(--text-2)]">{server.url}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={4}>No hay servidores registrados.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function serverClass(index: number) {
  return (["a", "b", "c"] as const)[index >= 0 ? index % 3 : 0];
}

function cameraPosition(camera: Camera, index: number, total: number) {
  if (camera.position_x !== null && camera.position_y !== null) {
    return { x: clamp(camera.position_x, 5, 95), y: clamp(camera.position_y, 5, 95) };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 12 + (column * 76) / Math.max(1, columns - 1 || 1),
    y: 18 + (row * 64) / Math.max(1, rows - 1 || 1),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildEventBuckets(events: VmsEvent[]) {
  const now = new Date();
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(now.getTime() - (8 - index) * 3 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const bucketEvents = events.filter((event) => {
      const eventDate = new Date(event.start_time);
      return eventDate >= start && eventDate < end;
    });
    return {
      label: start.getHours().toString().padStart(2, "0"),
      person: bucketEvents.filter((event) => event.label === "person").length,
      vehicle: bucketEvents.filter((event) => ["car", "truck", "bus", "motorcycle", "bicycle"].includes(event.label)).length,
      lpr: bucketEvents.filter((event) => Boolean(event.plate_number)).length,
      other: bucketEvents.filter((event) => event.label !== "person" && !["car", "truck", "bus", "motorcycle", "bicycle"].includes(event.label) && !event.plate_number).length,
    };
  });
}

function countEventsSince(events: VmsEvent[], hours: number) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return events.filter((event) => new Date(event.start_time).getTime() >= cutoff).length;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
