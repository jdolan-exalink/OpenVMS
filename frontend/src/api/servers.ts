import { apiClient } from "./client";

export type FrigateServer = {
  id: string;
  name: string;
  display_name: string;
  url: string;
  rtsp_base: string;
  mqtt_host: string | null;
  mqtt_port: number;
  mqtt_username: string | null;
  recordings_path: string | null;
  config_path: string | null;
  enabled: boolean;
  last_seen: string | null;
  created_at: string;
};

export type FrigateServerCreate = {
  name: string;
  display_name: string;
  url: string;
  rtsp_base: string;
  mqtt_host?: string | null;
  mqtt_port?: number;
  mqtt_username?: string | null;
  mqtt_password?: string | null;
  api_key?: string | null;
  recordings_path?: string | null;
  config_path?: string | null;
  enabled?: boolean;
};

export type FrigateServerUpdate = Omit<Partial<FrigateServerCreate>, "name">;

export type ServerStatus = {
  online: boolean;
  version: string | null;
  latency_ms: number | null;
  cameras: string[];
  error: string | null;
};

export async function listServers() {
  const { data } = await apiClient.get<FrigateServer[]>("/servers");
  return data;
}

export async function createServer(body: FrigateServerCreate) {
  const { data } = await apiClient.post<FrigateServer>("/servers", body);
  return data;
}

export async function updateServer(id: string, body: FrigateServerUpdate) {
  const { data } = await apiClient.put<FrigateServer>(`/servers/${id}`, body);
  return data;
}

export async function deleteServer(id: string) {
  await apiClient.delete(`/servers/${id}`);
}

export async function getServerStatus(serverId: string) {
  const { data } = await apiClient.get<ServerStatus>(`/servers/${serverId}/status`);
  return data;
}

export async function syncServer(serverId: string) {
  const { data } = await apiClient.post<{ added: number; updated: number; unchanged: number }>(
    `/servers/${serverId}/sync`,
  );
  return data;
}
