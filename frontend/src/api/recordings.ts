import { apiClient } from "./client";

export type RecordingSegment = {
  id: string;
  camera: string;
  start_time: number;
  end_time: number;
  duration: number;
  motion: number | null;
  objects: number | null;
};

export type RecordingsResponse = {
  camera_id: string;
  camera_name: string;
  segments: RecordingSegment[];
};

export type ExportJob = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  download_url: string | null;
  error: string | null;
};

export async function listRecordings(params: { camera_id: string; start: string; end: string }) {
  const { data } = await apiClient.get<RecordingsResponse>("/recordings", { params });
  return data;
}

export async function createExport(body: { camera_id: string; start: string; end: string }) {
  const { data } = await apiClient.post<ExportJob>("/recordings/export", body);
  return data;
}

export async function getExportStatus(jobId: string) {
  const { data } = await apiClient.get<ExportJob>(`/recordings/export/${jobId}`);
  return data;
}

export async function downloadExport(jobId: string) {
  const { data } = await apiClient.get<Blob>(`/recordings/export/${jobId}/download`, {
    responseType: "blob",
  });
  return data;
}
