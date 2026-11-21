# VPS deployment

**You must provide:** a Linux VPS (Ubuntu 22.04/24.04, ≥1 GB RAM; 2 GB recommended for 10 bots), a domain name with an A record to the VPS,
and root/sudo access. Nothing here can be done for you from the code.

## 1. Prepare the server
```bash
curl -fsSL https://get.docker.com | sh          # installs Docker + compose plugin
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
sudo mkdir -p /opt/itzbot/data && sudo chown -R 1000:1000 /opt/itzbot/data
sudo systemctl enable docker                    # Docker (and the bots) restart after a reboot
```
Never open port 2375/2376 and never publish the Docker socket; this stack does not.

## 2. Configure
```bash
git clone <your-repo-url> itzbot && cd itzbot
cp .env.example .env
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → MASTER_KEY   (encrypts bot tokens. BACK IT UP: losing it makes stored tokens unrecoverable)
nano .env              # set POSTGRES_PASSWORD, JWT_SECRET, MASTER_KEY, HOST_DATA_DIR=/opt/itzbot/data, SITE_ADDRESS=your.domain
```
## 3. Start
```bash
docker compose up -d --build
docker compose logs -f backend      # wait for "Docker ready" and "Server listening"
curl https://your.domain/api/health # {"ok":true}
```
Open the app → enter `https://your.domain` → **Create owner account** (first account only; registration then closes).

## 4. Operate
* Update: `git pull && docker compose up -d --build` (running bots are **not** interrupted; they are separate containers).
* Backup: `pg_dump` via `docker compose exec postgres pg_dump -U itzbot itzbot > backup.sql`, plus `/opt/itzbot/data` and `.env`.
* Reboot recovery: containers use `restart: unless-stopped`; the backend also re-creates missing containers for bots that should be running (3 attempts, then marks error).
* Logs: `docker compose logs backend`; bot output is in the app console (last 5000 lines/bot kept).

## Things to verify on first run (not verifiable offline)
* The `docker-socket-proxy` permissions: if bot start fails with a 403 from the proxy, check its env flags in `docker-compose.yml`
  (needs CONTAINERS, IMAGES, NETWORKS, INFO, VERSION and POST enabled).
* `HOST_DATA_DIR` must be identical on host and in the backend container (bind-mount path used for bot containers).
* The healthcheck uses `pgrep -x node`; non-`node` process names (rare) would show "unhealthy".

## Limits & behaviour to know
* Bots are Node.js only. `npm install` runs in a sandbox with `--ignore-scripts` by default (enable per bot if a dependency needs native build scripts; node:alpine may lack build tools).
* Bot source is mounted **read-only**; bots may write only to `/data` (env `DATA_DIR`) and `/tmp`. TypeScript projects must be pre-built.
* Bots reach the internet (needed for Discord) but cannot reach each other (bridge with ICC disabled) or Postgres.
