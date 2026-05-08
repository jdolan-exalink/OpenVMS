import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useQuery } from "react-query";
import { Camera, listCameras } from "../api/cameras";
import { FrigateServer, listServers } from "../api/servers";
import { useEventStore } from "../store/eventStore";
import { useCameraStore } from "../store/cameraStore";

// ─── Layout system ──────────────────────────────────────────────────────────────

type LayoutId =
  | "g1" | "g2x2" | "g3x3" | "g4x4" | "g5x5" | "g6x6" | "g8x4"
  | "f1p3" | "f1p5" | "f2p4" | "f1p9";

type SlotDef = { colSpan: number; rowSpan: number };

type LayoutDef = {
  id: LayoutId;
  label: string;
  cols: number;
  rows: number;   // 0 = uniform (height from aspect-ratio), >0 = featured (height from viewport)
  slots: SlotDef[];
  max: number;
};

const LAYOUTS: LayoutDef[] = [
  { id: "g1",   label: "1×1",  cols: 1, rows: 0, slots: [], max: 1  },
  { id: "g2x2", label: "2×2",  cols: 2, rows: 0, slots: [], max: 4  },
  { id: "g3x3", label: "3×3",  cols: 3, rows: 0, slots: [], max: 9  },
  { id: "g4x4", label: "4×4",  cols: 4, rows: 0, slots: [], max: 16 },
  { id: "g5x5", label: "5×5",  cols: 5, rows: 0, slots: [], max: 25 },
  { id: "g6x6", label: "6×6",  cols: 6, rows: 0, slots: [], max: 36 },
  { id: "g8x4", label: "Mural", cols: 8, rows: 0, slots: [], max: 32 },
  // 1 large left (full height) + 3 small stacked right
  {
    id: "f1p3", label: "1+3", cols: 2, rows: 3,
    slots: [
      { colSpan: 1, rowSpan: 3 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
    ],
    max: 4,
  },
  // 1 large top-left (2×2) + 2 small right + 3 small bottom row
  {
    id: "f1p5", label: "1+5", cols: 3, rows: 3,
    slots: [
      { colSpan: 2, rowSpan: 2 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
    ],
    max: 6,
  },
  // 2 large top (each spans 2 cols) + 4 small bottom row
  {
    id: "f2p4", label: "2+4", cols: 4, rows: 2,
    slots: [
      { colSpan: 2, rowSpan: 1 },
      { colSpan: 2, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
    ],
    max: 6,
  },
  // 1 large (2 cols × 3 rows) + 3 right column + 6 in two bottom rows  →  1 + 9
  {
    id: "f1p9", label: "1+9", cols: 3, rows: 5,
    slots: [
      { colSpan: 2, rowSpan: 3 },
      ...Array.from({ length: 9 }, () => ({ colSpan: 1, rowSpan: 1 })),
    ],
    max: 10,
  },
];

const UNIFORM_LAYOUTS = LAYOUTS.filter((l) => l.rows === 0);
const FEATURED_LAYOUTS = LAYOUTS.filter((l) => l.rows > 0);
const LAYOUT_KEY = "openvms.live.layout.v1";

function readStoredLayout(): LayoutId {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v && LAYOUTS.some((l) => l.id === v)) return v as LayoutId;
  } catch { /* ignore */ }
  return "g3x3";
}

// ─── Layout SVG icons ───────────────────────────────────────────────────────────

function GridIcon({ cols, rows }: { cols: number; rows: number }) {
  const g = 1; const W = 20; const H = 15;
  const cw = (W - g * (cols - 1)) / cols;
  const rh = (H - g * (rows - 1)) / rows;
  const cells: JSX.Element[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect key={`${r}-${c}`} x={c * (cw + g)} y={r * (rh + g)} width={cw} height={rh} rx={0.5}
          fill="currentColor" fillOpacity={0.75} />,
      );
    }
  }
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>{cells}</svg>;
}

function IconF1p3() {
  const W = 20; const H = 15; const g = 1;
  const c1 = 10; const c2 = W - c1 - g;
  const rh = (H - g * 2) / 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <rect x={0} y={0} width={c1} height={H} rx={0.5} fill="currentColor" fillOpacity={0.9} />
      {[0, 1, 2].map((r) => (
        <rect key={r} x={c1 + g} y={r * (rh + g)} width={c2} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      ))}
    </svg>
  );
}

function IconF1p5() {
  const W = 20; const H = 15; const g = 1;
  const cw = (W - g * 2) / 3;
  const rh = (H - g * 2) / 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <rect x={0} y={0} width={cw * 2 + g} height={rh * 2 + g} rx={0.5} fill="currentColor" fillOpacity={0.9} />
      <rect x={cw * 2 + g * 2} y={0} width={cw} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      <rect x={cw * 2 + g * 2} y={rh + g} width={cw} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      {[0, 1, 2].map((c) => (
        <rect key={c} x={c * (cw + g)} y={rh * 2 + g * 2} width={cw} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      ))}
    </svg>
  );
}

function IconF2p4() {
  const W = 20; const H = 15; const g = 1;
  const cw = (W - g * 3) / 4;
  const rh1 = 8; const rh2 = H - rh1 - g;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <rect x={0} y={0} width={cw * 2 + g} height={rh1} rx={0.5} fill="currentColor" fillOpacity={0.9} />
      <rect x={cw * 2 + g * 2} y={0} width={cw * 2 + g} height={rh1} rx={0.5} fill="currentColor" fillOpacity={0.9} />
      {[0, 1, 2, 3].map((c) => (
        <rect key={c} x={c * (cw + g)} y={rh1 + g} width={cw} height={rh2} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      ))}
    </svg>
  );
}

function IconF1p9() {
  // 3 cols × 5 rows: large spans col1-2 rows 1-3, col3 rows 1-3, then 2 full rows
  const W = 20; const H = 15; const g = 0.8;
  const cw = (W - g * 2) / 3;
  const rh = (H - g * 4) / 5;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <rect x={0} y={0} width={cw * 2 + g} height={rh * 3 + g * 2} rx={0.5} fill="currentColor" fillOpacity={0.9} />
      {[0, 1, 2].map((r) => (
        <rect key={r} x={cw * 2 + g * 2} y={r * (rh + g)} width={cw} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
      ))}
      {[3, 4].map((row) =>
        [0, 1, 2].map((col) => (
          <rect key={`${row}-${col}`} x={col * (cw + g)} y={row * (rh + g)} width={cw} height={rh} rx={0.5} fill="currentColor" fillOpacity={0.5} />
        )),
      )}
    </svg>
  );
}

function LayoutIcon({ id }: { id: LayoutId }) {
  switch (id) {
    case "g1":    return <GridIcon cols={1} rows={1} />;
    case "g2x2":  return <GridIcon cols={2} rows={2} />;
    case "g3x3":  return <GridIcon cols={3} rows={3} />;
    case "g4x4":  return <GridIcon cols={4} rows={4} />;
    case "g5x5":  return <GridIcon cols={5} rows={5} />;
    case "g6x6":  return <GridIcon cols={6} rows={6} />;
    case "g8x4":  return <GridIcon cols={8} rows={4} />;
    case "f1p3":  return <IconF1p3 />;
    case "f1p5":  return <IconF1p5 />;
    case "f2p4":  return <IconF2p4 />;
    case "f1p9":  return <IconF1p9 />;
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function LiveView() {
  const camerasQuery = useQuery("live-cameras", () => listCameras({ page_size: 200 }), { refetchInterval: 30000 });
  const serversQuery = useQuery("live-servers", listServers, { refetchInterval: 30000 });
  const cameras = camerasQuery.data?.items ?? [];
  const servers = serversQuery.data ?? [];

  const [layoutId, setLayoutId] = useState<LayoutId>(readStoredLayout);
  const [maximizedCamera, setMaximizedCamera] = useState<Camera | null>(null);
  const [isClosingMaximized, setIsClosingMaximized] = useState(false);
  const [draggedCameraId, setDraggedCameraId] = useState<string | null>(null);
  const [cameraOrder, setCameraOrder] = useState<string[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraVolumes, setCameraVolumes] = useState<Record<string, number>>(readStoredCameraVolumes);
  const [audioPrimedCameraIds, setAudioPrimedCameraIds] = useState<Set<string>>(() => new Set());

  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[2];

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, layoutId);
  }, [layoutId]);

  useEffect(() => {
    setCameraOrder((cur) => {
      const stored = readStoredCameraOrder();
      const base = cur.length ? cur : stored;
      const known = new Set(cameras.map((c) => c.id));
      const kept = base.filter((id) => known.has(id));
      const added = cameras.map((c) => c.id).filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [cameras]);

  useEffect(() => {
    if (cameraOrder.length) localStorage.setItem("openvms.live.cameraOrder.v1", JSON.stringify(cameraOrder));
  }, [cameraOrder]);

  useEffect(() => {
    useCameraStore.getState().setGridCameraFromOrder(cameras, layout.max);
  }, [cameras, layout.max]);

  useEffect(() => {
    localStorage.setItem("openvms.live.cameraVolumes.v1", JSON.stringify(cameraVolumes));
  }, [cameraVolumes]);

  useEffect(() => {
    if (!maximizedCamera) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeMaximized(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximizedCamera]);

  const closePanel = useEventStore((s) => s.closePanel);

  useEffect(() => {
    closePanel();
    return () => { /* panel state persists across route changes */ };
  }, [closePanel]);

  const camerasById = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  const serverIndexesById = useMemo(() => new Map(servers.map((s, i) => [s.id, i])), [servers]);
  const serversById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const orderedCameras = useMemo(
    () => cameraOrder.map((id) => camerasById.get(id)).filter((c): c is Camera => Boolean(c)),
    [cameraOrder, camerasById],
  );
  const onlineCount = useCameraStore((s) => s.onlineCount);
  const totalCount = cameras.length;

  const selectCamera = useCallback((camera: Camera) => {
    setSelectedCameraId(camera.id);
    if (camera.has_audio) {
      setAudioPrimedCameraIds((cur) => {
        if (cur.has(camera.id)) return cur;
        const next = new Set(cur);
        next.add(camera.id);
        return next;
      });
    }
  }, []);

  function openMaximized(camera: Camera) {
    setIsClosingMaximized(false);
    selectCamera(camera);
    setMaximizedCamera(camera);
  }

  function closeMaximized() {
    setIsClosingMaximized(true);
    window.setTimeout(() => { setMaximizedCamera(null); setIsClosingMaximized(false); }, 180);
  }

  function moveCamera(activeId: string, overId: string) {
    if (activeId === overId) return;
    setCameraOrder((cur) => {
      const ai = cur.indexOf(activeId); const oi = cur.indexOf(overId);
      if (ai === -1 || oi === -1) return cur;
      const next = [...cur];
      const [item] = next.splice(ai, 1);
      next.splice(oi, 0, item);
      return next;
    });
  }

  const getCameraVolume = useCallback((id: string) => cameraVolumes[id] ?? 0.7, [cameraVolumes]);
  const updateCameraVolume = useCallback((id: string, v: number) => {
    setCameraVolumes((cur) => ({ ...cur, [id]: clamp(v, 0, 1) }));
  }, []);

  return (
    <div className="space-y-3" onClick={() => { setSelectedCameraId(null); }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="live-layout-group">
          {UNIFORM_LAYOUTS.map((l) => (
            <button key={l.id} className={`vms-layout-btn${layoutId === l.id ? " active" : ""}`}
              title={l.label} onClick={() => setLayoutId(l.id)}>
              <LayoutIcon id={l.id} />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <div className="live-layout-group">
          {FEATURED_LAYOUTS.map((l) => (
            <button key={l.id} className={`vms-layout-btn${layoutId === l.id ? " active" : ""}`}
              title={l.label} onClick={() => setLayoutId(l.id)}>
              <LayoutIcon id={l.id} />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <span className="vms-btn ml-auto cursor-default">
          Cámaras {onlineCount} / {totalCount}
        </span>
      </div>

      {/* Grid */}
      {camerasQuery.isLoading ? (
        <div className="vms-card p-4 text-sm text-[var(--text-2)]">Cargando cámaras...</div>
      ) : camerasQuery.error ? (
        <div className="vms-card p-4 text-sm text-[var(--warn)]">No se pudieron cargar las cámaras.</div>
      ) : orderedCameras.length === 0 ? (
        <div className="vms-card p-4 text-sm text-[var(--text-2)]">No hay cámaras sincronizadas desde Frigate.</div>
      ) : (
        <CameraGrid
          layout={layout}
          cameras={orderedCameras}
          draggedCameraId={draggedCameraId}
          selectedCameraId={selectedCameraId}
          audioPrimedCameraIds={audioPrimedCameraIds}
          serverIndexesById={serverIndexesById}
          serversById={serversById}
          onSelect={selectCamera}
          onMaximize={openMaximized}
          onDragStart={(id) => setDraggedCameraId(id)}
          onDragOver={(id) => { if (draggedCameraId) moveCamera(draggedCameraId, id); }}
          onDragEnd={() => setDraggedCameraId(null)}
          getCameraVolume={getCameraVolume}
          onVolumeChange={updateCameraVolume}
        />
      )}

      {maximizedCamera ? (
        <MaximizedCamera
          camera={maximizedCamera}
          server={serversById.get(maximizedCamera.server_id)}
          serverIndex={serverIndexesById.get(maximizedCamera.server_id) ?? -1}
          isClosing={isClosingMaximized}
          isSelected={selectedCameraId === maximizedCamera.id}
          isAudioPrimed={audioPrimedCameraIds.has(maximizedCamera.id)}
          onSelect={selectCamera}
          volume={getCameraVolume(maximizedCamera.id)}
          onVolumeChange={updateCameraVolume}
          onClose={closeMaximized}
        />
      ) : null}
    </div>
  );
}

// ─── CameraGrid ─────────────────────────────────────────────────────────────────

interface CameraGridProps {
  layout: LayoutDef;
  cameras: Camera[];
  draggedCameraId: string | null;
  selectedCameraId: string | null;
  audioPrimedCameraIds: Set<string>;
  serverIndexesById: Map<string, number>;
  serversById: Map<string, FrigateServer>;
  onSelect: (camera: Camera) => void;
  onMaximize: (camera: Camera) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDragEnd: () => void;
  getCameraVolume: (id: string) => number;
  onVolumeChange: (id: string, v: number) => void;
}

function CameraGrid({
  layout, cameras, draggedCameraId, selectedCameraId, audioPrimedCameraIds,
  serverIndexesById, serversById, onSelect, onMaximize,
  onDragStart, onDragOver, onDragEnd, getCameraVolume, onVolumeChange,
}: CameraGridProps) {
  const isFeatured = layout.rows > 0;

  const gridStyle: CSSProperties = isFeatured
    ? {
        display: "grid",
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        gap: "6px",
        height: "clamp(300px, calc(100vh - 150px), 1100px)",
      }
    : {
        display: "grid",
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gap: "6px",
      };

  function renderTile(camera: Camera, startIndex: number) {
    return (
      <CameraTile
        camera={camera}
        server={serversById.get(camera.server_id)}
        serverIndex={serverIndexesById.get(camera.server_id) ?? -1}
        isDragging={draggedCameraId === camera.id}
        isSelected={selectedCameraId === camera.id}
        isAudioPrimed={audioPrimedCameraIds.has(camera.id)}
        onSelect={onSelect}
        volume={getCameraVolume(camera.id)}
        onVolumeChange={onVolumeChange}
        onMaximize={onMaximize}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        startIndex={startIndex}
      />
    );
  }

  if (isFeatured) {
    return (
      <div style={gridStyle}>
        {layout.slots.map((slot, i) => {
          const camera = cameras[i];
          const itemStyle: CSSProperties = {
            gridColumn: `span ${slot.colSpan}`,
            gridRow: `span ${slot.rowSpan}`,
          };
          if (!camera) {
            return (
              <div key={`empty-${i}`} style={itemStyle}
                className="video-thumb h-full w-full border border-dashed border-[var(--line)] grid place-items-center">
                <span className="text-xs text-[var(--text-3)]">—</span>
              </div>
            );
          }
          return (
            <div key={camera.id} style={itemStyle} className="h-full">
              {renderTile(camera, i)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {cameras.slice(0, layout.max).map((camera, index) => (
        <div key={camera.id} className="aspect-video">
          {renderTile(camera, index)}
        </div>
      ))}
    </div>
  );
}

// ─── CameraTile ─────────────────────────────────────────────────────────────────

const CameraTile = memo(function CameraTile({
  camera, server, serverIndex, isDragging, isSelected, isAudioPrimed,
  onSelect, volume, onVolumeChange, onMaximize, onDragStart, onDragOver, onDragEnd, startIndex,
}: {
  camera: Camera;
  server: FrigateServer | undefined;
  serverIndex: number;
  isDragging: boolean;
  isSelected: boolean;
  isAudioPrimed: boolean;
  onSelect: (camera: Camera) => void;
  volume: number;
  onVolumeChange: (cameraId: string, volume: number) => void;
  onMaximize: (camera: Camera) => void;
  onDragStart: (cameraId: string) => void;
  onDragOver: (cameraId: string) => void;
  onDragEnd: () => void;
  startIndex: number;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ZoomView>(defaultZoomView);
  const [isPanning, setIsPanning] = useState(false);

  useWheelZoom(frameRef, setView, isSelected);
  useEffect(() => setView(defaultZoomView), [camera.id]);

  return (
    <div
      ref={frameRef}
      draggable={view.scale <= 1}
      className={[
        "video-thumb live-tile h-full w-full border transition duration-150",
        view.scale > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-grab active:cursor-grabbing",
        isSelected ? "border-[var(--acc)] ring-2 ring-[rgba(0,208,132,.55)]" : "border-[var(--line)]",
        isDragging ? "scale-[0.98] opacity-55" : "",
      ].join(" ")}
      onClick={(e) => { e.stopPropagation(); onSelect(camera); }}
      onMouseDown={(e) => handlePanStart(e, frameRef, view, setView, setIsPanning, isSelected)}
      onDoubleClick={(e) => { if (isLiveControlTarget(e.target)) return; onMaximize(camera); }}
      onDragStart={(e) => {
        if (view.scale > 1) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", camera.id);
        onDragStart(camera.id);
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(camera.id); }}
      onDrop={(e) => { e.preventDefault(); onDragEnd(); }}
      onDragEnd={onDragEnd}
      title="Click para activar zoom, doble click para maximizar"
    >
      <LiveStream
        camera={camera} server={server} view={view} mode="preview"
        audioEnabled={isSelected} audioPrimed={isAudioPrimed} volume={volume}
        startIndex={startIndex}
      />
      <CameraOverlay
        camera={camera} server={server} serverIndex={serverIndex}
        zoom={view.scale} audioEnabled={isSelected} volume={volume}
        onSelect={onSelect} onVolumeChange={onVolumeChange}
      />
    </div>
  );
});

// ─── MaximizedCamera ────────────────────────────────────────────────────────────

function MaximizedCamera({
  camera, server, serverIndex, isClosing, isSelected, isAudioPrimed,
  onSelect, volume, onVolumeChange, onClose,
}: {
  camera: Camera;
  server: FrigateServer | undefined;
  serverIndex: number;
  isClosing: boolean;
  isSelected: boolean;
  isAudioPrimed: boolean;
  onSelect: (camera: Camera) => void;
  volume: number;
  onVolumeChange: (cameraId: string, volume: number) => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ZoomView>(defaultZoomView);
  const [isPanning, setIsPanning] = useState(false);

  useWheelZoom(frameRef, setView, isSelected);
  useEffect(() => setView(defaultZoomView), [camera.id]);

  return (
    <div className={`live-max-overlay fixed inset-0 z-50 bg-black/95 p-3 md:p-5 ${isClosing ? "closing" : ""}`}>
      <div
        ref={frameRef}
        className={[
          "video-thumb live-max-frame h-full w-full border border-[var(--acc)] ring-2 ring-[rgba(0,208,132,.55)]",
          view.scale > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "",
        ].join(" ")}
        onClick={(e) => { e.stopPropagation(); onSelect(camera); }}
        onMouseDown={(e) => handlePanStart(e, frameRef, view, setView, setIsPanning, isSelected)}
        onDoubleClick={(e) => { if (isLiveControlTarget(e.target)) return; onClose(); }}
      >
        <LiveStream
          camera={camera} server={server} view={view} mode="maximized"
          audioEnabled={isSelected} audioPrimed={isAudioPrimed} volume={volume}
        />
        <CameraOverlay
          camera={camera} server={server} serverIndex={serverIndex}
          zoom={view.scale} audioEnabled={isSelected} volume={volume}
          onSelect={onSelect} onVolumeChange={onVolumeChange}
        />
      </div>
    </div>
  );
}

// ─── CameraOverlay ──────────────────────────────────────────────────────────────

function CameraOverlay({
  camera, server, serverIndex, zoom, audioEnabled, volume, onSelect, onVolumeChange,
}: {
  camera: Camera;
  server: FrigateServer | undefined;
  serverIndex: number;
  zoom: number;
  audioEnabled: boolean;
  volume: number;
  onSelect: (camera: Camera) => void;
  onVolumeChange: (cameraId: string, volume: number) => void;
}) {
  const lastDetection = useEventStore((s) => s.lastDetection);
  const events = useEventStore((s) => s.events);
  const detection = lastDetection[camera.id] ?? lastDetection[camera.frigate_name ?? ""] ?? lastDetection[camera.name ?? ""] ?? null;
  const abandoned = useMemo(
    () => events.find((ev) => (
      ev.plugin === "abandoned_object"
      && (ev.camera_id === camera.id || ev.camera_id === camera.frigate_name || ev.camera_name === camera.frigate_name || ev.camera_name === camera.name)
      && Date.now() - new Date(ev.timestamp).getTime() < 120_000
    )),
    [events, camera.id, camera.frigate_name, camera.name],
  );

  return (
    <>
      <div className="absolute left-2 top-2 z-20 flex max-w-[calc(100%-9rem)] items-center gap-1.5" data-live-control="true">
        <span className={`srvchip ${serverClass(serverIndex)} !px-1.5`} title={server?.display_name ?? "sin servidor"}>
          <span className="sw" />
        </span>
        <span className="mono truncate rounded bg-black/60 px-1.5 py-px text-[10px] text-white">{camera.display_name}</span>
      </div>
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1" data-live-control="true">
        {detection ? (
          <span
            title={detection.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              color: detection.color,
              opacity: 0.8,
            }}
          >
            <svg viewBox="0 0 24 24" fill={detection.color} width="11" height="11">
              <path d={detection.icon} />
            </svg>
          </span>
        ) : null}
        {camera.enabled ? (
          <span className="live-icon-chip rec" title="Grabando">●</span>
        ) : null}
        {zoom > 1 ? (
          <span className="live-icon-chip" title={`Zoom ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}</span>
        ) : null}
      </div>
      {camera.has_audio ? (
        <div
          data-live-control="true"
          className={`live-volume-control ${audioEnabled ? "active" : ""}`}
          title={audioEnabled ? `Volumen ${Math.round(volume * 100)}%` : "Click para activar audio"}
          onClick={(e) => { e.stopPropagation(); onSelect(camera); }}
          onDoubleClick={stopLiveControlEvent}
          onMouseDown={stopLiveControlEvent}
          onPointerDown={stopLiveControlEvent}
          onWheel={stopLiveControlWheel}
        >
          <span className="live-icon-chip" aria-hidden="true">{volume === 0 ? "🔇" : "🔊"}</span>
          <input
            aria-label={`Volumen ${camera.display_name}`}
            type="range" min="0" max="100" value={Math.round(volume * 100)}
            onChange={(e) => { onSelect(camera); onVolumeChange(camera.id, Number(e.target.value) / 100); }}
          />
        </div>
      ) : null}
      {abandoned ? <AbandonedObjectOverlay event={abandoned} /> : null}
    </>
  );
}

function AbandonedObjectOverlay({ event }: { event: ReturnType<typeof useEventStore.getState>["events"][number] }) {
  const data = event.data ?? {};
  const bbox = (data.bbox ?? (data.overlay as Record<string, unknown> | undefined)?.object_bbox) as Record<string, unknown> | undefined;
  const state = String(data.state ?? event.label).replaceAll("_", " ");
  const obj = String(data.object_type ?? "objeto");
  const zone = String(data.zone ?? "default");
  const countdown = Number(data.countdown_seconds ?? 0);
  const unattended = Number(data.unattended_seconds ?? 0);
  const color = abandonedColor(String(data.state ?? event.label), String(event.severity ?? data.severity ?? "low"));

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {bbox ? <BboxBox bbox={bbox} color={color} /> : null}
      <div
        className="absolute bottom-2 right-2 max-w-[78%] rounded-md border bg-black/75 px-2.5 py-2 shadow-lg backdrop-blur"
        style={{ borderColor: color }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="truncate text-[11px] font-semibold uppercase text-white">{state}</span>
          {countdown > 0 ? <span className="mono text-[10px] text-white/80">{countdown}s</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-white/75">
          <span>{obj}</span>
          <span>{zone}</span>
          {unattended > 0 ? <span className="mono">{unattended}s sin dueño</span> : null}
        </div>
      </div>
    </div>
  );
}

function BboxBox({ bbox, color }: { bbox: Record<string, unknown>; color: string }) {
  const x1 = Number(bbox.x1 ?? 0);
  const y1 = Number(bbox.y1 ?? 0);
  const x2 = Number(bbox.x2 ?? 0);
  const y2 = Number(bbox.y2 ?? 0);
  const widthGuess = Math.max(x2, 640);
  const heightGuess = Math.max(y2, 480);
  const style: CSSProperties = {
    left: `${clamp((x1 / widthGuess) * 100, 0, 100)}%`,
    top: `${clamp((y1 / heightGuess) * 100, 0, 100)}%`,
    width: `${clamp(((x2 - x1) / widthGuess) * 100, 1, 100)}%`,
    height: `${clamp(((y2 - y1) / heightGuess) * 100, 1, 100)}%`,
    borderColor: color,
    boxShadow: `0 0 0 1px ${color}55, 0 0 18px ${color}66`,
  };
  return <div className="absolute rounded-sm border-2" style={style} />;
}

function abandonedColor(state: string, severity: string) {
  const s = state.toLowerCase();
  if (s.includes("confirmed") || severity === "critical" || severity === "high") return "#ef4444";
  if (s.includes("pending")) return "#f97316";
  if (s.includes("static") || s.includes("suspicious")) return "#eab308";
  if (s.includes("cleared") || s.includes("owner")) return "#22c55e";
  return "#5b9dff";
}

// ─── LiveStream ─────────────────────────────────────────────────────────────────

const STREAM_BATCH_SIZE = 6;
const STREAM_BATCH_DELAY_MS = 350;

function LiveStream({
  camera, server, view, mode, audioEnabled, audioPrimed, volume, startIndex = 0,
}: {
  camera: Camera;
  server: FrigateServer | undefined;
  view: ZoomView;
  mode: "preview" | "maximized";
  audioEnabled: boolean;
  audioPrimed: boolean;
  volume: number;
  startIndex?: number;
}) {
  const setCameraStatus = useCameraStore((s) => s.setCameraStatus);
  const clearCameraStatus = useCameraStore((s) => s.clearCameraStatus);
  const updateOnlineCount = useCameraStore((s) => s.updateOnlineCount);

  const activeStream = streamNameForMode(camera, mode);
  const mediaMode = camera.has_audio && audioPrimed ? "video,audio" : "video";
  const streamUrl = `/stream.html?${new URLSearchParams({ src: activeStream, mode: "mse", media: mediaMode }).toString()}`;

  const savedStatus = useCameraStore((s) => s.cameraStatuses[camera.id]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "online" | "offline">(
    savedStatus === "online" ? "online" : savedStatus === "offline" ? "offline" : "connecting",
  );
  const [attempt, setAttempt] = useState(0);

  const wasOnline = savedStatus === "online";

  const [mounted, setMounted] = useState(startIndex < STREAM_BATCH_SIZE);
  useEffect(() => {
    if (mounted) return;
    const delay = Math.floor(startIndex / STREAM_BATCH_SIZE) * STREAM_BATCH_DELAY_MS;
    const t = window.setTimeout(() => setMounted(true), delay);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connectionState !== "offline") return;
    const t = window.setTimeout(() => { setConnectionState("connecting"); setAttempt((v) => v + 1); }, 30_000);
    return () => window.clearTimeout(t);
  }, [connectionState, attempt]);

  useEffect(() => {
    if (savedStatus === "online") return;
    setConnectionState(savedStatus === "offline" ? "offline" : "connecting");
    setAttempt(0);
  }, [activeStream]);

  useEffect(() => {
    if (savedStatus === "online") setConnectionState("online");
  }, [savedStatus]);

  useEffect(() => {
    if (!wasOnline || connectionState !== "online") return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const check = () => {
      try {
        const { video } = getGo2rtcPlayerState(iframe);
        if (!video || video.readyState < 2 || video.videoWidth === 0) {
          setConnectionState("connecting");
        }
      } catch { setConnectionState("connecting"); }
    };
    const interval = window.setInterval(check, 3000);
    return () => window.clearInterval(interval);
  }, [wasOnline, connectionState]);

  useEffect(() => {
    if (!mounted || connectionState !== "connecting") return;
    // Do NOT check iframeRef.current here — when the component first mounts,
    // server may not be loaded yet (early return path), so the iframe isn't in
    // the DOM yet. The ref is accessed lazily inside monitor() instead, so the
    // interval keeps running until the iframe appears (within the first 4s).
    let checks = 0;
    let lastTime = -1;
    let stableTicks = 0;
    let mountTime = Date.now();

    const monitor = () => {
      if (Date.now() - mountTime < 2000) return;
      checks += 1;
      try {
        const iframe = iframeRef.current;
        if (iframe) {
          const { video, mode, error } = getGo2rtcPlayerState(iframe);
          patchGo2rtcPlayerChrome(iframe);
          if (!error && mode && ["MSE", "RTC", "HLS", "MP4", "MJPEG"].includes(mode)) {
            setConnectionState("online");
            return;
          }
          if (video) {
            // Force play if paused (autoplay may have been delayed)
            if (video.paused && video.readyState >= 1) {
              video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
            }
            if (video.readyState >= 2) {
              const hasDims = video.videoWidth > 0 || video.videoHeight > 0;
              // lastTime starts at -1 so currentTime !== lastTime is always true
              // on the first check (even when currentTime = 0 for a live stream).
              const moving = video.currentTime !== lastTime;
              if (moving || hasDims) { lastTime = video.currentTime; stableTicks = 0; setConnectionState("online"); return; }
              stableTicks += 1;
            }
          }
        }
      } catch { /* same-origin defensive */ }
      if (checks >= 160 || stableTicks >= 16) setConnectionState("offline");
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = window.setTimeout(() => {
      monitor();
      intervalId = window.setInterval(monitor, 500);
    }, 2000);
    return () => { window.clearTimeout(timeoutId); if (intervalId) window.clearInterval(intervalId); };
  }, [mounted, audioEnabled, attempt, connectionState, streamUrl, volume]);

  useEffect(() => {
    if (connectionState !== "online") return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const apply = () => {
      try {
        const { video } = getGo2rtcPlayerState(iframe);
        patchGo2rtcPlayerChrome(iframe);
        if (video) { video.muted = !audioEnabled; video.volume = audioEnabled ? volume : 0; }
      } catch { /* same-origin defensive */ }
    };
    apply();
    const interval = window.setInterval(apply, 2000);
    return () => window.clearInterval(interval);
  }, [audioEnabled, connectionState, streamUrl, volume]);

  useEffect(() => {
    setCameraStatus(camera.id, connectionState);
    if (connectionState === "online" || connectionState === "offline") updateOnlineCount();
  }, [connectionState, camera.id, setCameraStatus]);

  useEffect(() => {
    if (connectionState === "connecting") setCameraStatus(camera.id, "connecting");
    return () => clearCameraStatus(camera.id);
  }, [camera.id, clearCameraStatus]);

  if (!server?.url) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-[rgba(23,92,160,.28)] text-center">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgba(91,157,255,.45)] bg-[rgba(8,16,30,.88)] px-8 py-6 shadow-xl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-[var(--text-3)] opacity-60">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold text-white">Cámara no configurada</div>
            <div className="mono text-xs text-[var(--text-2)]">Sin servidor asociado</div>
          </div>
        </div>
      </div>
    );
  }

  if (!mounted) {
    return <div className="absolute inset-0 bg-black" />;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 will-change-transform"
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
    >
      {connectionState === "online" ? (
        <iframe
          ref={iframeRef}
          key={`${activeStream}-${mediaMode}-${attempt}`}
          title={camera.display_name}
          src={streamUrl}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; microphone"
        />
      ) : (
        <iframe
          ref={iframeRef}
          key={`${activeStream}-${mediaMode}-${attempt}`}
          title={camera.display_name}
          src={streamUrl}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; microphone"
        />
      )}
      {connectionState !== "online" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
          <div className="relative flex flex-col items-center gap-3 rounded-xl border border-[rgba(91,157,255,.45)] bg-[rgba(8,16,30,.88)] px-8 py-6 shadow-xl overflow-hidden">
            <div className="w-full" style={{ aspectRatio: "16/9" }}>
              <svg viewBox="0 0 8 5" className="w-full h-full" preserveAspectRatio="none">
                <rect x="0"   y="0" width="1"   height="2" fill="#FFFFFF" />
                <rect x="1"   y="0" width="1"   height="2" fill="#FFFF00" />
                <rect x="2"   y="0" width="1"   height="2" fill="#00FFFF" />
                <rect x="3"   y="0" width="1"   height="2" fill="#00FF00" />
                <rect x="4"   y="0" width="1"   height="2" fill="#FF00FF" />
                <rect x="5"   y="0" width="1"   height="2" fill="#FF0000" />
                <rect x="6"   y="0" width="1"   height="2" fill="#0000FF" />
                <rect x="7"   y="0" width="1"   height="2" fill="#000000" />
                <rect x="0"   y="2" width="1"   height="1" fill="#FFFFFF" />
                <rect x="1"   y="2" width="1"   height="1" fill="#FFFF00" />
                <rect x="2"   y="2" width="1"   height="1" fill="#00FFFF" />
                <rect x="3"   y="2" width="1"   height="1" fill="#00FF00" />
                <rect x="4"   y="2" width="1"   height="1" fill="#FF00FF" />
                <rect x="5"   y="2" width="1"   height="1" fill="#FF0000" />
                <rect x="6"   y="2" width="1"   height="1" fill="#0000FF" />
                <rect x="7"   y="2" width="1"   height="1" fill="#000000" />
                <rect x="0"   y="3" width="8"   height="0.5" fill="#000000" />
                <rect x="0"   y="3.5" width="1" height="1.5" fill="#000000" />
                <rect x="1"   y="3.5" width="1" height="1.5" fill="#808080" />
                <rect x="2"   y="3.5" width="1" height="1.5" fill="#808080" />
                <rect x="3"   y="3.5" width="1" height="1.5" fill="#FFFFFF" />
                <rect x="4"   y="3.5" width="1" height="1.5" fill="#808080" />
                <rect x="5"   y="3.5" width="1" height="1.5" fill="#808080" />
                <rect x="6"   y="3.5" width="1" height="1.5" fill="#808080" />
                <rect x="7"   y="3.5" width="1" height="1.5" fill="#808080" />
              </svg>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold text-white">{camera.display_name}</div>
              <div className="mono text-xs text-[var(--text-2)]">{camera.frigate_name} · {connectionState === "connecting" ? "conectando..." : "offline · reintento automático"}</div>
            </div>
          </div>
        </div>
      )}
      <span className="live-icon-chip absolute bottom-2 left-2" title={mode === "maximized" ? "Stream principal" : "Substream"}>
        {mode === "maximized" ? "M" : "S"}
      </span>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function patchGo2rtcPlayerChrome(iframe: HTMLIFrameElement) {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.head) return;
    if (!doc.getElementById("openvms-go2rtc-clean")) {
      const style = doc.createElement("style");
      style.id = "openvms-go2rtc-clean";
      style.textContent = `
        html, body { margin: 0 !important; overflow: hidden !important; background: #000 !important; }
        video, canvas { display: block !important; width: 100vw !important; height: 100vh !important; object-fit: cover !important; pointer-events: none !important; }
        body > *:not(video):not(canvas):not(video-stream):not(media-stream),
        video-stream > *:not(video):not(canvas), media-stream > *:not(video):not(canvas),
        [class*="control"], [class*="toolbar"], [class*="button"], [class*="menu"],
        button, label, select { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
      `;
      doc.head.appendChild(style);
    }
    doc.querySelectorAll("button, label, select, [class*='control'], [class*='toolbar'], [class*='button'], [class*='menu']").forEach((el) => {
      if (el instanceof HTMLElement) el.style.display = "none";
    });
  } catch { /* same-origin defensive */ }
}

function getGo2rtcPlayerState(iframe: HTMLIFrameElement): {
  video: HTMLVideoElement | null;
  mode: string;
  error: string;
} {
  const doc = iframe.contentDocument;
  if (!doc) return { video: null, mode: "", error: "" };

  const video = doc.querySelector("video");
  const mode = doc.querySelector(".mode")?.textContent?.trim().toUpperCase() ?? "";
  const error = doc.querySelector(".status")?.textContent?.trim() ?? "";

  return { video, mode, error };
}

type ZoomView = { scale: number; x: number; y: number };
const defaultZoomView: ZoomView = { scale: 1, x: 0, y: 0 };

function useWheelZoom(frameRef: RefObject<HTMLDivElement>, setView: Dispatch<SetStateAction<ZoomView>>, enabled: boolean) {
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !enabled) return;
    const cur = frame;

    function onWheel(e: WheelEvent) {
      if (isLiveControlTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = cur.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const dir = e.deltaY < 0 ? 1 : -1;
      setView((v) => {
        const next = clamp(Number((v.scale + dir * 0.2).toFixed(2)), 1, 5);
        if (next === v.scale) return v;
        if (next === 1) return defaultZoomView;
        const ratio = next / v.scale;
        return clampZoomView({ scale: next, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio }, rect);
      });
    }

    cur.addEventListener("wheel", onWheel, { passive: false });
    return () => cur.removeEventListener("wheel", onWheel);
  }, [enabled, frameRef, setView]);
}

function handlePanStart(
  e: MouseEvent<HTMLDivElement>,
  frameRef: RefObject<HTMLDivElement>,
  view: ZoomView,
  setView: Dispatch<SetStateAction<ZoomView>>,
  setIsPanning: (v: boolean) => void,
  enabled: boolean,
) {
  if (isLiveControlTarget(e.target)) return;
  if (!enabled || view.scale <= 1 || e.button !== 0) return;
  const frame = frameRef.current;
  if (!frame) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = frame.getBoundingClientRect();
  const sx = e.clientX; const sy = e.clientY; const sv = view;
  setIsPanning(true);

  function onMove(me: globalThis.MouseEvent) {
    me.preventDefault();
    setView(clampZoomView({ ...sv, x: sv.x + me.clientX - sx, y: sv.y + me.clientY - sy }, rect));
  }
  function onUp() {
    setIsPanning(false);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function isLiveControlTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-live-control='true']"));
}

function stopLiveControlEvent(e: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) { e.stopPropagation(); }
function stopLiveControlWheel(e: ReactWheelEvent<HTMLElement>) { e.stopPropagation(); }

function clampZoomView(view: ZoomView, rect: DOMRect) {
  const mx = (rect.width * (view.scale - 1)) / 2;
  const my = (rect.height * (view.scale - 1)) / 2;
  return { scale: view.scale, x: clamp(view.x, -mx, mx), y: clamp(view.y, -my, my) };
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function serverClass(i: number) { return (["a", "b", "c"] as const)[i >= 0 ? i % 3 : 0]; }
function streamNameForMode(camera: Camera, mode: "preview" | "maximized") {
  return `${camera.frigate_name}_${mode === "maximized" ? "main" : "sub"}`;
}

function readStoredCameraOrder(): string[] {
  try {
    const v = localStorage.getItem("openvms.live.cameraOrder.v1");
    if (!v) return [];
    const p = JSON.parse(v);
    return Array.isArray(p) && p.every((x) => typeof x === "string") ? p : [];
  } catch { return []; }
}

function readStoredCameraVolumes(): Record<string, number> {
  try {
    const v = localStorage.getItem("openvms.live.cameraVolumes.v1");
    if (!v) return {};
    const p = JSON.parse(v);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    return Object.fromEntries(
      Object.entries(p)
        .filter((e): e is [string, number] => typeof e[0] === "string" && typeof e[1] === "number")
        .map(([id, vol]) => [id, clamp(vol, 0, 1)]),
    );
  } catch { return {}; }
}
