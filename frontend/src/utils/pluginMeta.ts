export const PLUGIN_META: Record<string, { color: string; label: string }> = {
  lpr: { color: "#00c9ff", label: "LPR" },
  lpr_advanced: { color: "#38bdf8", label: "LPR avanzado" },
  face_recognition: { color: "#ec4899", label: "Rostros" },
  ocr_general: { color: "#f97316", label: "OCR" },
  line_crossing: { color: "#facc15", label: "Cruce línea" },
  loitering: { color: "#a78bfa", label: "Merodeo" },
  people_counting: { color: "#22c55e", label: "Conteo" },
  epp: { color: "#fb7185", label: "EPP" },
  abandoned_object: { color: "#8b5cf6", label: "Obj. abandonado" },
  camera_sabotage: { color: "#ef4444", label: "Sabotaje" },
  fall_detection: { color: "#dc2626", label: "Caídas" },
  smoke_fire: { color: "#f59e0b", label: "Humo/Fuego" },
  ai_summary: { color: "#14b8a6", label: "Resumen IA" },
  semantic_search: { color: "#6366f1", label: "Búsqueda IA" },
  notifications: { color: "#0ea5e9", label: "Notificaciones" },
};

export const PLUGIN_SOURCE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "frigate", label: "Frigate" },
  { value: "plugin", label: "Todos los plugins" },
  ...Object.entries(PLUGIN_META).map(([key, { color, label }]) => ({
    value: `plugin:${key}`,
    label,
    color,
  })),
];

export function pluginKey(source?: string | null): string | null {
  if (!source?.startsWith("plugin:")) return null;
  return source.slice("plugin:".length);
}

export function pluginMeta(source?: string | null): { color: string; label: string } {
  const key = pluginKey(source);
  if (key) return PLUGIN_META[key] ?? { color: "#94a3b8", label: key };
  return { color: "#8a93a3", label: "Frigate" };
}
