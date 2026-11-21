// REAL integration test: requires a running Docker daemon. Run with:  DOCKER_INTEGRATION=1 npm test -w worker
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { DockerRuntime } from '../src/runtime';

describe.skipIf(!process.env.DOCKER_INTEGRATION)('DockerRuntime against a real daemon', () => {
  it('can ping Docker', async () => {
    const rt = new DockerRuntime({ docker: new Docker(), image: 'node:20-alpine', hostDataDir: '/tmp/itzbot-test', network: 'itzbot-test', pids: 64 });
    expect((await rt.ping()).reachable).toBe(true);
  });
});
