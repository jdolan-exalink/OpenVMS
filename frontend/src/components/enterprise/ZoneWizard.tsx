import { useCallback, useEffect, useRef, useState } from "react";

export interface ZonePoint {
  x: number;
  y: number;
}

export interface ZoneConfig {
  name: string;
  points: ZonePoint[];
  color: string;
}

interface ZoneWizardProps {
  imageWidth: number;
  imageHeight: number;
  existingZones?: ZoneConfig[];
  onZonesChange?: (zones: ZoneConfig[]) => void;
  onZoneSelect?: (zone: ZoneConfig | null) => void;
}

const ZONE_COLORS = [
  "#00d084",
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
  "#95e1d3",
  "#f38181",
  "#aa96da",
  "#fcbad3",
];

export default function ZoneWizard({
  imageWidth,
  imageHeight,
  existingZones = [],
  onZonesChange,
  onZoneSelect,
}: ZoneWizardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zones, setZones] = useState<ZoneConfig[]>(existingZones);
  const [currentPoints, setCurrentPoints] = useState<ZonePoint[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);

  const colorIndex = useRef(zones.length % ZONE_COLORS.length);

  useEffect(() => {
    setZones(existingZones);
    colorIndex.current = existingZones.length % ZONE_COLORS.length;
  }, [existingZones]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    zones.forEach((zone, index) => {
      if (zone.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      const firstPoint = zone.points[0];
      ctx.moveTo(firstPoint.x, firstPoint.y);

      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x, zone.points[i].y);
      }

      if (index === selectedZoneIndex) {
        ctx.closePath();
        ctx.fillStyle = zone.color + "33";
        ctx.fill();
      }

      ctx.stroke();

      zone.points.forEach((point, pointIndex) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, pointIndex === 0 ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = index === selectedZoneIndex ? zone.color : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      if (zone.points.length > 0 && zone.name) {
        const centroid = calculateCentroid(zone.points);
        ctx.font = "12px sans-serif";
        ctx.fillStyle = zone.color;
        ctx.fillText(zone.name, centroid.x + 10, centroid.y);
      }
    });

    if (currentPoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      const firstPoint = currentPoints[0];
      ctx.moveTo(firstPoint.x, firstPoint.y);

      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
      }

      ctx.stroke();

      currentPoints.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, index === 0 ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
      });
    }
  }, [zones, currentPoints, selectedZoneIndex]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  function calculateCentroid(points: ZonePoint[]): ZonePoint {
    const sum = points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  function getCanvasPoint(e: React.MouseEvent<HTMLCanvasElement>): ZonePoint {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(e);

    if (e.shiftKey && currentPoints.length > 0) {
      finishZone();
      return;
    }

    if (isDrawing) {
      setCurrentPoints((prev) => [...prev, point]);
    } else {
      const clickedZoneIndex = findZoneAtPoint(point);
      if (clickedZoneIndex !== null) {
        setSelectedZoneIndex(clickedZoneIndex);
        onZoneSelect?.(zones[clickedZoneIndex]);
      } else {
        setSelectedZoneIndex(null);
        onZoneSelect?.(null);
      }
    }
  }

  function handleCanvasDoubleClick(_e: React.MouseEvent<HTMLCanvasElement>) {
    if (isDrawing && currentPoints.length >= 3) {
      finishZone();
    }
  }

  function findZoneAtPoint(point: ZonePoint): number | null {
    for (let i = zones.length - 1; i >= 0; i--) {
      const zone = zones[i];
      if (isPointInPolygon(point, zone.points)) {
        return i;
      }
    }
    return null;
  }

  function isPointInPolygon(point: ZonePoint, polygon: ZonePoint[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function startDrawing() {
    setIsDrawing(true);
    setCurrentPoints([]);
    setSelectedZoneIndex(null);
    onZoneSelect?.(null);
  }

  function cancelDrawing() {
    setIsDrawing(false);
    setCurrentPoints([]);
  }

  function finishZone() {
    if (currentPoints.length < 3) {
      return;
    }

    const color = ZONE_COLORS[colorIndex.current % ZONE_COLORS.length];
    colorIndex.current++;

    const newZone: ZoneConfig = {
      name: zoneName || `Zona ${zones.length + 1}`,
      points: [...currentPoints],
      color,
    };

    const newZones = [...zones, newZone];
    setZones(newZones);
    onZonesChange?.(newZones);

    setIsDrawing(false);
    setCurrentPoints([]);
    setZoneName("");
    setShowNameInput(false);
  }

  function deleteSelectedZone() {
    if (selectedZoneIndex === null) return;

    const newZones = zones.filter((_, i) => i !== selectedZoneIndex);
    setZones(newZones);
    onZonesChange?.(newZones);
    setSelectedZoneIndex(null);
    onZoneSelect?.(null);
  }

  function clearAllZones() {
    setZones([]);
    onZonesChange?.([]);
    setSelectedZoneIndex(null);
    onZoneSelect?.(null);
  }

  function undoLastPoint() {
    if (currentPoints.length > 0) {
      setCurrentPoints((prev) => prev.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isDrawing ? (
          <button onClick={startDrawing} className="vms-btn primary">
            ➕ Crear Zona
          </button>
        ) : (
          <>
            <button onClick={cancelDrawing} className="vms-btn !text-[var(--warn)]">
              ✕ Cancelar
            </button>
            <button
              onClick={undoLastPoint}
              disabled={currentPoints.length === 0}
              className="vms-btn"
            >
              ↶ Deshacer
            </button>
            {currentPoints.length >= 3 && !showNameInput && (
              <button onClick={() => setShowNameInput(true)} className="vms-btn primary">
                ✓ Finalizar Zona
              </button>
            )}
          </>
        )}

        {selectedZoneIndex !== null && !isDrawing && (
          <button onClick={deleteSelectedZone} className="vms-btn !text-[var(--warn)]">
            🗑️ Eliminar Zona
          </button>
        )}

        {zones.length > 0 && !isDrawing && (
          <button onClick={clearAllZones} className="vms-btn ml-auto !text-[var(--warn)]">
            Limpiar Todo
          </button>
        )}
      </div>

      {showNameInput && (
        <div className="flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg-2)] p-2">
          <input
            type="text"
            value={zoneName}
            onChange={(e) => setZoneName(e.target.value)}
            placeholder={`Zona ${zones.length + 1}`}
            className="flex-1 rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 text-xs text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
          />
          <button onClick={finishZone} className="vms-btn primary">
            Crear
          </button>
        </div>
      )}

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={imageWidth}
          height={imageHeight}
          className="w-full rounded border border-[var(--line)]"
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          style={{ cursor: isDrawing ? "crosshair" : "pointer" }}
        />

        {isDrawing && (
          <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
            Click para añadir puntos{currentPoints.length >= 3 && " • Doble click o Shift+Click para finalizar"}
          </div>
        )}
      </div>

      {zones.length > 0 && (
        <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-1)]">
            Zonas ({zones.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {zones.map((zone, index) => (
              <button
                key={index}
                onClick={() => {
                  setSelectedZoneIndex(index);
                  onZoneSelect?.(zone);
                }}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] transition ${
                  selectedZoneIndex === index
                    ? "bg-[var(--acc)] text-white"
                    : "bg-[var(--bg-3)] text-[var(--text-1)] hover:bg-[var(--bg-4)]"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: zone.color }}
                />
                {zone.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-2">
        <div className="mb-1 text-xs font-semibold text-[var(--text-1)]">Formato de exportación</div>
        <pre className="mono overflow-x-auto text-[10px] text-[var(--text-2)]">
          {JSON.stringify(
            zones.map((z) => ({
              name: z.name,
              polygon: z.points,
            })),
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}