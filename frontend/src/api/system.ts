import { apiClient } from "./client";

export type CpuMetrics = {
  total_pct: number;
  per_core_pct: number[];
  count_logical: number | null;
  count_physical: number | null;
  freq_mhz: number | null;
  freq_max_mhz: number | null;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  user_pct: number;
  system_pct: number;
  idle_pct: number;
  iowait_pct: number;
};

export type MemoryMetrics = {
  total_gb: number;
  used_gb: number;
  available_gb: number;
  buffers_gb: number;
  cached_gb: number;
  percent: number;
  swap_total_gb: number;
  swap_used_gb: number;
  swap_percent: number;
};

export type DiskMetrics = {
  mount: string;
  label: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
};

export type DiskIoMetrics = {
  read_total_gb: number;
  write_total_gb: number;
  read_count: number;
  write_count: number;
};

export type GpuMetrics = {
  index: number;
  name: string;
  util_pct: number;
  mem_util_pct: number;
  vram_used_mb: number;
  vram_total_mb: number;
  vram_free_mb: number;
  temp_c: number | null;
  power_w: number | null;
  power_limit_w: number | null;
  graphics_clock_mhz: number | null;
  mem_clock_mhz: number | null;
};

export type IgpuMetrics = {
  name: string;
  vendor: string;
  util_pct: number | null;
  cur_freq_mhz: number | null;
};

export type TpuMetrics = {
  name: string;
  type: string;
  path: string;
  available: boolean;
  util_pct: number | null;
  temp_c: number | null;
};

export type NetworkMetrics = {
  nic: string;
  tx_mbps: number;
  rx_mbps: number;
  tx_total_mb: number;
  rx_total_mb: number;
};

export type PluginRuntimeMetrics = {
  name: string;
  display_name: string;
  version: string;
  category: string;
  requires_gpu: boolean;
  supports_openvino: boolean;
  min_ram_gb: number | null;
};

export type SystemMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disks: DiskMetrics[];
  disk_io: DiskIoMetrics;
  temperature: {
    cpu_package_c: number | null;
    cpu_cores: { label: string; temp_c: number }[];
    nvme_c: number | null;
  };
  gpu: GpuMetrics[];
  igpu: IgpuMetrics | null;
  tpu: TpuMetrics[];
  network: NetworkMetrics[];
  process: {
    rss_mb: number;
    vms_mb: number;
    cpu_pct: number;
  };
  plugins: PluginRuntimeMetrics[];
  plugin_count: number;
};

export async function getSystemMetrics() {
  const { data } = await apiClient.get<SystemMetrics>("/system/metrics");
  return data;
}
