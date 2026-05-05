import asyncio
import logging
import threading
import time
from collections import defaultdict
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)


class FrameBuffer:
    _instance: Optional["FrameBuffer"] = None

    def __init__(self):
        self._capture_threads: dict[str, threading.Thread] = {}
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._rtsp_urls: dict[str, str] = {}
        self._fps_settings: dict[str, float] = {}
        self._running: dict[str, bool] = {}

    @classmethod
    def get_instance(cls) -> "FrameBuffer":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def subscribe(
        self,
        camera_name: str,
        rtsp_url: str,
        fps: float = 1.0,
    ) -> asyncio.Queue:
        queue = asyncio.Queue(maxsize=30)
        self._queues[camera_name].append(queue)
        self._rtsp_urls[camera_name] = rtsp_url
        self._fps_settings[camera_name] = fps

        if camera_name not in self._capture_threads:
            self._running[camera_name] = True
            self._start_capture_thread(camera_name)

        return queue

    def unsubscribe(self, camera_name: str, queue: asyncio.Queue) -> None:
        if camera_name in self._queues:
            if queue in self._queues[camera_name]:
                self._queues[camera_name].remove(queue)

    def _start_capture_thread(self, camera_name: str) -> None:
        thread = threading.Thread(
            target=self._capture_loop,
            args=(camera_name,),
            daemon=True,
            name=f"frame-capture-{camera_name}",
        )
        thread.start()
        self._capture_threads[camera_name] = thread

    def _capture_loop(self, camera_name: str) -> None:
        rtsp_url = self._rtsp_urls.get(camera_name)
        fps = self._fps_settings.get(camera_name, 1.0)
        interval = 1.0 / fps

        while self._running.get(camera_name, False):
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                log.warning("FrameBuffer: cannot open stream for camera %s", camera_name)
                time.sleep(5)
                continue

            while self._running.get(camera_name, False) and cap.isOpened():
                start = time.monotonic()

                ret, frame = cap.read()
                if not ret:
                    break

                _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                h, w = frame.shape[:2]
                ts = time.time()

                for queue in self._queues.get(camera_name, []):
                    try:
                        queue.put_nowait((ts, jpeg.tobytes(), w, h))
                    except asyncio.QueueFull:
                        pass

                elapsed = time.monotonic() - start
                sleep_time = max(0.0, interval - elapsed)
                time.sleep(sleep_time)

            cap.release()
            if self._running.get(camera_name, False):
                time.sleep(2)

    def stop_capture(self, camera_name: str) -> None:
        self._running[camera_name] = False
        self._capture_threads.pop(camera_name, None)

    def stop_all(self) -> None:
        for cam in list(self._running.keys()):
            self._running[cam] = False
        self._capture_threads.clear()
        self._queues.clear()
        self._rtsp_urls.clear()
        self._fps_settings.clear()

    async def get_frame(
        self,
        camera_name: str,
        timeout: float = 5.0,
    ) -> Optional[tuple[float, bytes, int, int]]:
        queue = self._queues.get(camera_name, [None])[0]
        if queue is None:
            return None
        try:
            return await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None