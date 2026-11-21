import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Analysis } from '@itzbot/shared';
import { AppError } from './errors';

const ENTRY_CANDIDATES = ['index.js', 'bot.js', 'main.js', 'app.js', 'src/index.js', 'src/bot.js', 'src/main.js', 'index.mjs', 'dist/index.js'];
const DISCORD_LIBS = ['discord.js', 'eris', 'oceanic.js', '@discordjs/voice', 'discordx', 'detritus-client', 'seyfert'];
const exists = (p: string) => fs.stat(p).then(() => true, () => false);

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  return n;
}

/** Removes .env files (secrets must live in the encrypted store), returning the variable NAMES found. */
export async function stripDotEnv(dir: string): Promise<string[]> {
  const keys = new Set<string>();
  for (const e of await fs.readdir(dir)) {
    if (/^\.env(\..+)?$/.test(e) && !/example|sample|template/i.test(e)) {
      const txt = await fs.readFile(path.join(dir, e), 'utf8').catch(() => '');
      for (const m of txt.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) keys.add(m[1]);
      await fs.rm(path.join(dir, e), { force: true });
    }
  }
  return [...keys];
}

export async function analyzeProject(dir: string, envKeysFound: string[] = []): Promise<Analysis> {
  const warnings: string[] = [];
  const a: Analysis = {
    hasPackageJson: false, scripts: {}, dependencies: {}, entryCandidates: [], suggestedEntry: null,
    suggestedStartCommand: null, warnings, fileCount: await countFiles(dir), envKeysFound,
  };
  if (envKeysFound.length) warnings.push(`A .env file was found and removed for security. Re-enter these variables in the bot's environment settings: ${envKeysFound.join(', ')}.`);

  const pkgPath = path.join(dir, 'package.json');
  let pkg: any = null;
  if (await exists(pkgPath)) {
    try { pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')); a.hasPackageJson = true; }
    catch { throw new AppError(400, 'INVALID_PACKAGE_JSON', 'package.json exists but is not valid JSON.'); }
  }
  for (const c of ENTRY_CANDIDATES) if (await exists(path.join(dir, c))) a.entryCandidates.push(c);

  if (!pkg) {
    const hasPy = (await exists(path.join(dir, 'requirements.txt'))) || (await fs.readdir(dir)).some((f) => f.endsWith('.py'));
    if (hasPy && !a.entryCandidates.length) throw new AppError(400, 'UNSUPPORTED_RUNTIME', 'This looks like a Python project. ItzBot Manager currently hosts Node.js (Discord.js) bots only.');
    if (!a.entryCandidates.length) throw new AppError(400, 'MISSING_PACKAGE_JSON', 'No package.json and no recognisable entry file (index.js, bot.js, …) were found. Make sure the ZIP/repository root contains your bot.');
    warnings.push('No package.json found: dependencies cannot be installed automatically. Add one that lists discord.js.');
  } else {
    a.name = pkg.name; a.main = pkg.main; a.scripts = pkg.scripts ?? {};
    a.dependencies = { ...(pkg.dependencies ?? {}) };
    for (const l of DISCORD_LIBS) if (a.dependencies[l] || pkg.devDependencies?.[l]) { a.discordLib = { name: l, version: a.dependencies[l] ?? pkg.devDependencies[l] }; break; }
    if (!a.discordLib) warnings.push('No Discord library (discord.js, eris, …) is listed in dependencies. Is this the right project?');
    if (!Object.keys(a.dependencies).length) warnings.push('package.json lists no dependencies.');
  }

  if (a.main && (await exists(path.join(dir, a.main)))) a.suggestedEntry = a.main;
  else {
    const m = /node\s+(?:--[\w-]+\s+)*([\w./-]+\.(?:c|m)?js)/.exec(a.scripts.start ?? '');
    if (m && (await exists(path.join(dir, m[1])))) a.suggestedEntry = m[1];
    else a.suggestedEntry = a.entryCandidates[0] ?? null;
  }
  a.suggestedStartCommand = a.scripts.start ? 'npm start' : a.suggestedEntry ? `node ${a.suggestedEntry}` : null;
  if (!a.suggestedStartCommand) warnings.push('Could not detect an entry file or start script. Set the start command manually.');
  if ((await exists(path.join(dir, 'tsconfig.json'))) && !(await exists(path.join(dir, 'dist')))) {
    warnings.push('This is a TypeScript project without a compiled "dist" folder. The bot filesystem is read-only, so build locally and import the compiled output, or set a start command that runs prebuilt JavaScript.');
  }
  if (/python|\.py\b/.test(a.scripts.start ?? '')) warnings.push('The start script runs Python, which is not supported.');
  return a;
}
