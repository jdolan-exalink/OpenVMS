import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { WsEvent } from "../../store/eventStore";
import { useEventStore } from "../../store/eventStore";
import { fetchSnapshotWithAuth, fetchClipWithAuth } from "../../utils/snapshot";

type LabelCfg = {
  color: string;
  bg: string;
  icon: string;
};

const LABELS: Record<string, LabelCfg> = {
  person: {
    color: "#00D084",
    bg: "rgba(0,208,132,0.14)",
    icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  },
  motion: {
    color: "#5B97FF",
    bg: "rgba(91,157,255,0.14)",
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  },
  car: {
    color: "#FF7A59",
    bg: "rgba(255,122,89,0.14)",
    icon: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  },
  truck: {
    color: "#FF9B6A",
    bg: "rgba(255,155,106,0.14)",
    icon: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  },
  bus: {
    color: "#FBBF24",
    bg: "rgba(251,191,36,0.14)",
    icon: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h14v5z",
  },
  bicycle: {
    color: "#0EA5E9",
    bg: "rgba(14,165,233,0.14)",
    icon: "M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm14 0c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zM7.5 15c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm5 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM12.5 8l-2.8 7h1.6l2-6h1l2 6h1.6L14.5 8h-2z",
  },
  motorcycle: {
    color: "#06B6D4",
    bg: "rgba(6,182,212,0.14)",
    icon: "M17.27 6.73l-2.5-1.21L14 4l-1.5 2H8l-3 9h3m0-9H6l-1 3H2l2 6h2l-1 3h3l1-3h4l3-9-4-2z",
  },
  dog: {
    color: "#A855F7",
    bg: "rgba(168,85,247,0.14)",
    icon: "M4.5 12c0-1.5.5-3 2-4.5l1.5 3c0 1-.5 2-1.5 2.5-.5.5-1 1-1.5 1.5v2c0 1 .5 2 2 2h1c.5 0 1-.5 1-1v-1h7v1c0 .5.5 1 1 1h1c1.5 0 2-1 2-2v-2c-.5-.5-1-1-1.5-1.5-1-.5-1.5-1.5-1.5-2.5l1.5-3c1.5 1.5 2 3 2 4.5 0 3-2.5 5.5-5.5 5.5S4.5 15 4.5 12z",
  },
  cat: {
    color: "#C084FC",
    bg: "rgba(192,132,252,0.14)",
    icon: "M12 2L9 9H2l5.5 4.5L5 20l7-5 7 5-2.5-6.5L22 9h-7L12 2zm0 3.5l1.8 4.5h-3.6L12 5.5zM7.5 17c.8 0 1.5-.7 1.5-1.5S8.3 14 7.5 14 6 14.7 6 15.5 6.7 17 7.5 17zm9 0c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5-1.5.7-1.5 1.5.7 1.5 1.5 1.5z",
  },
  pet: {
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.14)",
    icon: "M12 18c-2 0-3-1.5-3-3v-2c0-1.5 1-3 3-3s3 1.5 3 3v2c0 1.5-1 3-3 3zm-5-3c-1.5 0-3-1-3-2.5v-2c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5v2c0 1.5-1.5 2.5-3 2.5zm10 0c-1.5 0-3-1-3-2.5v-2c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5v2c0 1.5-1.5 2.5-3 2.5zM12 2C9 2 7 4 7 6.5c0 2.5 3 5.5 5 8 2-2.5 5-5.5 5-8C17 4 15 2 12 2z",
  },
  lpr: {
    color: "#00C9FF",
    bg: "rgba(0,201,255,0.14)",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2h2v-4h4v-2h-4V7h-2v4H8v2h4z",
  },
  lpr_advanced: {
    color: "#38BDF8",
    bg: "rgba(56,189,248,0.14)",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-9-3h8v-2h-8v2zm0-4h8v-2h-8v2z",
  },
  blacklisted_plate: {
    color: "#EF4444",
    bg: "rgba(239,68,68,0.14)",
    icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z",
  },
  epp_violation: {
    color: "#FB7185",
    bg: "rgba(251,113,133,0.14)",
    icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z",
  },
  face: {
    color: "#EC4899",
    bg: "rgba(236,72,153,0.14)",
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z",
  },
  face_recognized: {
    color: "#EC4899",
    bg: "rgba(236,72,153,0.14)",
    icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  },
  unknown_face: {
    color: "#94A3B8",
    bg: "rgba(148,163,184,0.14)",
    icon: "M12 2a5 5 0 015 5c0 2-1 3-2.5 4.2C13.2 12.3 13 13 13 14h-2c0-1.7.6-2.8 2-4 1.3-1 2-1.7 2-3a3 3 0 10-6 0H7a5 5 0 015-5zm-1 16h2v2h-2z",
  },
  vip_detected: {
    color: "#FBBF24",
    bg: "rgba(251,191,36,0.14)",
    icon: "M5 16L3 5l5 4 4-6 4 6 5-4-2 11H5zm0 3h14",
  },
  blacklist_alert: {
    color: "#EF4444",
    bg: "rgba(239,68,68,0.14)",
    icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z",
  },
  watchlist_match: {
    color: "#F97316",
    bg: "rgba(249,115,22,0.14)",
    icon: "M12 2l3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 8.9 9 8l3-6z",
  },
  abandoned_object: {
    color: "#EF4444",
    bg: "rgba(239,68,68,0.14)",
    icon: "M20 6H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zm-4 4h4v4h-4v-4z",
  },
  abandoned_pending: {
    color: "#F97316",
    bg: "rgba(249,115,22,0.14)",
    icon: "M12 8v5l4 2m6-3a10 10 0 11-20 0 10 10 0 0120 0z",
  },
  suspicious_static_object: {
    color: "#EAB308",
    bg: "rgba(234,179,8,0.14)",
    icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z",
  },
  removed_object: {
    color: "#A855F7",
    bg: "rgba(168,85,247,0.14)",
    icon: "M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14",
  },
  fall_detected: {
    color: "#EF4444",
    bg: "rgba(239,68,68,0.14)",
    icon: "M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z",
  },
  package: {
    color: "#8B5CF6",
    bg: "rgba(139,92,246,0.14)",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.5h2l-4 5 1.5-1.5L9.5 11h2l3.5 4z",
  },
};

function labelCfg(label: string): LabelCfg {
  return (
    LABELS[label.toLowerCase()] ?? {
      color: "#8a93a3",
      bg: "rgba(138,147,163,0.12)",
      icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    }
  );
}

function formatTs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

function shortId(id: string | null): string {
  if (!id) return "—";
  if (id.includes("-")) return id.split("-")[0];
  return id.slice(0, 8);
}

interface PopupProps {
  event: WsEvent;
  onClose: () => void;
}

export function EventPopup({ event, onClose }: PopupProps) {
  const cfg = labelCfg(event.label);
  const [clipSrc, setClipSrc] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotName] = useState(() => `evento_${event.id}_${event.label}.jpg`);

  const blobUrls = useEventStore((s) => s.blobUrls);
  const setBlobUrl = useEventStore((s) => s.setBlobUrl);
  const { date, time } = formatTs(event.timestamp);
  const camLabel = event.camera_name ?? shortId(event.camera_id);
  const showScore = event.score != null && event.score > 0;

  useEffect(() => {
    if (!event.has_clip) return;
    setClipLoading(true);
    setClipSrc(null);

    let mounted = true;
    fetchClipWithAuth(event.id)
      .then(({ blobUrl }) => {
        if (!mounted) return;
        setClipSrc(blobUrl);
        setClipLoading(false);
      })
      .catch(() => {
        if (mounted) setClipLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [event.has_clip, event.id]);

  const cachedSnapshot = blobUrls[event.id];
  const needsSnapshotFetch = event.has_snapshot && !cachedSnapshot && !blobUrls[event.id];

  useEffect(() => {
    if (!needsSnapshotFetch) return;
    setSnapshotLoading(true);
    let mounted = true;
    fetchSnapshotWithAuth(event.id)
      .then((url) => {
        if (!mounted) return;
        setBlobUrl(event.id, url);
        setSnapshotLoading(false);
      })
      .catch(() => {
        if (mounted) setSnapshotLoading(false);
      });
    return () => { mounted = false; };
  }, [event.id, needsSnapshotFetch, setBlobUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="ep-popup-overlay" onClick={onClose}>
      <div className="ep-popup ep-popup-lg" onClick={(e) => e.stopPropagation()}>
        <div className="ep-popup-header">
          <div className="ep-popup-title">
            <span className="ep-popup-icon" style={{ color: cfg.color, borderColor: cfg.color + "40" }}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d={cfg.icon} />
              </svg>
            </span>
            <span>{camLabel}</span>
            {event.is_protected && (
              <span title="Protegido" className="flex items-center">
                <svg viewBox="0 0 24 24" fill="#FBBF24" width="12" height="12">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </span>
            )}
            <span className="ep-popup-time">{date} {time}</span>
          </div>
          <div className="ep-popup-actions">
            {clipSrc && (
              <a
                href={clipSrc}
                download={`evento_${event.id}_${event.label}.mp4`}
                className="ep-popup-btn ep-popup-download"
                title="Descargar video"
              >
                <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Descargar clip
              </a>
            )}
            {!clipSrc && cachedSnapshot && (
              <a
                href={cachedSnapshot}
                download={snapshotName}
                className="ep-popup-btn ep-popup-download"
                title="Descargar foto"
              >
                <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Descargar foto
              </a>
            )}
            <button
              type="button"
              className="ep-popup-btn ep-popup-close"
              onClick={onClose}
            >
              <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ep-popup-status">
          <span className="ep-status-icon" style={{ color: cfg.color }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d={cfg.icon} />
            </svg>
          </span>
          <span className="ep-status-label" style={{ color: cfg.color, background: cfg.bg }}>
            {event.label}
          </span>
          {showScore && (
            <span className="ep-status-score mono">
              {Math.round((event.score ?? 0) * 100)}%
            </span>
          )}
          {event.zones.length > 0 && (
            <span className="ep-status-zone mono">{event.zones[0]}</span>
          )}
          {event.plate_number && (
            <span className="ep-status-plate">{event.plate_number}</span>
          )}
          {event.is_protected && (
            <span title="Protegido" className="flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="#FBBF24" width="12" height="12">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span className="mono text-[10px]" style={{ color: "#FBBF24" }}>Protegido</span>
            </span>
          )}
        </div>

        <div className="ep-popup-video">
          {clipLoading ? (
            <div className="ep-popup-loading">
              <span className="ep-card-img-spinner ep-popup-spinner" />
              <span>Cargando video...</span>
            </div>
          ) : clipSrc ? (
            <video
              src={clipSrc}
              controls
              autoPlay
              className="ep-popup-video-el"
            />
          ) : cachedSnapshot ? (
            <img src={cachedSnapshot} alt="" className="ep-popup-video-el" />
          ) : snapshotLoading ? (
            <div className="ep-popup-loading">
              <span className="ep-card-img-spinner ep-popup-spinner" />
              <span>Cargando snapshot...</span>
            </div>
          ) : (
            <div className="ep-popup-no-media">Sin video disponible</div>
          )}
        </div>
      </div>
    </div>,
    document.getElementById("vms-content") ?? document.body,
  );
}

interface Props {
  event: WsEvent;
  isNew?: boolean;
}

export default function EventCard({ event, isNew }: Props) {
  const cfg = labelCfg(event.label);
  const [, tick] = useState(0);
  const [popupOpen, setPopupOpen] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const blobUrls = useEventStore((s) => s.blobUrls);
  const setBlobUrl = useEventStore((s) => s.setBlobUrl);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!event.has_snapshot) return;
    if (imgSrc || imgError) return;

    const cached = blobUrls[event.id];
    if (cached) {
      setImgSrc(cached);
      return;
    }

    let mounted = true;
    fetchSnapshotWithAuth(event.id)
      .then((url) => {
        if (!mounted) return;
        setImgSrc(url);
        setBlobUrl(event.id, url);
      })
      .catch(() => {
        if (!mounted) setImgError(true);
      });

    return () => {
      mounted = false;
    };
  }, [event.id, event.has_snapshot, blobUrls, imgSrc, imgError, setBlobUrl]);

  const camLabel = event.camera_name ?? shortId(event.camera_id);
  const showScore = event.score != null && event.score > 0;
  const { date, time } = formatTs(event.timestamp);

  const hasMedia = event.has_clip || (event.has_snapshot && !imgError);

  return (
    <>
      <div
        className={`ep-card${isNew ? " new" : ""}${hasMedia ? " ep-card-clickable" : ""}`}
        style={{ borderLeftColor: cfg.color }}
        onClick={hasMedia ? () => setPopupOpen(true) : undefined}
      >
        {event.has_snapshot && !imgError && (
          <div className="ep-card-img">
            {imgSrc ? (
              <img src={imgSrc} alt="" loading="lazy" />
            ) : (
              <div className="ep-card-img-loading">
                <span className="ep-card-img-spinner" />
              </div>
            )}
            <div className="ep-card-img-overlay">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        <div className="ep-card-body">
          <div className="ep-card-top">
            <span className="ep-label-icon" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color + "30" }}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                <path d={cfg.icon} />
              </svg>
            </span>
            {event.sub_label && (
              <span className="ep-sublabel">{event.sub_label}</span>
            )}
            <span className="ep-time">
              {date} · {time}
            </span>
          </div>

          <div className="ep-camera">{camLabel}</div>

          <div className="ep-meta">
            {event.plate_number && (
              <span className="ep-plate">{event.plate_number}</span>
            )}
            {showScore && (
              <span className="ep-score mono">
                {Math.round((event.score ?? 0) * 100)}%
              </span>
            )}
            {event.zones.length > 0 && (
              <span className="ep-zone mono">{event.zones[0]}</span>
            )}
            {event.is_protected && (
              <span title="Evento protegido">
                <svg viewBox="0 0 24 24" fill="#FBBF24" width="11" height="11">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </div>

      {popupOpen && (
        <EventPopup event={event} onClose={() => setPopupOpen(false)} />
      )}
    </>
  );
}
