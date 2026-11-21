# ItzBot Manager

Self-hosted Discord bot hosting platform with an Android app. Your bots (Discord.js / Node.js, up to 10) run in
**one hardened Docker container each** on your own Linux VPS, 24/7, independent of the phone and of Replit.

```
Android app (Expo)  ──HTTPS/WSS──►  Caddy ─► Backend (Fastify) ─► PostgreSQL
                                               │
                                               └─► docker-socket-proxy ─► Docker ─► [bot 1] [bot 2] … [bot 10]
```

| Folder | What it is |
|---|---|
| `backend/` | Fastify + TypeScript REST/WebSocket API, auth, encrypted secrets, imports, bot lifecycle, monitor/recovery, metrics |
| `worker/` | Docker runtime layer: hardened container specs, install step, stats, log streaming |
| `shared/` | Shared TypeScript types |
| `mobile/` | Expo / React Native app (11 screens) + EAS config |
| `docker/`, `docker-compose.yml` | Production stack (Postgres, socket proxy, backend, Caddy HTTPS) |
| `docs/` | Deployment, security model, APK build, testing, status |

## Quick start (VPS)
See **docs/DEPLOYMENT.md**. In short: install Docker, clone, copy `.env.example` → `.env`, fill secrets, `docker compose up -d --build`, point a domain at the VPS.

## Quick start (APK)
See **docs/MOBILE_BUILD.md** (`npm install`, `npx expo install --fix`, `eas build --platform android --profile preview`).

## Honest status
This code was written in an environment without Docker, a network or a Postgres server, so **it has not been run end-to-end**.
What was actually executed is listed in **docs/TESTING.md**; everything else is untested until you run it. Expect to fix small
issues on first build (dependency versions, type errors). `docs/STATUS.md` lists exactly what is verified and what is not.

## Moving the two Replit bots
1. Add the bot in the app (name, Application ID, token). 2. Import its code (GitHub, ZIP of the Repl, or files).
3. Re-enter Replit Secrets as environment variables on the bot page (`.env` files are stripped on import).
4. Start it, check the console, then **stop the Repl** so the token is not used twice.
