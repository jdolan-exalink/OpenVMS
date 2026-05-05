import { apiClient } from "../api/client";

export async function fetchSnapshotWithAuth(eventId: number): Promise<string> {
  const response = await apiClient.get(`/events/${eventId}/snapshot`, {
    responseType: "blob",
  });
  return URL.createObjectURL(response.data);
}

export async function fetchClipWithAuth(
  eventId: number,
  onProgress?: (percent: number) => void,
): Promise<{ blobUrl: string; filename: string }> {
  const response = await apiClient.get(`/events/${eventId}/clip`, {
    responseType: "blob",
    onDownloadProgress: (ev) => {
      if (ev.total && onProgress) {
        onProgress(Math.round((ev.loaded * 100) / ev.total));
      }
    },
  });
  const blobUrl = URL.createObjectURL(response.data);
  return { blobUrl, filename: `event_${eventId}.mp4` };
}
