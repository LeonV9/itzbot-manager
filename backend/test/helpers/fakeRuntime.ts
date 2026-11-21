import type { BotRuntime, BotRunSpec, RuntimeLine, RuntimeState } from '@itzbot/worker';

/** In-memory stand-in for Docker. Tests using this are MOCKED tests, not Docker integration tests. */
export class FakeRuntime implements BotRuntime {
  containers = new Map<string, { spec: BotRunSpec; running: boolean; startedAt: string }>();
  listeners = new Map<string, (l: RuntimeLine) => void>();
  installs: string[] = [];
  failStartWith: string | null = null;
  async ping() { return { reachable: true, version: 'fake', containersRunning: [...this.containers.values()].filter((c) => c.running).length }; }
  async prepare() {}
  async install(s: { botId: string }) { this.installs.push(s.botId); }
  async start(spec: BotRunSpec) {
    const ex = this.containers.get(spec.botId);
    if (ex?.running) throw Object.assign(new Error('dup'), { code: 'ALREADY_RUNNING' });
    this.containers.set(spec.botId, { spec, running: true, startedAt: new Date().toISOString() });
    setTimeout(() => this.listeners.get(spec.botId)?.({ ts: new Date().toISOString(), stream: 'stdout', line: 'Logged in as TestBot#0001' }), 20);
    return 'cid-' + spec.botId;
  }
  async stop(id: string) { const c = this.containers.get(id); if (c) c.running = false; }
  async remove(id: string) { this.containers.delete(id); }
  async inspect(id: string): Promise<RuntimeState | null> {
    const c = this.containers.get(id); if (!c) return null;
    return { exists: true, containerId: 'cid-' + id, running: c.running, restarting: false, paused: false, status: c.running ? 'running' : 'exited', health: 'healthy', exitCode: c.running ? null : 0, oomKilled: false, startedAt: c.startedAt, restartCount: 0, error: null };
  }
  async stats() { return { cpuPercent: 1.5, memoryBytes: 50_000_000, memoryLimitBytes: 268_435_456 }; }
  async followLogs(id: string, _s: Date, on: (l: RuntimeLine) => void) { this.listeners.set(id, on); return () => this.listeners.delete(id); }
  async listManagedIds() { return [...this.containers.keys()]; }
}
