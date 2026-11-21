export const MAX_BOTS = 10;
export type BotStatus = 'online' | 'offline' | 'starting' | 'installing' | 'restarting' | 'unhealthy' | 'error';
export type LogStream = 'stdout' | 'stderr' | 'system';

export interface BotConfigView {
  startCommand: string; entryFile: string | null; envKeys: string[];
  memoryMb: number | null; cpus: number | null; allowInstallScripts: boolean;
}
export interface BotView {
  id: string; name: string; applicationId: string; sourceType: 'github' | 'zip' | 'manual' | null;
  sourceUrl: string | null; hasSource: boolean; hasToken: true; config: BotConfigView;
  status: BotStatus; uptimeSeconds: number; restartCount: number; lastExitCode: number | null;
  lastError: string | null; health: string; createdAt: string;
}
export interface Analysis {
  hasPackageJson: boolean; name?: string; main?: string; scripts: Record<string, string>;
  dependencies: Record<string, string>; discordLib?: { name: string; version: string };
  entryCandidates: string[]; suggestedEntry: string | null; suggestedStartCommand: string | null;
  warnings: string[]; fileCount: number; envKeysFound: string[];
}
export interface LogEntry { id?: number; botId: string; ts: string; stream: LogStream; line: string }
export interface HostMetrics {
  cpuPercent: number; cores: number; memUsedBytes: number; memTotalBytes: number;
  diskUsedBytes: number; diskTotalBytes: number; hostUptimeSeconds: number;
}
export interface ServerStatus {
  status: 'healthy' | 'degraded'; docker: { reachable: boolean; version?: string; error?: string };
  database: { ok: boolean }; host: HostMetrics; runningContainers: number;
  backend: { version: string; uptimeSeconds: number }; totalBotUptimeSeconds: number;
  perBot: { botId: string; name: string; cpuPercent: number; memoryBytes: number; memoryLimitBytes: number; uptimeSeconds: number }[];
}
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }
