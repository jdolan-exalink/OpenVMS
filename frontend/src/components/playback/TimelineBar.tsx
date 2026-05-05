import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VmsEvent } from "../../api/events";
import { RecordingSegment } from "../../api/recordings";
import { Camera } from "../../api/cameras";

const CAMERA_COLORS = ["#00D084", "#5B97FF", "#F59E0B", "#A855F7"];

export type CameraSegments = {
  camera: Camera;
  segments: RecordingSegment[];
};

type VisualSegment = {
  id: string;
  start_time: number;
  end_time: number;
  motion: number | null;
};

interface TimelineBarProps {
  rangeStart: number;
  rangeEnd: number;
  viewStart: number;
  viewEnd: number;
  cameraSegments: CameraSegments[];
  events: VmsEvent[];
  currentTime: number;
  isLoading?: boolean;
  onSeek: (t: number) => void;
  onViewportChange: (start: number, end: number) => void;
}

function fmtTime(unix: number) {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtClock(unix: number) {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function posOf(t: number, rangeStart: number, rangeEnd: number) {
  return ((t - rangeStart) / (rangeEnd - rangeStart)) * 100;
}

export default function TimelineBar({
  rangeStart, rangeEnd, viewStart, viewEnd, cameraSegments, events, currentTime, isLoading = false, onSeek, onViewportChange,
}: TimelineBarProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const duration = viewEnd - viewStart;

  const timeFromEvent = useCallback((clientX: number) => {
    const rail = railRef.current;
    if (!rail) return null;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStart + ratio * duration;
  }, [viewStart, duration]);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const t = timeFromEvent(e.clientX);
    if (t !== null) onSeek(t);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const t = timeFromEvent(e.clientX);
      if (t !== null) onSeek(t);
    }
    function onUp() { setDragging(false); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, timeFromEvent, onSeek]);

  function clampViewport(start: number, end: number) {
    const minSpan = 5 * 60;
    const maxSpan = rangeEnd - rangeStart;
    let span = Math.max(minSpan, Math.min(maxSpan, end - start));
    let nextStart = start;
    let nextEnd = start + span;
    if (nextStart < rangeStart) {
      nextStart = rangeStart;
      nextEnd = nextStart + span;
    }
    if (nextEnd > rangeEnd) {
      nextEnd = rangeEnd;
      nextStart = nextEnd - span;
    }
    onViewportChange(nextStart, nextEnd);
  }

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const t = timeFromEvent(e.clientX) ?? (viewStart + duration / 2);
      if (e.shiftKey) {
        const pan = (e.deltaY || e.deltaX) * duration / 900;
        clampViewport(viewStart + pan, viewEnd + pan);
        return;
      }
      const factor = e.deltaY > 0 ? 1.22 : 0.82;
      const nextSpan = duration * factor;
      const leftRatio = (t - viewStart) / duration;
      const nextStart = t - nextSpan * leftRatio;
      clampViewport(nextStart, nextStart + nextSpan);
    }

    timeline.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => timeline.removeEventListener("wheel", onWheel, { capture: true });
  }, [duration, rangeEnd, rangeStart, timeFromEvent, viewEnd, viewStart, onViewportChange]);

  function zoom(factor: number) {
    const mid = currentTime >= viewStart && currentTime <= viewEnd ? currentTime : viewStart + duration / 2;
    const nextSpan = duration * factor;
    clampViewport(mid - nextSpan / 2, mid + nextSpan / 2);
  }

  const spanHours = duration / 3600;
  const tickStep = spanHours > 18 ? 2 : spanHours > 8 ? 1 : spanHours > 2 ? 0.5 : 1 / 6;
  const firstTick = Math.ceil(viewStart / (tickStep * 3600)) * tickStep * 3600;
  const ticks = Array.from(
    { length: Math.max(0, Math.floor((viewEnd - firstTick) / (tickStep * 3600)) + 1) },
    (_, i) => firstTick + i * tickStep * 3600,
  );
  const playheadPct = posOf(currentTime, viewStart, viewEnd);
  const motionEvents = useMemo(
    () => events.filter((event) => {
      const unix = new Date(event.start_time).getTime() / 1000;
      return event.label.toLowerCase().includes("motion") && unix >= viewStart && unix <= viewEnd;
    }),
    [events, viewEnd, viewStart],
  );
  const visualSegmentsByCamera = useMemo(
    () => new Map(cameraSegments.map(({ camera, segments }) => [
      camera.id,
      compactSegments(segments, viewStart, viewEnd, duration),
    ])),
    [cameraSegments, duration, viewEnd, viewStart],
  );
  const visibleMotionEvents = useMemo(
    () => sampleEvents(motionEvents, duration > 6 * 3600 ? 220 : 700),
    [duration, motionEvents],
  );

  return (
    <div
      ref={timelineRef}
      className="vms-card p-3 select-none"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-1)]">Timeline</span>
        <span className="mono text-[11px] text-[var(--text-3)]">
          {fmtTime(viewStart)} - {fmtTime(viewEnd)}
        </span>
        <span className="vms-pill warn">{motionEvents.length} movimientos</span>
        {isLoading && <span className="vms-pill info">actualizando día</span>}
        <span className="ml-auto" />
        <button type="button" className="vms-btn !h-7 !px-2" onClick={() => zoom(0.55)} title="Acercar">+</button>
        <button type="button" className="vms-btn !h-7 !px-2" onClick={() => zoom(1.8)} title="Alejar">-</button>
        <button type="button" className="vms-btn !h-7 !px-2" onClick={() => onViewportChange(rangeStart, rangeEnd)}>
          Día
        </button>
      </div>

      <div
        ref={railRef}
        className={`relative rounded border border-[var(--line)] bg-[var(--bg-2)] p-2 ${dragging ? "cursor-grabbing" : "cursor-crosshair"}`}
        onMouseDown={handleMouseDown}
      >
        <div className="relative mb-2 h-5">
          {ticks.map((tick) => {
            const pct = posOf(tick, viewStart, viewEnd);
            if (pct < 0 || pct > 100) return null;
          return (
            <span
              key={tick}
              className="mono absolute -translate-x-1/2 text-[10px] text-[var(--text-3)]"
              style={{ left: `${pct}%` }}
            >
              {fmtTime(tick)}
            </span>
          );
        })}
        </div>

        {ticks.map((tick) => {
          const pct = posOf(tick, viewStart, viewEnd);
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={`grid-${tick}`}
              className="pointer-events-none absolute bottom-2 top-7 w-px bg-[var(--line)]"
              style={{ left: `${pct}%` }}
            />
          );
        })}

        <div className="space-y-1.5">
          {cameraSegments.map(({ camera }, ci) => {
            const visualSegments = visualSegmentsByCamera.get(camera.id) ?? [];
            const cameraMotionEvents = visibleMotionEvents.filter((ev) => ev.camera_id === camera.id);
            return (
              <div key={camera.id} className="grid grid-cols-[138px_minmax(0,1fr)] items-center gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CAMERA_COLORS[ci % CAMERA_COLORS.length] }} />
                  <span className="truncate text-[11px] text-[var(--text-1)]">{camera.display_name}</span>
                </div>
                <div className="relative h-8 rounded bg-[var(--bg-3)]">
                  {visualSegments.map((seg) => {
                    const segStart = Math.max(seg.start_time, viewStart);
                    const segEnd = Math.min(seg.end_time, viewEnd);
                    const left = posOf(segStart, viewStart, viewEnd);
                    const width = posOf(segEnd, viewStart, viewEnd) - left;
                    if (width <= 0) return null;
                    return (
                      <div
                        key={`${camera.id}-${seg.id}`}
                        className="absolute top-1.5 h-5 rounded-sm shadow-sm"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(0.25, width)}%`,
                          background: CAMERA_COLORS[ci % CAMERA_COLORS.length],
                          opacity: 0.78,
                        }}
                        title={`${camera.display_name} ${fmtTime(seg.start_time)} - ${fmtTime(seg.end_time)}`}
                      >
                        {hasMotion(seg) && (
                          <span className="absolute inset-x-0 bottom-0 h-1 rounded-b-sm bg-[var(--warn)]" />
                        )}
                      </div>
                    );
                  })}
                  {cameraMotionEvents.map((ev) => {
                    const unix = new Date(ev.start_time).getTime() / 1000;
                    const pct = posOf(unix, viewStart, viewEnd);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className="absolute top-0 z-10 h-8 w-1 -translate-x-1/2 rounded-sm bg-[var(--warn)] shadow-[0_0_8px_rgba(255,122,89,.55)]"
                        style={{ left: `${pct}%` }}
                        title={`Movimiento - ${fmtTime(unix)}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => onSeek(unix)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="absolute bottom-2 top-7 z-30 pointer-events-none"
          style={{ left: `clamp(0%, ${playheadPct}%, 100%)` }}
        >
          <div className="relative">
            <div className="absolute bottom-0 top-0 -translate-x-1/2 w-[3px] rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,.65)]" />
            <div className="absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded border border-white/20 bg-black px-2 py-1 text-[11px] font-mono font-semibold text-white shadow">
              {fmtClock(currentTime)}
            </div>
            <div className="absolute -bottom-1 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,.8)]" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-3)]">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--warn)]" /> movimiento</span>
        <span>barras: grabación disponible</span>
        <span>zoom: rueda</span>
        <span>mover ventana: Shift + rueda</span>
      </div>
    </div>
  );
}

function hasMotion(segment: { motion: number | null }) {
  return Number(segment.motion ?? 0) > 0;
}

function compactSegments(
  segments: RecordingSegment[],
  viewStart: number,
  viewEnd: number,
  duration: number,
): VisualSegment[] {
  const visible = segments.filter((seg) => seg.end_time >= viewStart && seg.start_time <= viewEnd);
  if (duration <= 6 * 3600 || visible.length <= 360) {
    return visible.map((seg) => ({
      id: seg.id,
      start_time: seg.start_time,
      end_time: seg.end_time,
      motion: seg.motion,
    }));
  }

  const bucketCount = duration > 18 * 3600 ? 288 : 360;
  const bucketSize = duration / bucketCount;
  const buckets = new Map<number, VisualSegment>();

  visible.forEach((seg) => {
    const first = Math.max(0, Math.floor((seg.start_time - viewStart) / bucketSize));
    const last = Math.min(bucketCount - 1, Math.floor((seg.end_time - viewStart) / bucketSize));
    for (let bucket = first; bucket <= last; bucket += 1) {
      const start = viewStart + bucket * bucketSize;
      const end = Math.min(viewEnd, start + bucketSize);
      const existing = buckets.get(bucket);
      if (existing) {
        existing.start_time = Math.min(existing.start_time, Math.max(seg.start_time, start));
        existing.end_time = Math.max(existing.end_time, Math.min(seg.end_time, end));
        existing.motion = Number(existing.motion ?? 0) + Number(seg.motion ?? 0);
      } else {
        buckets.set(bucket, {
          id: `bucket-${bucket}`,
          start_time: Math.max(seg.start_time, start),
          end_time: Math.min(seg.end_time, end),
          motion: seg.motion,
        });
      }
    }
  });

  return [...buckets.values()];
}

function sampleEvents(events: VmsEvent[], max: number) {
  if (events.length <= max) return events;
  const step = Math.ceil(events.length / max);
  return events.filter((_, index) => index % step === 0).slice(0, max);
}
