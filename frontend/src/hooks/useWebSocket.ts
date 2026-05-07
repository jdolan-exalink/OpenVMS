import { useEffect, useRef } from "react";
import { useQueryClient } from "react-query";
import { useAuthStore } from "../store/authStore";
import { useEventStore } from "../store/eventStore";
import type { WsEvent } from "../store/eventStore";

function wsBase(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;

  try {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { access_token?: string; refresh_token?: string };
    if (!data.access_token || !data.refresh_token) return null;
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    return data.access_token;
  } catch {
    return null;
  }
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pushEvent = useEventStore((s) => s.pushEvent);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(1000);
  const alive = useRef(true);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    alive.current = true;
    delayRef.current = 1000;
    connect(accessToken);

    return () => {
      alive.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isAuthenticated, accessToken, queryClient, pushEvent]);

  async function connect(token: string) {
    if (!alive.current) return;

    const latestToken = localStorage.getItem("access_token") ?? token;
    const ws = new WebSocket(`${wsBase()}/ws/events?token=${encodeURIComponent(latestToken)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      delayRef.current = 1000;
    };

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data as string) as { type: string } & Record<string, unknown>;
        if (msg.type === "event") {
          pushEvent(normalizeWsEvent(msg));
        } else if (msg.type === "plugin_alert") {
          if (msg.plugin === "people_counting" || msg.alert_type === "people_counting") {
            queryClient.invalidateQueries(["pc-counts"]);
            queryClient.invalidateQueries(["pc-history"]);
          }
          if (msg.alert_type === "fall_detected" || msg.plugin === "abandoned_object" || msg.plugin === "face_recognition") {
            pushEvent(normalizePluginAlert(msg));
            queryClient.invalidateQueries(["events-page"]);
          }
          queryClient.invalidateQueries(["enterprise-alerts"]);
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      if (!alive.current) return;
      retryRef.current = setTimeout(async () => {
        delayRef.current = Math.min(delayRef.current * 2, 60000);
        const nextToken = event.code === 1008
          ? await refreshAccessToken()
          : localStorage.getItem("access_token") ?? await refreshAccessToken();
        if (!nextToken) {
          useAuthStore.getState().clearSession();
          return;
        }
        connect(nextToken);
      }, delayRef.current);
    };

    ws.onerror = () => ws.close();
  }
}

function normalizePluginAlert(msg: Record<string, unknown>): WsEvent {
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const eventId = Number(msg.event_id ?? Date.now());
  return {
    id: eventId,
    frigate_event_id: null,
    server_id: "",
    camera_id: (msg.camera_id as string | null | undefined) ?? null,
    camera_name: (msg.camera_name as string | null | undefined) ?? (data.camera_name as string | null | undefined) ?? null,
    label: String(msg.alert_type ?? "plugin_alert"),
    sub_label: String(msg.severity ?? "high"),
    score: typeof data.fall_confidence === "number" ? data.fall_confidence : null,
    plate_number: null,
    has_clip: false,
    has_snapshot: false,
    zones: [],
    snapshot_url: null,
    timestamp: String(msg.timestamp ?? new Date().toISOString()),
    plugin: String(msg.plugin ?? data.plugin ?? "plugin"),
    severity: String(msg.severity ?? data.severity ?? "high"),
    data,
  };
}

function normalizeWsEvent(msg: Record<string, unknown>): WsEvent {
  return {
    id: Number(msg.id),
    frigate_event_id: (msg.frigate_event_id as string | null | undefined) ?? null,
    server_id: String(msg.server_id ?? ""),
    camera_id: (msg.camera_id as string | null | undefined) ?? null,
    camera_name: (msg.camera_name as string | null | undefined) ?? null,
    label: String(msg.label ?? "unknown"),
    sub_label: (msg.sub_label as string | null | undefined) ?? null,
    score: msg.score == null ? null : Number(msg.score),
    plate_number: (msg.plate_number as string | null | undefined) ?? null,
    has_clip: Boolean(msg.has_clip),
    has_snapshot: Boolean(msg.has_snapshot),
    zones: Array.isArray(msg.zones) ? msg.zones.map(String) : [],
    snapshot_url: (msg.snapshot_url as string | null | undefined) ?? null,
    timestamp: String(msg.timestamp ?? new Date().toISOString()),
  };
}
