import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeProject, stripDotEnv } from '../src/analyze';
import { extractZip, flattenSingleRoot, safeJoin } from '../src/fsafe';
import { parseGithubUrl } from '../src/github';
import { makeZip } from './helpers/zip';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'itz-test-')); });
const zipTo = async (files: Parameters<typeof makeZip>[0]) => { const p = path.join(tmp, 'a.zip'); await fs.writeFile(p, makeZip(files)); return p; };
const exists = (p: string) => fs.stat(p).then(() => true, () => false);

describe('ZIP safety (real extraction on a real filesystem)', () => {
  it('blocks ../ path traversal and writes nothing outside the target', async () => {
    const z = await zipTo([{ name: '../evil.txt', data: 'x' }]);
    await expect(extractZip(z, path.join(tmp, 'out'))).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
    expect(await exists(path.join(tmp, 'evil.txt'))).toBe(false);
  });
  it('blocks absolute paths and backslash traversal', async () => {
    await expect(extractZip(await zipTo([{ name: '/etc/passwd-x', data: 'x' }]), path.join(tmp, 'o1'))).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
    await expect(extractZip(await zipTo([{ name: '..\\evil.txt', data: 'x' }]), path.join(tmp, 'o2'))).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
  });
  it('rejects symlink entries', async () => {
    await expect(extractZip(await zipTo([{ name: 'link', data: '/etc/passwd', symlink: true }]), path.join(tmp, 'o'))).rejects.toMatchObject({ code: 'ZIP_SYMLINK' });
  });
  it('enforces entry-count and size limits (zip-bomb protection)', async () => {
    const many = await zipTo(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.js`, data: 'x' })));
    await expect(extractZip(many, path.join(tmp, 'o'), { maxEntries: 3, maxTotalBytes: 1e6, maxFileBytes: 1e6 })).rejects.toMatchObject({ code: 'ZIP_TOO_MANY_FILES' });
    const big = await zipTo([{ name: 'a.txt', data: 'x'.repeat(5000) }]);
    await expect(extractZip(big, path.join(tmp, 'o3'), { maxEntries: 10, maxTotalBytes: 1000, maxFileBytes: 1e6 })).rejects.toMatchObject({ code: 'ZIP_TOO_LARGE' });
  });
  it('rejects non-zip data', async () => {
    const p = path.join(tmp, 'bad.zip'); await fs.writeFile(p, 'not a zip');
    await expect(extractZip(p, path.join(tmp, 'o'))).rejects.toMatchObject({ code: 'ZIP_INVALID' });
  });
  it('extracts a valid project, skips node_modules/.git and flattens a single root folder', async () => {
    const z = await zipTo([{ name: 'bot-main/package.json', data: '{"main":"index.js"}' }, { name: 'bot-main/index.js', data: '1' }, { name: 'bot-main/node_modules/x/i.js', data: '1' }, { name: 'bot-main/.git/config', data: '1' }]);
    const out = path.join(tmp, 'ok'); await extractZip(z, out); await flattenSingleRoot(out);
    expect(await exists(path.join(out, 'package.json'))).toBe(true);
    expect(await exists(path.join(out, 'node_modules'))).toBe(false);
    expect(await exists(path.join(out, '.git'))).toBe(false);
  });
  it('safeJoin rejects escapes', () => { expect(() => safeJoin('/a/b', '../c')).toThrow(); expect(() => safeJoin('/a/b', 'x/../../c')).toThrow(); expect(safeJoin('/a/b', 'x/y.js')).toBe('/a/b/x/y.js'); });
});

describe('project analysis', () => {
  it('detects discord.js, entry point, start command and removes .env', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'b', main: 'bot.js', scripts: { start: 'node bot.js' }, dependencies: { 'discord.js': '^14.0.0' } }));
    await fs.writeFile(path.join(tmp, 'bot.js'), '//');
    await fs.writeFile(path.join(tmp, '.env'), 'TOKEN=abc\nGUILD_ID=1\n');
    const keys = await stripDotEnv(tmp); const a = await analyzeProject(tmp, keys);
    expect(a.discordLib?.name).toBe('discord.js'); expect(a.suggestedEntry).toBe('bot.js'); expect(a.suggestedStartCommand).toBe('npm start');
    expect(keys.sort()).toEqual(['GUILD_ID', 'TOKEN']); expect(await exists(path.join(tmp, '.env'))).toBe(false);
  });
  it('errors on missing package.json and no entry, and on Python projects', async () => {
    await fs.writeFile(path.join(tmp, 'readme.txt'), 'x');
    await expect(analyzeProject(tmp)).rejects.toMatchObject({ code: 'MISSING_PACKAGE_JSON' });
    await fs.writeFile(path.join(tmp, 'bot.py'), 'x');
    await expect(analyzeProject(tmp)).rejects.toMatchObject({ code: 'UNSUPPORTED_RUNTIME' });
  });
});

describe('GitHub URL parsing', () => {
  it('parses common forms', () => {
    expect(parseGithubUrl('https://github.com/me/bot')).toEqual({ owner: 'me', repo: 'bot', ref: undefined });
    expect(parseGithubUrl('https://github.com/me/bot.git/')).toMatchObject({ repo: 'bot' });
    expect(parseGithubUrl('https://github.com/me/bot/tree/dev')).toMatchObject({ ref: 'dev' });
    expect(parseGithubUrl('me/bot')).toMatchObject({ owner: 'me' });
  });
  it('rejects other hosts and junk', () => {
    for (const u of ['https://evil.com/me/bot', 'http://github.com/me/bot', 'not a url', 'https://github.com/me']) expect(() => parseGithubUrl(u)).toThrow();
  });
});
