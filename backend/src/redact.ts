const DISCORD_TOKEN = /[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g;
const GENERIC = [/(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g, /Bearer\s+[A-Za-z0-9._~+\/=-]{20,}/gi];
export const SECRET_KEY_RE = /token|secret|key|pass|auth|cred|api/i;

export function redactGeneric(s: string): string {
  let o = s.replace(DISCORD_TOKEN, '[REDACTED]');
  for (const re of GENERIC) o = o.replace(re, '[REDACTED]');
  return o;
}

export class Redactor {
  private secrets: string[];
  constructor(secrets: string[] = []) {
    this.secrets = [...new Set(secrets.filter((s) => s && s.length >= 6))].sort((a, b) => b.length - a.length);
  }
  redact(s: string): string {
    let o = s;
    for (const sec of this.secrets) o = o.split(sec).join('[REDACTED]');
    return redactGeneric(o);
  }
}
