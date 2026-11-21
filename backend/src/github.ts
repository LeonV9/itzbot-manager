import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { AppError } from './errors';

export interface GithubRef { owner: string; repo: string; ref?: string }

export function parseGithubUrl(input: string): GithubRef {
  const s = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  let owner: string, repo: string, ref: string | undefined;
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(s);
  if (short) [, owner, repo] = short;
  else {
    let u: URL;
    try { u = new URL(s); } catch { throw new AppError(400, 'INVALID_GITHUB_URL', 'Enter a GitHub repository URL such as https://github.com/owner/repo.'); }
    if (u.protocol !== 'https:' || u.hostname !== 'github.com') throw new AppError(400, 'INVALID_GITHUB_URL', 'Only https://github.com/… repositories are supported.');
    const p = u.pathname.split('/').filter(Boolean);
    if (p.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(p[0]) || !/^[A-Za-z0-9_.-]+$/.test(p[1])) throw new AppError(400, 'INVALID_GITHUB_URL', 'The URL must look like https://github.com/owner/repo.');
    [owner, repo] = p;
    if (p[2] === 'tree' && p[3]) ref = decodeURIComponent(p.slice(3).join('/'));
  }
  return { owner, repo, ref };
}

/** Downloads the repo as a zipball. `token` (a GitHub personal access token) is used for this request only and never stored. */
export async function downloadRepo(g: GithubRef, destZip: string, opts: { token?: string; ref?: string; maxBytes: number }): Promise<void> {
  const ref = opts.ref ?? g.ref;
  const url = `https://api.github.com/repos/${g.owner}/${g.repo}/zipball${ref ? '/' + encodeURIComponent(ref) : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow', signal: AbortSignal.timeout(120_000),
      headers: {
        Accept: 'application/vnd.github+json', 'User-Agent': 'itzbot-manager', 'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
    });
  } catch { throw new AppError(502, 'GITHUB_UNREACHABLE', 'Could not reach GitHub from the server.'); }
  if (res.status === 404) throw new AppError(404, 'GITHUB_NOT_FOUND', opts.token
    ? 'Repository or branch not found, or the token has no access to it.'
    : 'Repository not found. If it is private, provide a GitHub personal access token with read access to its contents.');
  if (res.status === 401) throw new AppError(401, 'GITHUB_AUTH', 'GitHub rejected the access token.');
  if (res.status === 403 || res.status === 429) throw new AppError(429, 'GITHUB_RATE_LIMIT', 'GitHub refused the request (rate limit or insufficient permissions). Provide an access token or try later.');
  if (!res.ok || !res.body) throw new AppError(502, 'GITHUB_ERROR', `GitHub returned HTTP ${res.status}.`);
  let n = 0;
  const cap = new Transform({ transform(c, _e, cb) { n += c.length; n > opts.maxBytes ? cb(new AppError(413, 'IMPORT_TOO_LARGE', 'Repository archive is too large.')) : cb(null, c); } });
  await pipeline(Readable.fromWeb(res.body as any), cap, createWriteStream(destZip));
}
