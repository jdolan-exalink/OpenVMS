import { apiClient } from "./client";

export type SystemConfig = {
  ome_webrtc_base: string;
  ome_llhls_base: string;
  go2rtc_rtsp_host: string;
  cors_origins: string[];
};

export type TestConnectionResult = {
  online: boolean;
  version: string | null;
  cameras: string[];
  error?: string | null;
};

export async function getSystemConfig(): Promise<SystemConfig> {
  const { data } = await apiClient.get<SystemConfig>("/system/config");
  return data;
}

export async function updateSystemConfig(updates: Partial<SystemConfig>): Promise<SystemConfig> {
  const { data } = await apiClient.put<SystemConfig>("/system/config", updates);
  return data;
}

export async function testServerConnection(url: string): Promise<TestConnectionResult> {
  const { data } = await apiClient.post<TestConnectionResult>("/servers/test-connection", { url });
  return data;
}
