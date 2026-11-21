import * as path from 'node:path';
import type Docker from 'dockerode';
import type { BotRunSpec, InstallSpec } from './types';

export const containerName = (botId: string) => `itzbot-${botId}`;
export const installerName = (botId: string) => `itzbot-${botId}-install`;

export interface SpecOptions { image: string; hostDataDir: string; network: string; pids: number }

const mb = (n: number) => Math.round(n * 1024 * 1024);
const hostPaths = (o: SpecOptions, botId: string) => {
  const base = path.posix.join(o.hostDataDir, 'bots', botId);
  return { src: `${base}/src`, data: `${base}/data` };
};

/** Hardened container definition for an (untrusted) bot. Pure function so it can be unit-tested. */
export function buildBotContainerOptions(o: SpecOptions, s: BotRunSpec): Docker.ContainerCreateOptions {
  const p = hostPaths(o, s.botId);
  return {
    name: containerName(s.botId),
    Image: o.image,
    Cmd: ['sh', '-c', s.startCommand],
    WorkingDir: '/app',
    User: '1000:1000',
    Env: [...Object.entries(s.env).map(([k, v]) => `${k}=${v}`), 'NODE_ENV=production', 'HOME=/tmp', 'DATA_DIR=/data'],
    Labels: { 'itzbot.managed': 'true', 'itzbot.role': 'bot', 'itzbot.bot-id': s.botId },
    StopTimeout: 20,
    Healthcheck: {
      Test: ['CMD-SHELL', 'pgrep -x node >/dev/null || exit 1'],
      Interval: 15e9, Timeout: 5e9, Retries: 3, StartPeriod: 20e9,
    },
    HostConfig: {
      Binds: [`${p.src}:/app:ro`, `${p.data}:/data:rw`],
      Privileged: false,
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,nosuid,size=64m' },
      Memory: mb(s.memoryMb),
      MemorySwap: mb(s.memoryMb), // equal to Memory => no swap
      NanoCpus: Math.round(s.cpus * 1e9),
      PidsLimit: o.pids,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      NetworkMode: o.network,
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      Ulimits: [{ Name: 'nofile', Soft: 4096, Hard: 4096 }],
    },
  } as Docker.ContainerCreateOptions;
}

/** One-off container that runs `npm install` against the bot's source directory. */
export function buildInstallContainerOptions(o: SpecOptions, s: InstallSpec, memoryMb = 512): Docker.ContainerCreateOptions {
  const p = hostPaths(o, s.botId);
  const flags = `--omit=dev --no-audit --no-fund --loglevel=warn${s.allowScripts ? '' : ' --ignore-scripts'}`;
  return {
    name: installerName(s.botId),
    Image: o.image,
    Cmd: ['sh', '-c', `npm install ${flags}`],
    WorkingDir: '/app',
    User: '1000:1000',
    Env: ['HOME=/tmp', 'npm_config_cache=/tmp/.npm', 'CI=true'],
    Labels: { 'itzbot.managed': 'true', 'itzbot.role': 'installer', 'itzbot.bot-id': s.botId },
    HostConfig: {
      Binds: [`${p.src}:/app:rw`],
      Privileged: false,
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,nosuid,size=512m' },
      Memory: mb(memoryMb), MemorySwap: mb(memoryMb), NanoCpus: 1e9, PidsLimit: o.pids,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], NetworkMode: o.network,
    },
  } as Docker.ContainerCreateOptions;
}
