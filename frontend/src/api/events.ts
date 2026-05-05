import { apiClient } from "./client";

export type VmsEvent = {
  id: number;
  frigate_event_id: string | null;
  server_id: string | null;
  camera_id: string | null;
  label: string;
  sub_label: string | null;
  event_type: string | null;
  start_time: string;
  end_time: string | null;
  score: string | number | null;
  zones: string[];
  has_clip: boolean;
  has_snapshot: boolean;
  snapshot_path: string | null;
  clip_path: string | null;
  plate_number: string | null;
  plate_score: string | number | null;
  snapshot_url: string | null;
  severity?: "low" | "medium" | "high" | "critical";
  source?: string;
  is_protected?: boolean;
  extra_metadata?: Record<string, unknown>;
};

export type EventPage = {
  items: VmsEvent[];
  next_cursor: string | null;
};

export type EventListParams = {
  camera_id?: string;
  server_id?: string;
  label?: string;
  plate?: string;
  start?: string;
  end?: string;
  zone?: string;
  score_min?: number;
  has_clip?: boolean;
  cursor?: string;
  limit?: number;
  source?: string;
  severity?: "low" | "medium" | "high" | "critical";
  is_protected?: boolean;
};

export async function listEvents(params: EventListParams = {}) {
  const p: Record<string, unknown> = { limit: params.limit ?? 50 };
  if (params.camera_id) p.camera_id = params.camera_id;
  if (params.server_id) p.server_id = params.server_id;
  if (params.label)     p.label = params.label;
  if (params.plate)     p.plate = params.plate;
  if (params.start)     p.start = params.start;
  if (params.end)       p.end = params.end;
  if (params.zone)      p.zone = params.zone;
  if (params.score_min != null) p.score_min = params.score_min;
  if (params.has_clip != null)  p.has_clip = params.has_clip;
  if (params.cursor)    p.cursor = params.cursor;
  if (params.source)    p.source = params.source;
  if (params.severity)  p.severity = params.severity;
  if (params.is_protected != null) p.is_protected = params.is_protected;
  const { data } = await apiClient.get<EventPage>("/events", { params: p });
  return data;
}

export async function protectEvent(eventId: number) {
  const { data } = await apiClient.patch<VmsEvent>(`/events/${eventId}/protect`);
  return data;
}

export async function unprotectEvent(eventId: number) {
  const { data } = await apiClient.patch<VmsEvent>(`/events/${eventId}/unprotect`);
  return data;
}

export async function deleteEvent(eventId: number) {
  await apiClient.delete(`/events/${eventId}`);
}
