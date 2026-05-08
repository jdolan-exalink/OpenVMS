"""OMEService — builds OvenMediaEngine stream URLs for cameras."""

from app.config import settings


class OMEService:
    @staticmethod
    def build_stream_urls(
        server_id: str,
        camera_name: str,
        webrtc_base: str | None = None,
        llhls_base: str | None = None,
    ) -> dict[str, str]:
        """
        Stream name pattern: {server_id}_{camera_name}
        Returns OME WebRTC and LL-HLS URLs for both main and sub streams.
        Optional webrtc_base/llhls_base override settings values.
        """
        rtc = webrtc_base if webrtc_base is not None else settings.ome_webrtc_base
        hls = llhls_base if llhls_base is not None else settings.ome_llhls_base
        base = f"{server_id}_{camera_name}"
        return {
            "ome_stream_main": f"{rtc}/{base}",
            "ome_stream_sub": f"{rtc}/{base}_sub",
            "llhls_main": f"{hls}/{base}/llhls.m3u8",
            "llhls_sub": f"{hls}/{base}_sub/llhls.m3u8",
        }

    @staticmethod
    def get_stream_for_grid(camera: object, grid_size: int) -> dict[str, str | None]:
        """
        Use substream automatically for grids >= 4×4 (16+ cells).
        Falls back to main stream if substream not available.
        """
        use_sub = grid_size >= 9 and bool(camera.ome_stream_sub)  # type: ignore[attr-defined]
        return {
            "webrtc": camera.ome_stream_sub if use_sub else camera.ome_stream_main,  # type: ignore[attr-defined]
            "llhls": camera.llhls_sub if use_sub else camera.llhls_main,  # type: ignore[attr-defined]
        }
