# Status & continuation

## Implemented (code written)
Backend API (auth, bots, token replace, config, env, imports ×3, start/stop/restart/delete, logs history, dashboard, server status, settings, WebSocket logs),
worker runtime (hardened containers, installer, stats, log follow, network), monitor (crash tracking, reboot recovery, log re-attach, friendly error diagnosis),
Postgres migrations, Docker/Compose/Caddy, Expo app (Connect/login, Dashboard, My Bots, Add Bot, Import Bot, Bot Details, Live Console, Statistics, Server Management, Settings, Account & Security), EAS config, icons, docs, tests.

## Not verified (do these first)
1. `npm install && npm run build`: fix any type errors (most likely spots: dockerode/fastify typings, `@fastify/websocket` v10 handler signature, Expo package versions).
2. Run backend integration tests with Postgres.
3. Deploy on the VPS; confirm docker-socket-proxy permissions; run a real bot.
4. `eas build`; test on the Galaxy A22.
Send me the exact error output of any failing step and I will fix it.

## Known gaps / ideas
* GitHub login is by personal access token per import (no OAuth app, no stored GitHub account).
* Android cannot pick folders: use ZIP for multi-folder projects.
* Single owner account model (extra users via ALLOW_REGISTRATION=true share nothing but the host).
* Start-command allow-list excludes shell features by design.
* No push notifications for crashes (could add via Expo push).
* Python bots unsupported (detected and rejected with a clear message).
