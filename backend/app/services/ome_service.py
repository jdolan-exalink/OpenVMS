"""OMEService — builds OvenMediaEngine stream URLs for cameras."""

from app.config import settings


class OMEService:
    @staticmethod
    def build_stream_urls(server_id: str, camera_name: str) -> dict[str, str]:
        """
        Stream name pattern: {server_id}_{camera_name}
        Returns OME WebRTC and LL-HLS URLs for both main and sub streams.
        """
        base = f"{server_id}_{camera_name}"
        return {
            "ome_stream_main": f"{settings.ome_webrtc_base}/{base}",
            "ome_stream_sub": f"{settings.ome_webrtc_base}/{base}_sub",
            "llhls_main": f"{settings.ome_llhls_base}/{base}/llhls.m3u8",
            "llhls_sub": f"{settings.ome_llhls_base}/{base}_sub/llhls.m3u8",
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
