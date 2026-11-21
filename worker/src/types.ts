export interface BotRunSpec { botId: string; env: Record<string, string>; startCommand: string; memoryMb: number; cpus: number }
export interface InstallSpec { botId: string; allowScripts: boolean }
export interface RuntimeState {
  exists: true; containerId: string; running: boolean; restarting: boolean; paused: boolean; status: string;
  health: 'none' | 'starting' | 'healthy' | 'unhealthy'; exitCode: number | null; oomKilled: boolean;
  startedAt: string | null; restartCount: number; error: string | null;
}
export interface ContainerStats { cpuPercent: number; memoryBytes: number; memoryLimitBytes: number }
export interface HostInfo { reachable: boolean; version?: string; containersRunning?: number; error?: string }
export interface RuntimeLine { ts: string; stream: 'stdout' | 'stderr'; line: string }

export class RuntimeError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'RuntimeError'; }
}

/** Everything the backend needs from the container layer. Tests use an in-memory fake. */
export interface BotRuntime {
  ping(): Promise<HostInfo>;
  prepare(): Promise<void>;
  install(spec: InstallSpec, onLine: (line: string) => void): Promise<void>;
  start(spec: BotRunSpec): Promise<string>;
  stop(botId: string, timeoutSec?: number): Promise<void>;
  remove(botId: string): Promise<void>;
  inspect(botId: string): Promise<RuntimeState | null>;
  stats(botId: string): Promise<ContainerStats | null>;
  followLogs(botId: string, since: Date, onLine: (l: RuntimeLine) => void, onEnd: () => void): Promise<() => void>;
  listManagedIds(): Promise<string[]>;
}
