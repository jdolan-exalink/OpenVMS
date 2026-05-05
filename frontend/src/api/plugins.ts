import { apiClient } from "./client";

export type Plugin = {
  id: string | null;
  name: string;
  display_name?: string;
  version: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
  default_config?: Record<string, unknown>;
  is_active: boolean;
  has_sidebar_page?: boolean;
  sidebar_icon?: string;
  sidebar_label?: string;
  sidebar_route?: string;
  category?: string;
  requires_gpu?: boolean;
  config_schema?: Record<string, unknown>;
};

export type SidebarItem = {
  name: string;
  sidebar_icon: string;
  sidebar_label: string;
  sidebar_route: string;
  category: string;
};

// ── Core plugin management ───────────────────────────────────────────────────

export async function listPlugins() {
  const { data } = await apiClient.get<Plugin[]>("/plugins");
  return data;
}

export async function getSidebarPlugins() {
  const { data } = await apiClient.get<SidebarItem[]>("/plugins/sidebar-items");
  return data;
}

export async function getPluginSchema(name: string) {
  const { data } = await apiClient.get<Record<string, unknown>>(`/plugins/${name}/schema`);
  return data;
}

export async function enablePlugin(name: string) {
  const { data } = await apiClient.put<Plugin>(`/plugins/${name}/enable`);
  return data;
}

export async function disablePlugin(name: string) {
  const { data } = await apiClient.put<Plugin>(`/plugins/${name}/disable`);
  return data;
}

export async function updatePluginConfig(name: string, config: Record<string, unknown>) {
  const { data } = await apiClient.put<Plugin>(`/plugins/${name}/config`, { config });
  return data;
}

// ── Notifications ────────────────────────────────────────────────────────────

export type NotificationRule = {
  name: string;
  enabled?: boolean;
  cameras: string[];
  labels: string[];
  zones?: string[];
  time_from?: string;
  time_to?: string;
  min_score: number;
  cooldown_seconds: number;
  cooldown_scope?: "global" | "camera" | "camera_label";
  channel: "telegram" | "webhook";
  telegram?: { bot_token: string; chat_id: string };
  webhook?: { url: string; headers?: Record<string, string>; extra_fields?: Record<string, unknown> };
};

export async function testTelegram(bot_token: string, chat_id: string) {
  const { data } = await apiClient.post<{ ok: boolean }>("/plugins/notifications/test-telegram", {
    bot_token,
    chat_id,
  });
  return data;
}

// ── LPR ─────────────────────────────────────────────────────────────────────

export type LprPlate = {
  id: number;
  plate_number: string;
  plate_score: number | null;
  camera_id: string | null;
  server_id: string | null;
  is_blacklisted: boolean;
  detected_at: string;
};

export type LprBlacklist = {
  id: number;
  plate_number: string;
  reason: string | null;
  added_at: string;
};

export async function listPlates(params?: { camera_id?: string; limit?: number }) {
  const { data } = await apiClient.get<LprPlate[]>("/plugins/lpr/plates", { params });
  return data;
}

export async function searchPlates(plate: string, limit = 50) {
  const { data } = await apiClient.get<LprPlate[]>("/plugins/lpr/search", { params: { plate, limit } });
  return data;
}

export async function listBlacklist() {
  const { data } = await apiClient.get<LprBlacklist[]>("/plugins/lpr/blacklist");
  return data;
}

export async function addToBlacklist(plate_number: string, reason?: string) {
  const { data } = await apiClient.post<LprBlacklist>("/plugins/lpr/blacklist", { plate_number, reason });
  return data;
}

export async function removeFromBlacklist(id: number) {
  await apiClient.delete(`/plugins/lpr/blacklist/${id}`);
}

// ── People Counting ──────────────────────────────────────────────────────────

export type CounterData = Record<string, Record<string, Record<string, number>>>;

export type PeopleCountingHistoryHour = {
  hour: string;
  enter: number;
  exit: number;
};

export type PeopleCountingHistoryCamera = {
  camera_name: string;
  total_enter: number;
  total_exit: number;
  hours: PeopleCountingHistoryHour[];
};

export type PeopleCountingHistory = {
  start: string;
  end: string;
  hours: string[];
  cameras: PeopleCountingHistoryCamera[];
};

export async function getPluginCounts(camera_name?: string) {
  const { data } = await apiClient.get<CounterData>("/plugins/people_counting/counts", {
    params: camera_name ? { camera_name } : {},
  });
  return data;
}

export async function resetPluginCounts(camera_name?: string, zone_name?: string) {
  await apiClient.delete("/plugins/people_counting/counts", {
    params: { ...(camera_name ? { camera_name } : {}), ...(zone_name ? { zone_name } : {}) },
  });
}

export async function getPeopleCountingHistory(params: { camera_name?: string; days_back?: number; date?: string } = {}) {
  const { data } = await apiClient.get<PeopleCountingHistory>("/plugins/people_counting/history", { params });
  return data;
}

export async function deletePeopleCountingHistory(camera_name: string) {
  const { data } = await apiClient.delete<{ ok: boolean; deleted: number }>("/plugins/people_counting/history", {
    params: { camera_name },
  });
  return data;
}

// ── Face Recognition ─────────────────────────────────────────────────────────

export type RegisteredFace = {
  id: number;
  person_name: string;
  person_id: string | null;
  camera_id: string | null;
  created_at: string | null;
  metadata: Record<string, unknown>;
};

export type UnknownFace = {
  id: number;
  camera_id: string | null;
  created_at: string | null;
  metadata: Record<string, unknown>;
};

export type FaceAppearance = {
  face_id: number | null;
  camera_name: string;
  created_at: string | null;
  source: "registro" | "reconocimiento";
  similarity: number | null;
};

export async function listFaces(person_name?: string, limit = 50) {
  const { data } = await apiClient.get<RegisteredFace[]>("/plugins/face_recognition/faces", {
    params: { ...(person_name ? { person_name } : {}), limit },
  });
  return data;
}

export async function listUnknownFaces(limit = 30) {
  const { data } = await apiClient.get<UnknownFace[]>("/plugins/face_recognition/unknowns", { params: { limit } });
  return data;
}

export async function registerFace(formData: FormData) {
  const { data } = await apiClient.post<{ ok: boolean; person_name: string }>(
    "/plugins/face_recognition/faces/register",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function identifyFace(face_id: number, person_name: string) {
  const { data } = await apiClient.post(`/plugins/face_recognition/faces/${face_id}/identify`, { person_name });
  return data;
}

export async function renameFace(face_id: number, face_name: string) {
  const { data } = await apiClient.put(`/plugins/face_recognition/faces/${face_id}/name`, { face_name });
  return data;
}

export async function listFaceAppearances(person_name: string, limit = 100) {
  const { data } = await apiClient.get<FaceAppearance[]>("/plugins/face_recognition/faces/appearances", {
    params: { person_name, limit },
  });
  return data;
}

export async function deleteFace(face_id: number) {
  await apiClient.delete(`/plugins/face_recognition/faces/${face_id}`);
}

export async function getFaceImageUrl(face_id: number, crop = true) {
  const { data } = await apiClient.get<Blob>(`/plugins/face_recognition/faces/${face_id}/image`, {
    params: { crop },
    responseType: "blob",
  });
  return URL.createObjectURL(data);
}

// ── AI Summary ──────────────────────────────────────────────────────────────

export type QueueStatus = {
  size: number;
  processing: boolean;
  cache_entries: number;
};

export type SummaryEntry = {
  event_id: number;
  camera_id: string | null;
  summary: string | null;
  generated_at: string | null;
};

export async function getQueueStatus() {
  const { data } = await apiClient.get<QueueStatus>("/plugins/ai_summary/queue-status");
  return data;
}

export async function getAISummaries(params: { camera_id?: string; limit?: number } = {}) {
  const { data } = await apiClient.get<SummaryEntry[]>("/plugins/ai_summary/summaries", { params });
  return data;
}

export async function triggerAISummary(event_ids: number[]) {
  const { data } = await apiClient.post<{ queued: number; total: number }>(
    "/plugins/ai_summary/summaries/generate",
    event_ids,
  );
  return data;
}

// ── Loitering ───────────────────────────────────────────────────────────────

export async function getLoiteringZones() {
  const { data } = await apiClient.get("/plugins/loitering/zones");
  return data;
}

export async function getLoiteringStats() {
  const { data } = await apiClient.get<{
    active_zones: number;
    tracks_tracked: number;
    total_alerts: number;
  }>("/plugins/loitering/stats");
  return data;
}

export async function clearLoiteringTrack(track_id: number, camera_name: string) {
  await apiClient.delete(`/plugins/loitering/tracks/${track_id}`, {
    params: { camera_name },
  });
}

// ── Line Crossing ──────────────────────────────────────────────────────────

export async function getLineCrossingLines() {
  const { data } = await apiClient.get("/plugins/line_crossing/lines");
  return data;
}

export async function getLineCrossingStats() {
  const { data } = await apiClient.get<{
    active_lines: number;
    tracks_tracked: number;
  }>("/plugins/line_crossing/stats");
  return data;
}

export async function clearLineCrossingTrack(track_id: string, camera_name: string) {
  await apiClient.delete(`/plugins/line_crossing/tracks/${track_id}`, {
    params: { camera_name },
  });
}

// ── Smoke / Fire ────────────────────────────────────────────────────────────

export async function getSmokeFireStats() {
  const { data } = await apiClient.get<{
    engine_loaded: boolean;
    alerted_cameras: number;
    consecutive_tracking: number;
  }>("/plugins/smoke_fire/stats");
  return data;
}

export async function resetSmokeFireCamera(camera_name: string) {
  await apiClient.delete(`/plugins/smoke_fire/reset/${camera_name}`);
}

// ── Fall Detection ──────────────────────────────────────────────────────────

export async function getFallDetectionStats() {
  const { data } = await apiClient.get<{
    pose_initialized: boolean;
    active_tracks: number;
    alerted_tracks: number;
  }>("/plugins/fall_detection/stats");
  return data;
}

export async function clearFallDetectionTrack(person_id: number, camera_name: string) {
  await apiClient.delete(`/plugins/fall_detection/tracks/${person_id}`, {
    params: { camera_name },
  });
}

// ── Camera Sabotage ─────────────────────────────────────────────────────────

export async function getCameraSabotageStats() {
  const { data } = await apiClient.get<{
    monitored_cameras: number;
    consecutive_alerts: number;
  }>("/plugins/camera_sabotage/stats");
  return data;
}

export async function resetCameraSabotageCamera(camera_name: string) {
  await apiClient.delete(`/plugins/camera_sabotage/reset/${camera_name}`);
}

// ── EPP ────────────────────────────────────────────────────────────────────

export async function getEppStats() {
  const { data } = await apiClient.get<{
    engine_loaded: boolean;
    active_tracks: number;
    violations_logged: number;
  }>("/plugins/epp/stats");
  return data;
}

export async function clearEppTrack(person_id: number, camera_name: string) {
  await apiClient.delete(`/plugins/epp/tracks/${person_id}`, {
    params: { camera_name },
  });
}

// ── OCR General ─────────────────────────────────────────────────────────────

export async function getOcrGeneralStats() {
  const { data } = await apiClient.get<{
    ocr_ready: boolean;
    cooldown_keys: number;
    last_results: number;
  }>("/plugins/ocr_general/stats");
  return data;
}

export async function resetOcrCooldown(camera_name = "") {
  await apiClient.post("/plugins/ocr_general/reset-cooldown", null, {
    params: { camera_name: camera_name || undefined },
  });
}

// ── Abandoned Object ────────────────────────────────────────────────────────

export async function getAbandonedObjectStats() {
  const { data } = await apiClient.get<{
    engine_loaded: boolean;
    tracked_objects: number;
    stationary_alerts: number;
  }>("/plugins/abandoned_object/stats");
  return data;
}

export async function clearAbandonedObject(object_id: number, camera_name: string) {
  await apiClient.delete(`/plugins/abandoned_object/objects/${object_id}`, {
    params: { camera_name },
  });
}

// ── LPR Advanced ────────────────────────────────────────────────────────────

export async function getLprAdvancedStats() {
  const { data } = await apiClient.get<{
    engine_loaded: boolean;
    ocr_ready: boolean;
    last_detection_times: number;
  }>("/plugins/lpr_advanced/stats");
  return data;
}

export async function resetLprAdvancedCamera(camera_name: string) {
  await apiClient.post(`/plugins/lpr_advanced/reset/${camera_name}`);
}

// ── Semantic Search ──────────────────────────────────────────────────────────

export type SemanticStats = {
  total_embeddings: number;
  oldest: string | null;
  newest: string | null;
  initialized: boolean;
};

export async function getSemanticStats(): Promise<SemanticStats> {
  const resp = await apiClient.get<SemanticStats>("/plugins/semantic_search/stats");
  return resp.data;
}
