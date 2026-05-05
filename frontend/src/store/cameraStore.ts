import { create } from "zustand";

type CameraStatus = "connecting" | "online" | "offline";
type CameraStatuses = Record<string, CameraStatus>;

const SESSION_KEY = "vms_camera_store";

function loadFromSession(): { cameraStatuses: CameraStatuses; onlineCount: number } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { cameraStatuses: CameraStatuses; onlineCount: number };
  } catch {
    return null;
  }
}

const saved = loadFromSession();

function loadGridCameraIds(): string[] {
  try {
    const v = localStorage.getItem("openvms.live.gridCameraIds.v1");
    if (!v) return [];
    const p = JSON.parse(v);
    return Array.isArray(p) && p.every((x) => typeof x === "string") ? p : [];
  } catch { return []; }
}

export const useCameraStore = create<{
  cameraStatuses: CameraStatuses;
  onlineCount: number;
  gridCameraIds: string[];
  setCameraStatus: (cameraId: string, status: CameraStatus) => void;
  clearCameraStatus: (cameraId: string) => void;
  updateOnlineCount: () => void;
  setGridCameraIds: (ids: string[]) => void;
  setGridCameraFromOrder: (orderedCameras: { id: string }[], layoutMax: number) => void;
  preloadUrl: string | null;
  setPreloadUrl: (url: string | null) => void;
}>((set) => ({
  cameraStatuses: saved?.cameraStatuses ?? {},
  onlineCount: saved?.onlineCount ?? 0,
  gridCameraIds: loadGridCameraIds(),
  preloadUrl: null,

  setCameraStatus: (cameraId, status) =>
    set((state) => {
      const prev = state.cameraStatuses[cameraId];
      const next = { ...state.cameraStatuses, [cameraId]: status };
      let onlineCount = state.onlineCount;
      if (prev !== "online" && status === "online") {
        onlineCount += 1;
      } else if (prev === "online" && status !== "online") {
        onlineCount = Math.max(0, onlineCount - 1);
      }
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cameraStatuses: next, onlineCount })); } catch {}
      return { cameraStatuses: next, onlineCount };
    }),

  clearCameraStatus: (cameraId) =>
    set((state) => {
      const { [cameraId]: _, ...rest } = state.cameraStatuses;
      const removedWasOnline = state.cameraStatuses[cameraId] === "online";
      const onlineCount = removedWasOnline ? Math.max(0, state.onlineCount - 1) : state.onlineCount;
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cameraStatuses: rest, onlineCount })); } catch {}
      return { cameraStatuses: rest, onlineCount };
    }),

  updateOnlineCount: () =>
    set((state) => {
      const count = Object.values(state.cameraStatuses).filter((s) => s === "online").length;
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cameraStatuses: state.cameraStatuses, onlineCount: count })); } catch {}
      return { onlineCount: count };
    }),

  setGridCameraIds: (ids) => {
    try { localStorage.setItem("openvms.live.gridCameraIds.v1", JSON.stringify(ids)); } catch {}
    set({ gridCameraIds: ids });
  },

  setGridCameraFromOrder: (orderedCameras, layoutMax) => {
    const ids = orderedCameras.slice(0, layoutMax).map((c) => c.id);
    try { localStorage.setItem("openvms.live.gridCameraIds.v1", JSON.stringify(ids)); } catch {}
    set({ gridCameraIds: ids });
  },

  setPreloadUrl: (url) => set({ preloadUrl: url }),
}));