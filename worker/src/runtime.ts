import Docker from 'dockerode';
import { Writable } from 'node:stream';
import { buildBotContainerOptions, buildInstallContainerOptions, containerName, installerName, SpecOptions } from './spec';
import {
  BotRunSpec, BotRuntime, ContainerStats, HostInfo, InstallSpec, RuntimeError, RuntimeLine, RuntimeState,
} from './types';

export interface DockerRuntimeOptions extends SpecOptions { docker: Docker; installTimeoutMs?: number }

function lineWriter(cb: (line: string) => void): Writable {
  let buf = '';
  return new Writable({
    write(chunk, _enc, done) {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { cb(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
      done();
    },
    final(done) { if (buf) cb(buf); done(); },
  });
}

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const wrap = (code: string, e: unknown) =>
  e instanceof RuntimeError ? e : new RuntimeError(code, `${code === 'DOCKER_UNAVAILABLE' ? 'Docker is not reachable' : 'Docker error'}: ${msg(e)}`);

export class DockerRuntime implements BotRuntime {
  private docker: Docker;
  constructor(private o: DockerRuntimeOptions) { this.docker = o.docker; }

  async ping(): Promise<HostInfo> {
    try {
      const [v, info] = await Promise.all([this.docker.version(), this.docker.info()]);
      return { reachable: true, version: v.Version, containersRunning: info.ContainersRunning };
    } catch (e) { return { reachable: false, error: msg(e) }; }
  }

  /** Pull the bot image (if missing) and create the isolated bot network (inter-container traffic disabled). */
  async prepare(): Promise<void> {
    try {
      try { await this.docker.getImage(this.o.image).inspect(); }
      catch {
        await new Promise<void>((resolve, reject) =>
          this.docker.pull(this.o.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            this.docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
          }));
      }
      const nets = await this.docker.listNetworks({ filters: { name: [this.o.network] } });
      if (!nets.some((n) => n.Name === this.o.network)) {
        await this.docker.createNetwork({
          Name: this.o.network, Driver: 'bridge',
          Options: { 'com.docker.network.bridge.enable_icc': 'false' },
          Labels: { 'itzbot.managed': 'true' },
        });
      }
    } catch (e) { throw wrap('DOCKER_UNAVAILABLE', e); }
  }

  async install(spec: InstallSpec, onLine: (l: string) => void): Promise<void> {
    await this.removeByName(installerName(spec.botId));
    let c: Docker.Container;
    try { c = await this.docker.createContainer(buildInstallContainerOptions(this.o, spec)); }
    catch (e) { throw wrap('DOCKER_UNAVAILABLE', e); }
    const tail: string[] = [];
    const push = (l: string) => { tail.push(l); if (tail.length > 15) tail.shift(); onLine(l); };
    try {
      await c.start();
      const stream = (await c.logs({ follow: true, stdout: true, stderr: true })) as unknown as NodeJS.ReadableStream;
      this.docker.modem.demuxStream(stream, lineWriter(push), lineWriter(push));
      const timer = setTimeout(() => { c.kill().catch(() => undefined); }, this.o.installTimeoutMs ?? 10 * 60_000);
      const res = await c.wait();
      clearTimeout(timer);
      if (res.StatusCode !== 0) {
        throw new RuntimeError('INSTALL_FAILED', `npm install failed (exit code ${res.StatusCode}). Last output: ${tail.slice(-5).join(' | ')}`);
      }
    } catch (e) { throw e instanceof RuntimeError ? e : wrap('INSTALL_FAILED', e); }
    finally { await c.remove({ force: true }).catch(() => undefined); }
  }

  async start(spec: BotRunSpec): Promise<string> {
    const existing = await this.inspect(spec.botId);
    if (existing && (existing.running || existing.restarting)) throw new RuntimeError('ALREADY_RUNNING', 'This bot already has a running container.');
    if (existing) await this.remove(spec.botId);
    let c: Docker.Container;
    try { c = await this.docker.createContainer(buildBotContainerOptions(this.o, spec)); }
    catch (e) { throw wrap(status(e) === 409 ? 'ALREADY_RUNNING' : 'CREATE_FAILED', e); }
    try { await c.start(); } catch (e) { await c.remove({ force: true }).catch(() => undefined); throw wrap('START_FAILED', e); }
    return c.id;
  }

  async stop(botId: string, timeoutSec = 20): Promise<void> {
    try { await this.docker.getContainer(containerName(botId)).stop({ t: timeoutSec }); }
    catch (e) { if (status(e) !== 304 && status(e) !== 404) throw wrap('STOP_FAILED', e); }
  }

  async remove(botId: string): Promise<void> { await this.removeByName(containerName(botId)); }
  private async removeByName(name: string): Promise<void> {
    try { await this.docker.getContainer(name).remove({ force: true, v: true }); }
    catch (e) { if (status(e) !== 404) throw wrap('REMOVE_FAILED', e); }
  }

  async inspect(botId: string): Promise<RuntimeState | null> {
    try {
      const i = await this.docker.getContainer(containerName(botId)).inspect();
      const h = i.State.Health?.Status;
      return {
        exists: true, containerId: i.Id, running: !!i.State.Running, restarting: !!i.State.Restarting, paused: !!i.State.Paused,
        status: i.State.Status, health: h === 'healthy' || h === 'unhealthy' || h === 'starting' ? h : 'none',
        exitCode: i.State.Running ? null : i.State.ExitCode ?? null, oomKilled: !!i.State.OOMKilled,
        startedAt: i.State.StartedAt && !i.State.StartedAt.startsWith('0001') ? i.State.StartedAt : null,
        restartCount: i.RestartCount ?? 0, error: i.State.Error || null,
      };
    } catch (e) { if (status(e) === 404) return null; throw wrap('DOCKER_UNAVAILABLE', e); }
  }

  async stats(botId: string): Promise<ContainerStats | null> {
    try {
      const s = (await this.docker.getContainer(containerName(botId)).stats({ stream: false })) as any;
      const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats?.system_cpu_usage ?? 0);
      const cpus = s.cpu_stats.online_cpus ?? s.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
      const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
      return {
        cpuPercent: sysDelta > 0 && cpuDelta >= 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0,
        memoryBytes: Math.max(0, (s.memory_stats?.usage ?? 0) - cache),
        memoryLimitBytes: s.memory_stats?.limit ?? 0,
      };
    } catch (e) { if (status(e) === 404 || status(e) === 409) return null; throw wrap('DOCKER_UNAVAILABLE', e); }
  }

  async followLogs(botId: string, since: Date, onLine: (l: RuntimeLine) => void, onEnd: () => void): Promise<() => void> {
    const c = this.docker.getContainer(containerName(botId));
    const stream = (await c.logs({
      follow: true, stdout: true, stderr: true, timestamps: true, since: Math.floor(since.getTime() / 1000),
    })) as unknown as NodeJS.ReadableStream & { destroy?: () => void };
    const mk = (s: 'stdout' | 'stderr') => lineWriter((raw) => {
      const sp = raw.indexOf(' ');
      onLine(sp > 0 ? { ts: raw.slice(0, sp), stream: s, line: raw.slice(sp + 1) } : { ts: new Date().toISOString(), stream: s, line: raw });
    });
    this.docker.modem.demuxStream(stream, mk('stdout'), mk('stderr'));
    let ended = false;
    const end = () => { if (!ended) { ended = true; onEnd(); } };
    stream.on('end', end); stream.on('close', end); stream.on('error', end);
    return () => { ended = true; stream.destroy?.(); };
  }

  async listManagedIds(): Promise<string[]> {
    const list = await this.docker.listContainers({ all: true, filters: { label: ['itzbot.managed=true', 'itzbot.role=bot'] } });
    return list.map((c) => c.Labels['itzbot.bot-id']).filter(Boolean);
  }
}
