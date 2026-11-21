import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { AppError } from './errors';

export const LIMITS = { maxEntries: 5000, maxTotalBytes: 300 * 1024 * 1024, maxFileBytes: 100 * 1024 * 1024 };
const bad = (code: string, msg: string) => new AppError(400, code, msg);
/** yauzl validates entry names itself and throws plain Errors; translate them into our error codes. */
const mapZipError = (e: unknown) =>
  e instanceof AppError ? e
    : /invalid relative path|absolute path|backslash/i.test((e as Error)?.message ?? '') ? bad('ZIP_PATH_TRAVERSAL', 'Archive contains an unsafe path (path traversal blocked).')
    : bad('ZIP_INVALID', 'The ZIP archive is corrupt or unsupported.');

/** Resolve `rel` inside `root`, rejecting traversal, absolute paths and NUL bytes. */
export function safeJoin(root: string, rel: string): string {
  if (rel.includes('\0')) throw bad('ZIP_PATH_TRAVERSAL', 'Path contains a NUL byte.');
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) throw bad('ZIP_PATH_TRAVERSAL', `Absolute path not allowed: ${rel}`);
  const parts = norm.split('/').filter((p) => p && p !== '.');
  if (parts.includes('..')) throw bad('ZIP_PATH_TRAVERSAL', `Path traversal blocked: ${rel}`);
  const r = path.resolve(root);
  const full = path.resolve(r, ...parts);
  if (full !== r && !full.startsWith(r + path.sep)) throw bad('ZIP_PATH_TRAVERSAL', `Path escapes target directory: ${rel}`);
  return full;
}

const skip = (name: string) => { const p = name.split('/'); return p[0] === '__MACOSX' || p.includes('.git') || p.includes('node_modules'); };

function limiter(state: { total: number }, perFile: number, totalMax: number): Transform {
  let file = 0;
  return new Transform({
    transform(chunk, _e, cb) {
      file += chunk.length; state.total += chunk.length;
      if (file > perFile) return cb(bad('ZIP_TOO_LARGE', 'A file inside the archive is too large.'));
      if (state.total > totalMax) return cb(bad('ZIP_TOO_LARGE', 'Archive expands to more than the allowed size (zip bomb protection).'));
      cb(null, chunk);
    },
  });
}

/** Copies with limits. Written by hand (not stream.pipeline) because yauzl's read streams may never emit 'close' after an abort. */
function copyLimited(rs: NodeJS.ReadableStream, lim: Transform, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(target, { mode: 0o644 });
    const abort = (e: unknown) => { (rs as any).destroy?.(); lim.destroy(); out.destroy(); reject(e); };
    rs.on('error', abort); lim.on('error', abort); out.on('error', abort);
    out.on('finish', () => resolve());
    rs.pipe(lim).pipe(out);
  });
}

export async function extractZip(zipPath: string, destDir: string, lim = LIMITS): Promise<{ files: number }> {
  await fs.mkdir(destDir, { recursive: true });
  const root = path.resolve(destDir);
  let entries = 0, files = 0;
  const state = { total: 0 };
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(bad('ZIP_INVALID', 'This is not a valid ZIP archive.'));
      const fail = (e: unknown) => { try { zip.close(); } catch { /* ignore */ } reject(mapZipError(e)); };
      zip.on('error', fail);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          if (++entries > lim.maxEntries) throw bad('ZIP_TOO_MANY_FILES', `Archive has more than ${lim.maxEntries} entries.`);
          const name = entry.fileName.replace(/\\/g, '/');
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) throw bad('ZIP_SYMLINK', 'Archive contains a symbolic link, which is not allowed.');
          const target = safeJoin(root, name); // validates every entry, even skipped ones
          if (skip(name)) return zip.readEntry();
          if (name.endsWith('/')) { fs.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail); return; }
          if (entry.uncompressedSize > lim.maxFileBytes) throw bad('ZIP_TOO_LARGE', `"${name}" is too large.`);
          fs.mkdir(path.dirname(target), { recursive: true }).then(() => {
            zip.openReadStream(entry, (e, rs) => {
              if (e || !rs) return fail(e ?? bad('ZIP_INVALID', 'Could not read an archive entry.'));
              files++;
              copyLimited(rs, limiter(state, lim.maxFileBytes, lim.maxTotalBytes), target).then(() => zip.readEntry(), fail);
            });
          }, fail);
        } catch (e) { fail(e); }
      });
      zip.readEntry();
    });
  });
  return { files };
}

/** GitHub zipballs and many ZIPs wrap everything in one folder; move its contents up. */
export async function flattenSingleRoot(dir: string): Promise<void> {
  const items = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.name !== '__MACOSX');
  if (items.length === 1 && items[0].isDirectory()) {
    const inner = path.join(dir, items[0].name);
    for (const f of await fs.readdir(inner)) await fs.rename(path.join(inner, f), path.join(dir, f));
    await fs.rmdir(inner);
  }
}

export async function writeUploadedFile(root: string, relPath: string, stream: NodeJS.ReadableStream, maxBytes: number): Promise<void> {
  const target = safeJoin(root, relPath);
  if (relPath.replace(/\\/g, '/').split('/').some((p) => p === '.git' || p === 'node_modules')) { stream.resume(); return; }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await pipeline(stream, limiter({ total: 0 }, maxBytes, maxBytes), createWriteStream(target, { mode: 0o644 }));
}
