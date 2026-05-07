import { useMemo } from "react";
import { useQuery } from "react-query";
import { getSystemMetrics, SystemMetrics } from "../../api/system";

export default function PerformancePanel() {
  const metricsQuery = useQuery("system-metrics", getSystemMetrics, {
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const metrics = metricsQuery.data;
  const health = useMemo(() => metrics ? overallHealth(metrics) : null, [metrics]);

  if (metricsQuery.isLoading) {
    return <div className="vms-card p-4 text-sm text-[var(--text-2)]">Cargando métricas del servidor...</div>;
  }

  if (metricsQuery.error || !metrics) {
    return <div className="vms-card p-4 text-sm text-[var(--warn)]">No se pudieron cargar las métricas del servidor.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard label="Estado" value={health?.label ?? "OK"} detail={health?.detail ?? ""} tone={health?.tone ?? "green"} />
        <SummaryCard label="CPU" value={`${fmtPct(metrics.cpu.total_pct)}`} detail={`${metrics.cpu.count_physical ?? "-"}C / ${metrics.cpu.count_logical ?? "-"}T`} tone={toneFor(metrics.cpu.total_pct)} />
        <SummaryCard label="Memoria" value={`${fmtPct(metrics.memory.percent)}`} detail={`${metrics.memory.used_gb} / ${metrics.memory.total_gb} GB`} tone={toneFor(metrics.memory.percent)} />
        <SummaryCard label="Disco" value={`${fmtPct(maxDisk(metrics))}`} detail={`${metrics.disks.length} montajes`} tone={toneFor(maxDisk(metrics))} />
        <SummaryCard label="Aceleradores" value={`${metrics.gpu.length + (metrics.igpu ? 1 : 0) + metrics.tpu.length}`} detail="GPU / iGPU / TPU" tone="info" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>CPU</h3>
            <span className="vms-pill info ml-auto">{metrics.cpu.freq_mhz ? `${metrics.cpu.freq_mhz} MHz` : "freq n/d"}</span>
          </div>
          <div className="space-y-3 p-4">
            <Meter label="Uso total" value={metrics.cpu.total_pct} />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <MetricCell label="Load 1m" value={metrics.cpu.load_1m} />
              <MetricCell label="Load 5m" value={metrics.cpu.load_5m} />
              <MetricCell label="I/O wait" value={`${fmtPct(metrics.cpu.iowait_pct)}`} />
            </div>
            <div className="grid grid-cols-4 gap-1">
              {metrics.cpu.per_core_pct.map((value, index) => (
                <CoreMeter key={index} index={index} value={value} />
              ))}
            </div>
          </div>
        </section>

        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>Memoria</h3>
            <span className="vms-pill green ml-auto">{metrics.memory.available_gb} GB libres</span>
          </div>
          <div className="space-y-3 p-4">
            <Meter label="RAM" value={metrics.memory.percent} detail={`${metrics.memory.used_gb} / ${metrics.memory.total_gb} GB`} />
            <Meter label="Swap" value={metrics.memory.swap_percent} detail={`${metrics.memory.swap_used_gb} / ${metrics.memory.swap_total_gb} GB`} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <MetricCell label="Cache" value={`${metrics.memory.cached_gb} GB`} />
              <MetricCell label="Buffers" value={`${metrics.memory.buffers_gb} GB`} />
            </div>
          </div>
        </section>

        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>Temperaturas</h3>
            <span className="vms-pill ml-auto">{metrics.temperature.cpu_package_c ?? "-"} C CPU</span>
          </div>
          <div className="space-y-3 p-4">
            <TempRow label="CPU package" value={metrics.temperature.cpu_package_c} />
            <TempRow label="NVMe" value={metrics.temperature.nvme_c} />
            <div className="max-h-28 space-y-1 overflow-auto pr-1">
              {metrics.temperature.cpu_cores.length ? metrics.temperature.cpu_cores.map((core) => (
                <TempRow key={core.label} label={core.label} value={core.temp_c} compact />
              )) : <div className="text-xs text-[var(--text-3)]">Sensores de cores no disponibles.</div>}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>Discos</h3>
            <span className="vms-pill info ml-auto">R {metrics.disk_io.read_total_gb} GB / W {metrics.disk_io.write_total_gb} GB</span>
          </div>
          <div className="space-y-3 p-4">
            {metrics.disks.map((disk) => (
              <Meter
                key={disk.mount}
                label={`${disk.label} ${disk.mount}`}
                value={disk.percent}
                detail={`${disk.used_gb} / ${disk.total_gb} GB, libres ${disk.free_gb} GB`}
              />
            ))}
          </div>
        </section>

        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>Red</h3>
            <span className="vms-pill green ml-auto">{metrics.network.length} interfaces</span>
          </div>
          <div className="overflow-x-auto">
            <table className="vms-table">
              <thead>
                <tr><th>NIC</th><th>RX</th><th>TX</th><th>Total RX</th><th>Total TX</th></tr>
              </thead>
              <tbody>
                {metrics.network.map((nic) => (
                  <tr key={nic.nic}>
                    <td className="mono">{nic.nic}</td>
                    <td>{nic.rx_mbps} MB/s</td>
                    <td>{nic.tx_mbps} MB/s</td>
                    <td>{nic.rx_total_mb} MB</td>
                    <td>{nic.tx_total_mb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>GPU / TPU</h3>
            <span className="vms-pill ml-auto">{metrics.gpu.length ? "NVIDIA" : metrics.igpu ? "iGPU" : "sin GPU dedicada"}</span>
          </div>
          <div className="space-y-3 p-4">
            {metrics.gpu.map((gpu) => (
              <div key={gpu.index} className="rounded border border-[var(--line)] bg-[var(--bg-2)]/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-0)]">{gpu.name}</span>
                  <span className="vms-pill info">{gpu.temp_c ?? "-"} C</span>
                </div>
                <Meter label="Uso GPU" value={gpu.util_pct} />
                <Meter label="VRAM" value={(gpu.vram_used_mb / Math.max(gpu.vram_total_mb, 1)) * 100} detail={`${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB`} />
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <MetricCell label="Power" value={gpu.power_w ? `${gpu.power_w} W` : "-"} />
                  <MetricCell label="Core clock" value={gpu.graphics_clock_mhz ? `${gpu.graphics_clock_mhz} MHz` : "-"} />
                  <MetricCell label="Mem clock" value={gpu.mem_clock_mhz ? `${gpu.mem_clock_mhz} MHz` : "-"} />
                </div>
              </div>
            ))}
            {metrics.igpu ? (
              <div className="rounded border border-[var(--line)] bg-[var(--bg-2)]/45 p-3">
                <div className="font-medium text-[var(--text-0)]">{metrics.igpu.name}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <MetricCell label="Vendor" value={metrics.igpu.vendor} />
                  <MetricCell label="Frecuencia" value={metrics.igpu.cur_freq_mhz ? `${metrics.igpu.cur_freq_mhz} MHz` : "-"} />
                </div>
              </div>
            ) : null}
            {metrics.tpu.map((tpu) => (
              <div key={`${tpu.type}-${tpu.path}`} className="flex items-center justify-between rounded border border-[var(--line)] bg-[var(--bg-2)]/45 p-3">
                <div>
                  <div className="font-medium text-[var(--text-0)]">{tpu.name}</div>
                  <div className="mono text-xs text-[var(--text-3)]">{tpu.type} · {tpu.path}</div>
                </div>
                <span className={`vms-pill ${tpu.available ? "green" : "warn"}`}>{tpu.available ? "disponible" : "no disponible"}</span>
              </div>
            ))}
            {!metrics.gpu.length && !metrics.igpu && !metrics.tpu.length ? (
              <div className="text-xs text-[var(--text-3)]">No se detectaron aceleradores desde el backend.</div>
            ) : null}
          </div>
        </section>

        <section className="vms-card">
          <div className="vms-card-hd">
            <h3>Backend y plugins</h3>
            <span className="vms-pill green ml-auto">{metrics.plugin_count} activos</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <MetricCell label="Backend CPU" value={`${fmtPct(metrics.process.cpu_pct)}`} />
              <MetricCell label="RSS" value={`${metrics.process.rss_mb} MB`} />
              <MetricCell label="VMS" value={`${metrics.process.vms_mb} MB`} />
            </div>
            <div className="max-h-64 overflow-auto rounded border border-[var(--line)]">
              <table className="vms-table">
                <thead>
                  <tr><th>Plugin</th><th>Tipo</th><th>Req.</th><th>RAM min.</th></tr>
                </thead>
                <tbody>
                  {metrics.plugins.map((plugin) => (
                    <tr key={plugin.name}>
                      <td>{plugin.display_name}</td>
                      <td>{plugin.category}</td>
                      <td>
                        <span className={`vms-pill ${plugin.requires_gpu ? "info" : ""}`}>{plugin.requires_gpu ? "GPU" : "CPU"}</span>
                        {plugin.supports_openvino ? <span className="vms-pill green ml-1">OpenVINO</span> : null}
                      </td>
                      <td>{plugin.min_ram_gb ? `${plugin.min_ram_gb} GB` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "green" | "warn" | "info" }) {
  return (
    <div className="vms-card p-4">
      <div className="text-[11px] uppercase text-[var(--text-3)]">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold text-[var(--text-0)]">{value}</span>
        <span className={`vms-pill ${tone}`}>{detail}</span>
      </div>
    </div>
  );
}

function Meter({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const tone = toneFor(value);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--text-1)]">{label}</span>
        <span className="mono text-[var(--text-3)]">{detail ?? fmtPct(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-[var(--bg-3)]">
        <div className={`h-full rounded ${barClass(tone)}`} style={{ width: `${clamp(value)}%` }} />
      </div>
    </div>
  );
}

function CoreMeter({ index, value }: { index: number; value: number }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--bg-2)]/45 p-1.5">
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="mono text-[var(--text-3)]">C{index}</span>
        <span className="mono text-[var(--text-2)]">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[var(--bg-3)]">
        <div className={`h-full rounded ${barClass(toneFor(value))}`} style={{ width: `${clamp(value)}%` }} />
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--bg-2)]/45 p-2">
      <div className="text-[10px] uppercase text-[var(--text-3)]">{label}</div>
      <div className="mt-1 font-medium text-[var(--text-0)]">{value}</div>
    </div>
  );
}

function TempRow({ label, value, compact }: { label: string; value: number | null; compact?: boolean }) {
  const temp = value ?? 0;
  const tone = value == null ? "info" : temp >= 85 ? "warn" : temp >= 70 ? "info" : "green";
  return (
    <div className={`flex items-center justify-between rounded border border-[var(--line)] bg-[var(--bg-2)]/45 ${compact ? "px-2 py-1" : "p-2"}`}>
      <span className="text-xs text-[var(--text-1)]">{label}</span>
      <span className={`vms-pill ${tone}`}>{value == null ? "n/d" : `${value} C`}</span>
    </div>
  );
}

function overallHealth(metrics: SystemMetrics): { label: string; detail: string; tone: "green" | "warn" | "info" } {
  const disk = maxDisk(metrics);
  const cpuTemp = metrics.temperature.cpu_package_c ?? 0;
  if (metrics.cpu.total_pct >= 90 || metrics.memory.percent >= 90 || disk >= 90 || cpuTemp >= 85) {
    return { label: "Atención", detail: "revisar carga", tone: "warn" };
  }
  if (metrics.cpu.total_pct >= 75 || metrics.memory.percent >= 75 || disk >= 80 || cpuTemp >= 70) {
    return { label: "Carga media", detail: "monitorear", tone: "info" };
  }
  return { label: "Normal", detail: "estable", tone: "green" };
}

function maxDisk(metrics: SystemMetrics) {
  return metrics.disks.reduce((max, disk) => Math.max(max, disk.percent), 0);
}

function toneFor(value: number): "green" | "warn" | "info" {
  if (value >= 85) return "warn";
  if (value >= 70) return "info";
  return "green";
}

function barClass(tone: "green" | "warn" | "info") {
  if (tone === "warn") return "bg-[var(--warn)]";
  if (tone === "info") return "bg-[var(--info)]";
  return "bg-[var(--acc)]";
}

function fmtPct(value: number) {
  return `${Math.round(value)}%`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
