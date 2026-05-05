import { useEffect, useRef } from "react";
import { useEventStore } from "../store/eventStore";
import type { WsEvent } from "../store/eventStore";
import { listEvents } from "../api/events";

export function useEvents() {
  const appendHistory = useEventStore((s) => s.appendHistory);
  const events = useEventStore((s) => s.events);
  const activeFilter = useEventStore((s) => s.activeFilter);
  const activeCameraId = useEventStore((s) => s.activeCameraId);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    listEvents({ limit: 50 }).then(({ items }) => {
      const mapped: WsEvent[] = items.map((e) => ({
        id: e.id,
        frigate_event_id: e.frigate_event_id,
        server_id: e.server_id ?? "",
        camera_id: e.camera_id,
        camera_name: null,
        label: e.label,
        sub_label: e.sub_label,
        score: e.score != null ? Number(e.score) : null,
        plate_number: e.plate_number,
        has_clip: e.has_clip,
        has_snapshot: e.has_snapshot,
        zones: e.zones,
        snapshot_url: e.snapshot_url ?? (e.has_snapshot ? `/api/v1/events/${e.id}/snapshot` : null),
        timestamp: e.start_time,
      }));
      appendHistory(mapped);
    });
  }, []);

  const filtered = events.filter((e) => {
    if (activeCameraId !== null && e.camera_id !== activeCameraId && e.camera_name !== activeCameraId) {
      return false;
    }
    if (activeFilter === "all") return true;
    if (activeFilter === "vehicle") {
      return ["car", "truck"].some((l) => e.label.toLowerCase().includes(l));
    }
    if (activeFilter === "bike") {
      return ["motorcycle", "bicycle"].some((l) => e.label.toLowerCase().includes(l));
    }
    if (activeFilter === "bus") {
      return ["bus", "truck"].some((l) => e.label.toLowerCase().includes(l));
    }
    if (activeFilter === "pet") {
      return ["dog", "cat"].some((l) => e.label.toLowerCase().includes(l));
    }
    if (activeFilter === "lpr") {
      return e.label.toLowerCase() === "lpr" || e.plate_number != null;
    }
    return e.label.toLowerCase() === activeFilter;
  });

  return { events: filtered };
}
