import { apiClient } from "./client";

export type Camera = {
  id: string;
  server_id: string;
  name: string;
  display_name: string;
  frigate_name: string;
  ome_stream_main: string | null;
  ome_stream_sub: string | null;
  llhls_main: string | null;
  llhls_sub: string | null;
  rtsp_main: string | null;
  rtsp_sub: string | null;
  has_audio: boolean;
  has_ptz: boolean;
  position_x: number | null;
  position_y: number | null;
  floor_level: number;
  enabled: boolean;
  tags: string[];
  created_at: string;
};

export type CameraList = {
  items: Camera[];
  total: number;
  page: number;
  page_size: number;
};

export async function listCameras(params: { page_size?: number; enabled?: boolean } = {}) {
  const { data } = await apiClient.get<CameraList>("/cameras", {
    params: { page_size: params.page_size ?? 200, enabled: params.enabled },
  });
  return data;
}

export type CameraUpdate = {
  display_name?: string;
  enabled?: boolean;
  has_audio?: boolean;
  has_ptz?: boolean;
  position_x?: number | null;
  position_y?: number | null;
  floor_level?: number;
  tags?: string[];
};

export async function updateCamera(id: string, body: CameraUpdate) {
  const { data } = await apiClient.put<Camera>(`/cameras/${id}`, body);
  return data;
}

export async function deleteCamera(id: string) {
  await apiClient.delete(`/cameras/${id}`);
}

export async function getCameraSnapshot(
  cameraId: string,
  options: { height?: number; quality?: number } = {},
) {
  const { data } = await apiClient.get<Blob>(`/cameras/${cameraId}/snapshot`, {
    params: options,
    responseType: "blob",
  });
  return data;
}
