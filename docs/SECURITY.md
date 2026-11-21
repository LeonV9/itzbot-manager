# Security model

| Area | Implementation |
|---|---|
| Auth | scrypt password hashes (N=32768), JWT (30 d) with per-user `token_version` (password change / "sign out everywhere" revokes all tokens), login/register rate limit 10/min, global 300/min, first-account-only registration |
| Bot tokens | AES-256-GCM with `MASTER_KEY`; only ciphertext in Postgres; never returned by any endpoint; replace-only; verified against Discord (`/oauth2/applications/@me`) and matched to the Application ID |
| Env vars | stored encrypted as one blob; API returns names only |
| Logs | every line redacted (known secrets + Discord/GitHub token patterns) before persistence or streaming; request auth headers redacted from server logs |
| Uploads | ZIP: entry-count/size limits, streaming size caps (zip-bomb), `..`/absolute/backslash path rejection, symlinks rejected, `node_modules`/`.git` skipped, 100 MB cap. Manual: same path checks. `.env` files deleted on import |
| Start command | allow-list: `node/npm/npx/yarn/pnpm …` joined by `&&` only; no shell metacharacters |
| Containers | non-root uid 1000, `CapDrop ALL`, `no-new-privileges`, not privileged, read-only root FS and source mount, tmpfs `/tmp`, memory (no swap)/CPU/PID limits, log rotation, isolated bridge (ICC off), graceful stop (SIGTERM, 20 s) |
| Docker access | never published; backend talks to a filtering `docker-socket-proxy` on a private network |
| Transport | Caddy automatic HTTPS; Android release builds block cleartext unless built with `ALLOW_CLEARTEXT=1` |
| App | no secrets in the APK; token in Android Keystore-backed SecureStore; server URL entered by user |

## Residual risks (be aware)
* The backend is trusted and can ask Docker (through the proxy) to create containers; if the backend were compromised, so is the host. Keep it updated.
* Imported bot code is **untrusted but not VM-isolated**: containers share the host kernel. The hardening above is strong but not a hypervisor boundary.
* Bots can reach the internet and any host service published on the host's IPs. Don't publish internal services.
* `MASTER_KEY` lives in `.env` on the VPS; anyone with root on the VPS can decrypt tokens.
* GitHub private repos use a personal access token you type per import (OAuth app login is not implemented).
