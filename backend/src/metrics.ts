import * as os from 'node:os';
import { statfs } from 'node:fs/promises';
import si from 'systeminformation';
import type { HostMetrics } from '@itzbot/shared';

/** Real host metrics. Disk figures describe the volume that stores bot data. */
export async function hostMetrics(dataDir: string): Promise<HostMetrics> {
  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  let diskTotal = 0, diskUsed = 0;
  try {
    const s = await statfs(dataDir);
    diskTotal = s.blocks * s.bsize; diskUsed = (s.blocks - s.bavail) * s.bsize;
  } catch { /* data dir missing: report zeros rather than invent numbers */ }
  return {
    cpuPercent: Math.round(load.currentLoad * 10) / 10, cores: os.cpus().length,
    memUsedBytes: mem.total - mem.available, memTotalBytes: mem.total,
    diskUsedBytes: diskUsed, diskTotalBytes: diskTotal, hostUptimeSeconds: Math.floor(os.uptime()),
  };
}
