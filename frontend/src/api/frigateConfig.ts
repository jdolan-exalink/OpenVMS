import { apiClient } from "./client";

export type Go2rtcStream = {
  name: string;
  url: string | string[];
};

export type FrigateCamera = {
  name: string;
  enabled: boolean;
  detect?: { width: number; height: number; fps: number; enabled: boolean };
  record?: { enabled: boolean; retain?: { days: number; mode: string } };
  snapshots?: { enabled: boolean; retain?: { default: number } };
};

export type AddCameraPayload = {
  camera_name: string;
  display_name: string;
  server_id: string;
  rtsp_main: string;
  rtsp_sub?: string | null;
  detect_width?: number;
  detect_height?: number;
  detect_fps?: number;
  detect_enabled?: boolean;
  record_enabled?: boolean;
  record_retain_days?: number;
  record_mode?: "all" | "motion" | "active_objects";
  snapshots_enabled?: boolean;
  snapshots_retain_days?: number;
  track_objects?: string[];
  has_audio?: boolean;
  has_ptz?: boolean;
  auto_save?: boolean;
};

export type AddCameraResult = {
  camera_name: string;
  message: string;
};

export async function listFrigateStreams(serverId: string): Promise<Go2rtcStream[]> {
  const { data } = await apiClient.get<Go2rtcStream[]>(`/frigate-config/${serverId}/streams`);
  return data;
}

export async function getFrigateConfig(serverId: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(`/frigate-config/${serverId}/config`);
  return data;
}

export async function addFrigateCamera(serverId: string, payload: AddCameraPayload): Promise<AddCameraResult> {
  const { data } = await apiClient.post<AddCameraResult>(`/frigate-config/${serverId}/cameras`, payload);
  return data;
}

export async function deleteFrigateCamera(serverId: string, cameraName: string): Promise<void> {
  await apiClient.delete(`/frigate-config/${serverId}/cameras/${cameraName}`);
}

export async function syncFrigateServer(serverId: string): Promise<void> {
  await apiClient.post(`/frigate-config/${serverId}/sync`);
}

export async function getFrigateVersion(serverId: string): Promise<string> {
  const { data } = await apiClient.get<string>(`/frigate-config/${serverId}/version`);
  return data;
}
