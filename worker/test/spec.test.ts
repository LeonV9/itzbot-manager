import { describe, expect, it } from 'vitest';
import { buildBotContainerOptions, buildInstallContainerOptions } from '../src/spec';

const o = { image: 'node:20-alpine', hostDataDir: '/opt/itzbot/data', network: 'itzbot-bots', pids: 128 };
const id = '11111111-2222-3333-4444-555555555555';

describe('bot container hardening (pure unit tests, no Docker needed)', () => {
  const c: any = buildBotContainerOptions(o, { botId: id, env: { DISCORD_TOKEN: 'x' }, startCommand: 'node index.js', memoryMb: 256, cpus: 0.5 });
  it('is unprivileged with all capabilities dropped', () => {
    expect(c.HostConfig.Privileged).toBe(false);
    expect(c.HostConfig.CapDrop).toEqual(['ALL']);
    expect(c.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
  });
  it('has resource limits and no swap', () => {
    expect(c.HostConfig.Memory).toBe(256 * 1024 * 1024);
    expect(c.HostConfig.MemorySwap).toBe(c.HostConfig.Memory);
    expect(c.HostConfig.NanoCpus).toBe(5e8);
    expect(c.HostConfig.PidsLimit).toBe(128);
  });
  it('uses a read-only root fs, read-only source mount and non-root user', () => {
    expect(c.HostConfig.ReadonlyRootfs).toBe(true);
    expect(c.HostConfig.Binds).toEqual([`/opt/itzbot/data/bots/${id}/src:/app:ro`, `/opt/itzbot/data/bots/${id}/data:/data:rw`]);
    expect(c.User).toBe('1000:1000');
  });
  it('restarts automatically unless stopped, has a health check and graceful stop', () => {
    expect(c.HostConfig.RestartPolicy.Name).toBe('unless-stopped');
    expect(c.Healthcheck.Test[0]).toBe('CMD-SHELL');
    expect(c.StopTimeout).toBe(20);
  });
  it('never mounts the Docker socket or host root', () => {
    expect(JSON.stringify(c.HostConfig.Binds)).not.toMatch(/docker\.sock|:\/:|:\/host/);
  });
  it('installer skips lifecycle scripts unless allowed', () => {
    const a: any = buildInstallContainerOptions(o, { botId: id, allowScripts: false });
    const b: any = buildInstallContainerOptions(o, { botId: id, allowScripts: true });
    expect(a.Cmd[2]).toContain('--ignore-scripts');
    expect(b.Cmd[2]).not.toContain('--ignore-scripts');
    expect(a.HostConfig.CapDrop).toEqual(['ALL']);
  });
});
