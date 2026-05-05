import { useRef, useEffect, useState } from "react";
import { useEventStore } from "../../store/eventStore";
import { useEvents } from "../../hooks/useEvents";
import EventCard from "./EventCard";

const LABEL_FILTERS: {
  id: string;
  label: string;
  color: string;
  icon: string;
}[] = [
  {
    id: "all",
    label: "Todo",
    color: "#5B97FF",
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z",
  },
  {
    id: "person",
    label: "Persona",
    color: "#00D084",
    icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  },
  {
    id: "pet",
    label: "Mascota",
    color: "#F59E0B",
    icon: "M12 18c-2 0-3-1.5-3-3v-2c0-1.5 1-3 3-3s3 1.5 3 3v2c0 1.5-1 3-3 3zm-5-3c-1.5 0-3-1-3-2.5v-2c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5v2c0 1.5-1.5 2.5-3 2.5zm10 0c-1.5 0-3-1-3-2.5v-2c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5v2c0 1.5-1.5 2.5-3 2.5zM12 2C9 2 7 4 7 6.5c0 2.5 3 5.5 5 8 2-2.5 5-5.5 5-8C17 4 15 2 12 2z",
  },
  {
    id: "vehicle",
    label: "Vehículo",
    color: "#A855F7",
    icon: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  },
  {
    id: "bike",
    label: "Bici / Moto",
    color: "#0EA5E9",
    icon: "M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm14 0c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zM7.5 15c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm5 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM12.5 8l-2.8 7h1.6l2-6h1l2 6h1.6L14.5 8h-2z",
  },
  {
    id: "bus",
    label: "Bus / Camión",
    color: "#F59E0B",
    icon: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h14v5z",
  },
  {
    id: "lpr",
    label: "LPR",
    color: "#00C9FF",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2h2v-4h4v-2h-4V7h-2v4H8v2h4z",
  },
];

export default function EventFeed() {
  const { events } = useEvents();
  const activeFilter = useEventStore((s) => s.activeFilter);
  const activeCameraId = useEventStore((s) => s.activeCameraId);
  const isPanelOpen = useEventStore((s) => s.isPanelOpen);
  const setFilter = useEventStore((s) => s.setFilter);
  const setCameraFilter = useEventStore((s) => s.setCameraFilter);
  const markRead = useEventStore((s) => s.markRead);

  const listRef = useRef<HTMLDivElement>(null);
  const prevTopId = useRef<number | null>(null);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());

  const availableCameras = Array.from(
    new Map(
      events
        .filter((e) => e.camera_name)
        .map((e) => [e.camera_name, e.camera_id ?? e.camera_name]),
    ).entries(),
  ).map(([name, id]) => ({ id: id as string, name: name as string }));

  const topId = events[0]?.id ?? null;

  useEffect(() => {
    if (topId !== null && topId !== prevTopId.current && prevTopId.current !== null) {
      setNewIds((prev) => new Set([...prev, topId]));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(topId);
          return next;
        });
      }, 800);

      const el = listRef.current;
      if (el && el.scrollTop < 80) {
        el.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
    prevTopId.current = topId;
  }, [topId]);

  useEffect(() => {
    if (isPanelOpen) markRead();
  }, [isPanelOpen, events.length, markRead]);

  return (
    <>
      <div className="ep-filters ep-filters-camera">
        <button
          type="button"
          className={`ep-chip${activeCameraId === null ? " active" : ""}`}
          onClick={() => setCameraFilter(null)}
        >
          Todas
        </button>
        {availableCameras.map((cam) => (
          <button
            key={cam.id}
            type="button"
            className={`ep-chip${activeCameraId === cam.id ? " active" : ""}`}
            onClick={() => setCameraFilter(cam.id)}
          >
            {cam.name}
          </button>
        ))}
      </div>

      <div className="ep-filters">
        {LABEL_FILTERS.map((f) => {
          const isActive = activeFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              className={`ep-chip ep-chip-icon${isActive ? " active" : ""}`}
              style={isActive ? ({ "--chip-color": f.color } as React.CSSProperties) : undefined}
              onClick={() => setFilter(f.id)}
              title={f.label}
            >
              <svg viewBox="0 0 24 24" fill={isActive ? f.color : "currentColor"} className="ep-icon" style={{ transition: "fill 150ms" }}>
                <path d={f.icon} />
              </svg>
              {isActive && (
                <span className="ep-icon-label" style={{ color: f.color }}>
                  {f.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="ep-list" ref={listRef}>
        {events.length === 0 ? (
          <div className="ep-empty">
            <svg viewBox="0 0 24 24" fill="none" width="24" height="24" style={{ opacity: 0.25 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Sin eventos</span>
          </div>
        ) : (
          events.map((ev) => (
            <EventCard key={ev.id} event={ev} isNew={newIds.has(ev.id)} />
          ))
        )}
      </div>
    </>
  );
}