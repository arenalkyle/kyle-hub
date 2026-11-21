import { execFile } from "node:child_process";
import os from "node:os";

export interface SensorSample {
  at: number;
  cpuLoad: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpu?: { name: string; load: number; memUsedMb: number; memTotalMb: number; tempC: number; powerW: number };
}

export type MetricId = "cpu" | "ram" | "gpuLoad" | "gpuMem" | "gpuTemp" | "gpuPower";

export interface MetricSpec {
  id: MetricId;
  label: string;
  unit: string;
  max: (s: SensorSample) => number;
  value: (s: SensorSample) => number | undefined;
}

const GB = 1024 ** 3;
export const METRICS: MetricSpec[] = [
  { id: "cpu", label: "CPU load", unit: "%", max: () => 100, value: (s) => s.cpuLoad },
  { id: "ram", label: "RAM", unit: " GB", max: (s) => s.ramTotalGb, value: (s) => s.ramUsedGb },
  { id: "gpuLoad", label: "GPU load", unit: "%", max: () => 100, value: (s) => s.gpu?.load },
  { id: "gpuMem", label: "GPU memory", unit: " MB", max: (s) => s.gpu?.memTotalMb ?? 1, value: (s) => s.gpu?.memUsedMb },
  { id: "gpuTemp", label: "GPU temp", unit: " °C", max: () => 100, value: (s) => s.gpu?.tempC },
  { id: "gpuPower", label: "GPU power", unit: " W", max: () => 220, value: (s) => s.gpu?.powerW },
];

/** Parses one `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits` line. */
export function parseNvidiaSmi(out: string): SensorSample["gpu"] | undefined {
  const line = out.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!line) return undefined;
  const [name, load, used, total, temp, power] = line.split(",").map((s) => s.trim());
  const n = (v: string | undefined): number => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : 0);
  if (!name) return undefined;
  return { name, load: n(load), memUsedMb: n(used), memTotalMb: n(total), tempC: n(temp), powerW: n(power) };
}

const readGpu = (): Promise<SensorSample["gpu"]> =>
  new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 3000 }, (err, stdout) => resolve(err ? undefined : parseNvidiaSmi(stdout)));
  });

const cpuTimes = (): { idle: number; total: number } => {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
};

/** Polls CPU, RAM and (when `nvidia-smi` exists) GPU, keeping a ring buffer for the charts. */
export class SensorSampler {
  private prev = cpuTimes();
  private timer: number | null = null;
  readonly history: SensorSample[] = [];

  constructor(private max = 90, private onSample: () => void = () => {}) {}

  start(intervalMs = 2000): void {
    if (this.timer !== null) return;
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = cpuTimes();
    const dTotal = now.total - this.prev.total;
    const dIdle = now.idle - this.prev.idle;
    this.prev = now;
    const gpu = await readGpu();
    const total = os.totalmem();
    this.history.push({
      at: Date.now(),
      cpuLoad: dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0,
      ramUsedGb: (total - os.freemem()) / GB,
      ramTotalGb: total / GB,
      ...(gpu ? { gpu } : {}),
    });
    if (this.history.length > this.max) this.history.shift();
    this.onSample();
  }
}

/** SVG polyline points (0..width, 0..height) for a metric's history; `undefined` samples break nothing, they are skipped. */
export function sparkPoints(history: readonly SensorSample[], spec: MetricSpec, width: number, height: number, capacity: number): string {
  const pts: string[] = [];
  const last = history[history.length - 1];
  const max = Math.max(1, last ? spec.max(last) : 1);
  const offset = capacity - history.length;
  history.forEach((s, i) => {
    const v = spec.value(s);
    if (v === undefined) return;
    const x = ((offset + i) / Math.max(1, capacity - 1)) * width;
    const y = height - (Math.min(v, max) / max) * height;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}
