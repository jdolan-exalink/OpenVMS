"""
System performance metrics endpoint.
GET /api/v1/system/metrics  — real-time CPU, RAM, disk, GPU, temperature, network stats.
"""
import os
import time
from typing import Any

import psutil
from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.plugins.registry import plugin_registry

router = APIRouter()

# ── network delta tracking ────────────────────────────────────────────────────

_last_net: dict[str, tuple[float, int, int]] = {}  # nic → (ts, bytes_sent, bytes_recv)


def _net_rates() -> list[dict[str, Any]]:
    now = time.monotonic()
    counters = psutil.net_io_counters(pernic=True)
    rates: list[dict[str, Any]] = []
    skip = {"lo"}
    for nic, c in counters.items():
        if nic in skip:
            continue
        prev = _last_net.get(nic)
        if prev:
            dt = max(now - prev[0], 0.001)
            tx_bps = max(0, (c.bytes_sent - prev[1]) / dt)
            rx_bps = max(0, (c.bytes_recv - prev[2]) / dt)
        else:
            tx_bps = rx_bps = 0.0
        _last_net[nic] = (now, c.bytes_sent, c.bytes_recv)
        rates.append({
            "nic": nic,
            "tx_mbps": round(tx_bps / 1_000_000, 3),
            "rx_mbps": round(rx_bps / 1_000_000, 3),
            "tx_total_mb": round(c.bytes_sent / 1_000_000, 1),
            "rx_total_mb": round(c.bytes_recv / 1_000_000, 1),
        })
    return rates


# ── temperature readers ────────────────────────────────────────────────────────

def _cpu_temps() -> dict[str, Any]:
    """Read package and core temperatures from coretemp hwmon."""
    result: dict[str, Any] = {"package_c": None, "cores": []}
    hwmon_base = "/sys/class/hwmon"
    if not os.path.isdir(hwmon_base):
        return result
    for hw in sorted(os.listdir(hwmon_base)):
        name_path = os.path.join(hwmon_base, hw, "name")
        try:
            name = open(name_path).read().strip()
        except OSError:
            continue
        if name != "coretemp":
            continue
        hw_path = os.path.join(hwmon_base, hw)
        temps: list[dict[str, Any]] = []
        for fname in sorted(os.listdir(hw_path)):
            if not fname.endswith("_input"):
                continue
            label_file = os.path.join(hw_path, fname.replace("_input", "_label"))
            input_file = os.path.join(hw_path, fname)
            try:
                label = open(label_file).read().strip()
                value_mc = int(open(input_file).read().strip())
                value_c = round(value_mc / 1000, 1)
            except (OSError, ValueError):
                continue
            if "Package" in label:
                result["package_c"] = value_c
            elif "Core" in label:
                temps.append({"label": label, "temp_c": value_c})
        result["cores"] = temps
        break  # only one coretemp sensor needed
    return result


def _nvme_temp() -> float | None:
    hwmon_base = "/sys/class/hwmon"
    if not os.path.isdir(hwmon_base):
        return None
    for hw in os.listdir(hwmon_base):
        name_path = os.path.join(hwmon_base, hw, "name")
        try:
            name = open(name_path).read().strip()
        except OSError:
            continue
        if name == "nvme":
            try:
                val = int(open(os.path.join(hwmon_base, hw, "temp1_input")).read().strip())
                return round(val / 1000, 1)
            except (OSError, ValueError):
                pass
    return None


# ── NVIDIA GPU ────────────────────────────────────────────────────────────────

def _gpu_stats() -> list[dict[str, Any]]:
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        gpus = []
        for i in range(count):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = pynvml.nvmlDeviceGetName(h)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
            try:
                power_mw = pynvml.nvmlDeviceGetPowerUsage(h)
                power_limit_mw = pynvml.nvmlDeviceGetPowerManagementLimit(h)
                power_w = round(power_mw / 1000, 1)
                power_limit_w = round(power_limit_mw / 1000, 1)
            except pynvml.NVMLError:
                power_w = power_limit_w = None
            try:
                gr_clk = pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_GRAPHICS)
                mem_clk = pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_MEM)
            except pynvml.NVMLError:
                gr_clk = mem_clk = None
            gpus.append({
                "index": i,
                "name": name,
                "util_pct": util.gpu,
                "mem_util_pct": util.memory,
                "vram_used_mb": mem.used // (1024 * 1024),
                "vram_total_mb": mem.total // (1024 * 1024),
                "vram_free_mb": mem.free // (1024 * 1024),
                "temp_c": temp,
                "power_w": power_w,
                "power_limit_w": power_limit_w,
                "graphics_clock_mhz": gr_clk,
                "mem_clock_mhz": mem_clk,
            })
        pynvml.nvmlShutdown()
        return gpus
    except Exception:
        return []


def _igpu_info() -> dict[str, Any] | None:
    """Read Intel iGPU info from DRI sysfs (utilization not available without intel_gpu_top)."""
    # Try reading from card devices in /sys/class/drm
    dri_base = "/sys/class/drm"
    if not os.path.isdir(dri_base):
        return None
    for card in sorted(os.listdir(dri_base)):
        if not card.startswith("card") or "render" in card:
            continue
        vendor_path = os.path.join(dri_base, card, "device", "vendor")
        device_path = os.path.join(dri_base, card, "device", "device")
        try:
            vendor = open(vendor_path).read().strip()
        except OSError:
            continue
        if vendor != "0x8086":  # Intel vendor ID
            continue
        try:
            device_id = open(device_path).read().strip()
        except OSError:
            device_id = "unknown"
        # Try frequency
        freq_path = os.path.join(dri_base, card, "device", "drm", card, "gt_cur_freq_mhz")
        cur_freq = None
        try:
            cur_freq = int(open(freq_path).read().strip())
        except (OSError, ValueError):
            pass
        return {
            "name": f"Intel UHD Graphics (device {device_id})",
            "vendor": "Intel",
            "util_pct": None,
            "cur_freq_mhz": cur_freq,
        }
    return None


# ── plugin stats ──────────────────────────────────────────────────────────────

def _plugin_stats() -> list[dict[str, Any]]:
    active = plugin_registry.get_active()
    return [
        {
            "name": plugin.name,
            "display_name": getattr(plugin, "display_name", None) or plugin.name,
            "version": plugin.version,
            "category": getattr(plugin, "category", "other"),
            "requires_gpu": plugin.requires_gpu,
            "supports_openvino": plugin.supports_openvino,
            "min_ram_gb": getattr(plugin, "min_ram_gb", None),
        }
        for plugin in active.values()
    ]


# ── endpoint ──────────────────────────────────────────────────────────────────

@router.get("/metrics")
async def get_metrics(_=Depends(get_current_user)) -> dict[str, Any]:
    # CPU
    cpu_pct_total = psutil.cpu_percent(interval=None)
    cpu_pct_per_core = psutil.cpu_percent(interval=None, percpu=True)
    cpu_freq = psutil.cpu_freq()
    load1, load5, load15 = psutil.getloadavg()
    cpu_count_logical = psutil.cpu_count(logical=True)
    cpu_count_physical = psutil.cpu_count(logical=False)
    cpu_times = psutil.cpu_times_percent(interval=None)

    # Memory
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # Disk
    disks: list[dict[str, Any]] = []
    disk_targets = [("/", "Sistema")]
    if os.path.ismount("/mnt/cctv"):
        disk_targets.append(("/mnt/cctv", "CCTV"))
    for mount, label in disk_targets:
        try:
            d = psutil.disk_usage(mount)
            io = psutil.disk_io_counters(perdisk=False)
            disks.append({
                "mount": mount,
                "label": label,
                "total_gb": round(d.total / 1e9, 1),
                "used_gb": round(d.used / 1e9, 1),
                "free_gb": round(d.free / 1e9, 1),
                "percent": d.percent,
            })
        except PermissionError:
            pass

    # Temperatures
    cpu_temp = _cpu_temps()
    nvme_temp = _nvme_temp()

    # GPU
    gpus = _gpu_stats()
    igpu = _igpu_info()

    # Network
    net = _net_rates()

    # Plugins
    plugins = _plugin_stats()

    # Process-level stats for this backend
    proc = psutil.Process()
    proc_mem = proc.memory_info()

    return {
        "cpu": {
            "total_pct": cpu_pct_total,
            "per_core_pct": cpu_pct_per_core,
            "count_logical": cpu_count_logical,
            "count_physical": cpu_count_physical,
            "freq_mhz": round(cpu_freq.current, 0) if cpu_freq else None,
            "freq_max_mhz": round(cpu_freq.max, 0) if cpu_freq else None,
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2),
            "user_pct": round(cpu_times.user, 1),
            "system_pct": round(cpu_times.system, 1),
            "idle_pct": round(cpu_times.idle, 1),
            "iowait_pct": round(getattr(cpu_times, "iowait", 0), 1),
        },
        "memory": {
            "total_gb": round(mem.total / 1e9, 2),
            "used_gb": round(mem.used / 1e9, 2),
            "available_gb": round(mem.available / 1e9, 2),
            "buffers_gb": round(mem.buffers / 1e9, 2),
            "cached_gb": round(mem.cached / 1e9, 2),
            "percent": mem.percent,
            "swap_total_gb": round(swap.total / 1e9, 2),
            "swap_used_gb": round(swap.used / 1e9, 2),
            "swap_percent": swap.percent,
        },
        "disks": disks,
        "temperature": {
            "cpu_package_c": cpu_temp["package_c"],
            "cpu_cores": cpu_temp["cores"],
            "nvme_c": nvme_temp,
        },
        "gpu": gpus,
        "igpu": igpu,
        "network": net,
        "process": {
            "rss_mb": round(proc_mem.rss / 1e6, 1),
            "vms_mb": round(proc_mem.vms / 1e6, 1),
            "cpu_pct": round(proc.cpu_percent(interval=None), 1),
        },
        "plugins": plugins,
        "plugin_count": len(plugins),
    }
