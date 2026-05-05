import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { Camera } from "../../api/cameras";
import { RecordingSegment } from "../../api/recordings";

const GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2",
  4: "grid-cols-2",
};

function vodUrl(camera: Camera, start: number, end: number) {
  return `/api/v1/recordings/vod/${camera.id}/start/${Math.floor(start)}/end/${Math.floor(end)}/index.m3u8`;
}

export type CameraPlayback = {
  camera: Camera;
  segments: RecordingSegment[];
};

interface HlsPlayerProps {
  url: string;
  displayName: string;
  segmentStart: number;
  segmentEnd: number;
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  onTimeUpdate: (t: number) => void;
  onSegmentEnded: (t: number) => void;
}

function HlsPlayer({
  url,
  displayName,
  segmentStart,
  segmentEnd,
  currentTime,
  playing,
  playbackRate,
  onTimeUpdate,
  onSegmentEnded,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isLeaderRef = useRef(false);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    setPlaybackError(false);
    hlsRef.current?.destroy();

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        xhrSetup: (xhr) => {
          const token = localStorage.getItem("access_token");
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        },
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal || data.response?.code === 404) setPlaybackError(true);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [url]);

  // Sync play/pause
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) { video.play().catch(() => {}); }
    else { video.pause(); }
  }, [playing, url]);

  // Seek when currentTime changes and we're not the leader (to avoid loop)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isLeaderRef.current) return;
    const target = currentTime - segmentStart;
    if (Math.abs(video.currentTime - target) > 1.5) {
      video.currentTime = Math.max(0, target);
    }
  }, [currentTime, segmentStart]);

  function handleTimeUpdate() {
    isLeaderRef.current = true;
    const video = videoRef.current;
    if (video) {
      const nextTime = Math.min(segmentEnd, segmentStart + video.currentTime);
      if (nextTime < currentTime - 0.5) return;
      if (nextTime + 0.25 >= segmentEnd) onSegmentEnded(segmentEnd);
      else onTimeUpdate(nextTime);
    }
    setTimeout(() => { isLeaderRef.current = false; }, 50);
  }

  return (
    <div className="video-thumb relative h-full w-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => onSegmentEnded(segmentEnd)}
        playsInline
        muted
      />
      <span className="mono absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] truncate rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
        {displayName}
      </span>
      {playbackError && (
        <div className="absolute inset-0 grid place-items-center bg-black/75">
          <span className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-xs text-[var(--text-2)]">
            Sin video
          </span>
        </div>
      )}
    </div>
  );
}

interface PlaybackViewProps {
  cameraPlayback: CameraPlayback[];
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  onTimeUpdate: (t: number) => void;
  onSegmentEnded: (t: number) => void;
}

export default function PlaybackView({
  cameraPlayback, currentTime, playing, playbackRate, onTimeUpdate, onSegmentEnded,
}: PlaybackViewProps) {
  const count = cameraPlayback.length;

  if (count === 0) {
    return (
      <div className="vms-card grid min-h-[280px] place-items-center p-6">
        <div className="text-center text-sm text-[var(--text-2)]">
          Selecciona hasta 4 cámaras para reproducir
        </div>
      </div>
    );
  }

  return (
    <div className={`grid gap-1.5 ${GRID[count] ?? "grid-cols-2"}`} style={{ minHeight: 280 }}>
      {cameraPlayback.map(({ camera, segments }) => {
        const activeSegment = segments.find((seg) => (
          currentTime >= seg.start_time && currentTime < seg.end_time
        ));

        if (!activeSegment) {
          return (
            <div key={camera.id} className="video-thumb relative flex aspect-video items-center justify-center bg-black/80">
              <span className="mono absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] truncate rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
                {camera.display_name}
              </span>
              <span className="text-xs text-[var(--text-3)]">Sin video</span>
            </div>
          );
        }

        return (
          <div key={camera.id} className="relative aspect-video">
            <HlsPlayer
              url={vodUrl(camera, activeSegment.start_time, activeSegment.end_time)}
              displayName={camera.display_name}
              segmentStart={activeSegment.start_time}
              segmentEnd={activeSegment.end_time}
              currentTime={currentTime}
              playing={playing}
              playbackRate={playbackRate}
              onTimeUpdate={onTimeUpdate}
              onSegmentEnded={onSegmentEnded}
            />
          </div>
        );
      })}
    </div>
  );
}
