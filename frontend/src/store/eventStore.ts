import { create } from "zustand";

export type WsEvent = {
  id: number;
  frigate_event_id: string | null;
  server_id: string;
  camera_id: string | null;
  camera_name: string | null;
  label: string;
  sub_label: string | null;
  score: number | null;
  plate_number: string | null;
  has_clip: boolean;
  has_snapshot: boolean;
  zones: string[];
  snapshot_url: string | null;
  timestamp: string;
  is_protected?: boolean;
  plugin?: string | null;
  severity?: string | null;
  data?: Record<string, unknown>;
};

type BlobCache = Record<number, string>;
type LastDetection = Record<string, { label: string; color: string; icon: string; time: number }>;

const MAX_EVENTS = 300;

type EventState = {
  events: WsEvent[];
  unread: number;
  isPanelOpen: boolean;
  activeFilter: string;
  activeCameraId: string | null;
  blobUrls: BlobCache;
  lastDetection: LastDetection;
  pushEvent: (event: WsEvent) => void;
  appendHistory: (events: WsEvent[]) => void;
  togglePanel: () => void;
  closePanel: () => void;
  openPanel: () => void;
  markRead: () => void;
  setFilter: (label: string) => void;
  setCameraFilter: (cameraId: string | null) => void;
  setSelectedCamera: (cameraId: string | null) => void;
  setBlobUrl: (eventId: number, url: string) => void;
  revokeBlobUrl: (eventId: number) => void;
};

const LABEL_META: Record<string, { color: string; icon: string }> = {
  person:  { color: "#00D084", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
  motion:  { color: "#5B97FF", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  car:     { color: "#FF7A59", icon: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" },
  truck:   { color: "#FF9B6A", icon: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" },
  bus:     { color: "#FBBF24", icon: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h14v5z" },
  bicycle: { color: "#0EA5E9", icon: "M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm14 0c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zM7.5 15c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm5 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM12.5 8l-2.8 7h1.6l2-6h1l2 6h1.6L14.5 8h-2z" },
  motorcycle: { color: "#06B6D4", icon: "M17.27 6.73l-2.5-1.21L14 4l-1.5 2H8l-3 9h3m0-9H6l-1 3H2l2 6h2l-1 3h3l1-3h4l3-9-4-2z" },
  fall_detected: { color: "#EF4444", icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" },
  object_appeared: { color: "#5B97FF", icon: "M20 6H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zm-4 4h4v4h-4v-4z" },
  suspicious_static_object: { color: "#EAB308", icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" },
  abandoned_pending: { color: "#F97316", icon: "M12 8v5l4 2m6-3a10 10 0 11-20 0 10 10 0 0120 0z" },
  abandoned_object: { color: "#EF4444", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01" },
  removed_object: { color: "#A855F7", icon: "M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" },
  object_cleared: { color: "#22C55E", icon: "M20 6L9 17l-5-5" },
  owner_returned: { color: "#22C55E", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
  face_detected: { color: "#60A5FA", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
  face_recognized: { color: "#EC4899", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-7 8c0-3 5-4.5 7-4.5s7 1.5 7 4.5" },
  watchlist_match: { color: "#F97316", icon: "M12 2l3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 8.9 9 8l3-6z" },
  vip_detected: { color: "#FBBF24", icon: "M5 16L3 5l5 4 4-6 4 6 5-4-2 11H5zm0 3h14" },
  blacklist_alert: { color: "#EF4444", icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" },
  unknown_face: { color: "#94A3B8", icon: "M12 2a5 5 0 015 5c0 2-1 3-2.5 4.2C13.2 12.3 13 13 13 14h-2c0-1.7.6-2.8 2-4 1.3-1 2-1.7 2-3a3 3 0 10-6 0H7a5 5 0 015-5zm-1 16h2v2h-2z" },
  epp_violation: { color: "#FB7185", icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" },
  dog:     { color: "#A855F7", icon: "M4.5 12c0-1.5.5-3 2-4.5l1.5 3c0 1-.5 2-1.5 2.5-.5.5-1 1-1.5 1.5v2c0 1 .5 2 2 2h1c.5 0 1-.5 1-1v-1h7v1c0 .5.5 1 1 1h1c1.5 0 2-1 2-2v-2c-.5-.5-1-1-1.5-1.5-1-.5-1.5-1.5-1.5-2.5l1.5-3c1.5 1.5 2 3 2 4.5 0 3-2.5 5.5-5.5 5.5S4.5 15 4.5 12z" },
  cat:     { color: "#C084FC", icon: "M12 2L9 9H2l5.5 4.5L5 20l7-5 7 5-2.5-6.5L22 9h-7L12 2zm0 3.5l1.8 4.5h-3.6L12 5.5zM7.5 17c.8 0 1.5-.7 1.5-1.5S8.3 14 7.5 14 6 14.7 6 15.5 6.7 17 7.5 17zm9 0c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5-1.5.7-1.5 1.5.7 1.5 1.5 1.5z" },
  lpr:     { color: "#00C9FF", icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2h2v-4h4v-2h-4V7h-2v4H8v2h4z" },
};

function eventMeta(label: string) {
  const l = label.toLowerCase();
  return LABEL_META[l] ?? { color: "#8a93a3", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" };
}

export const useEventStore = create<EventState>((set) => ({
  events: [],
  unread: 0,
  isPanelOpen: true,
  activeFilter: "all",
  activeCameraId: null,
  blobUrls: {},
  lastDetection: {},

  pushEvent: (event) =>
    set((state) => {
      if (state.events.some((e) => e.id === event.id)) return state;
      if (!shouldKeepEvent(event)) return state;
      const camId = event.camera_id ?? event.camera_name ?? "";
      const meta = eventMeta(event.label);
      return {
        events: [event, ...state.events].slice(0, MAX_EVENTS),
        unread: state.isPanelOpen ? 0 : state.unread + 1,
        lastDetection: {
          ...state.lastDetection,
          [camId]: { label: event.label, color: meta.color, icon: meta.icon, time: Date.now() },
        },
      };
    }),

  appendHistory: (events) =>
    set((state) => {
      const existingIds = new Set(state.events.map((e) => e.id));
      const fresh = events
        .filter((e) => !existingIds.has(e.id))
        .filter(shouldKeepEvent);
      let detections = state.lastDetection;
      for (const e of fresh) {
        const camId = e.camera_id ?? e.camera_name ?? "";
        const meta = eventMeta(e.label);
        if (!detections[camId] || e.timestamp > detections[camId].time.toString()) {
          detections = { ...detections, [camId]: { label: e.label, color: meta.color, icon: meta.icon, time: Date.now() } };
        }
      }
      return { events: [...state.events, ...fresh].slice(0, MAX_EVENTS), lastDetection: detections };
    }),

  togglePanel: () =>
    set((state) => ({
      isPanelOpen: !state.isPanelOpen,
      unread: !state.isPanelOpen ? 0 : state.unread,
    })),

  closePanel: () =>
    set(() => ({
      isPanelOpen: false,
    })),

  openPanel: () => set({ isPanelOpen: true, unread: 0 }),

  markRead: () => set({ unread: 0 }),

  setFilter: (label) => set({ activeFilter: label }),

  setCameraFilter: (cameraId) => set({ activeCameraId: cameraId }),

  setSelectedCamera: (cameraId) => set({ activeCameraId: cameraId }),

  setBlobUrl: (eventId, url) =>
    set((state) => ({
      blobUrls: { ...state.blobUrls, [eventId]: url },
    })),

  revokeBlobUrl: (eventId) =>
    set((state) => {
      const url = state.blobUrls[eventId];
      if (url) URL.revokeObjectURL(url);
      const { [eventId]: _, ...rest } = state.blobUrls;
      return { blobUrls: rest };
    }),
}));

function shouldKeepEvent(event: WsEvent) {
  return (
    event.has_clip
    || event.has_snapshot
    || event.label === "fall_detected"
    || event.plugin === "epp"
    || event.plugin === "abandoned_object"
    || event.plugin === "face_recognition"
  );
}
