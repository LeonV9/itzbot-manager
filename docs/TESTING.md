# Testing: what was really run

Environment used to write the code: no Docker, no network, no PostgreSQL. `npm install` was impossible, so the official `vitest` was not available.

## Executed (offline, with a tiny stand-in test runner, real code under test)
| Suite | Result |
|---|---|
| `backend/test/crypto.test.ts` (AES-GCM, tamper detection, scrypt) | 4/4 passed |
| `backend/test/redact.test.ts` | 4/4 passed |
| `backend/test/validation.test.ts` (start-command / env allow-list) | 11/11 passed |
| `worker/test/spec.test.ts` (container hardening spec) | 6/6 passed |
| `backend/test/zip.test.ts` (real yauzl 2.10 extraction: traversal, absolute, symlink, zip-bomb, analysis, GitHub URL parsing) | 11/11 passed |

Running them found and fixed two real bugs (extraction hung forever on the size-limit path; `.git/` URL parsing).
Syntax of all 2,700+ lines of TS/TSX was checked with the TypeScript parser (0 errors). **Full type-checking was not possible** (dependency types not installed).

## Written but NOT executed
* `backend/test/api.integration.test.ts`: auth, rate limit, bot CRUD, token encryption at rest, 10-bot cap, imports (GitHub is **mocked** fetch), start/stop/restart/duplicate-start/concurrency/recovery (Docker is **mocked** by `FakeRuntime`), WebSocket log streaming, ownership isolation, deletion. Needs real Postgres.
* `worker/test/docker.integration.test.ts`: real-Docker smoke test (`DOCKER_INTEGRATION=1`).
* Nothing in `mobile/` was compiled or run.

## How to run everything yourself
```bash
npm install && npm run build
docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/itzbot_test npm test -w backend   # WIPES that DB
DOCKER_INTEGRATION=1 npm test -w worker
cd mobile && npm install && npx tsc --noEmit
```
Real end-to-end acceptance (needs your VPS): add bot → import → start → see "Logged in" in console → reboot VPS → bot returns online → kill container → auto-restart.
