CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hosting_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'local',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid REFERENCES hosting_servers(id) ON DELETE SET NULL,
  name text NOT NULL,
  application_id text NOT NULL,
  source_type text CHECK (source_type IN ('github','zip','manual')),
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bots_owner_idx ON bots(owner_id);

CREATE TABLE bot_configs (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  start_command text NOT NULL DEFAULT 'npm start',
  entry_file text,
  env_enc text,                       -- AES-256-GCM encrypted JSON of environment variables
  allow_install_scripts boolean NOT NULL DEFAULT false,
  memory_mb integer,
  cpus numeric(4,2)
);

CREATE TABLE bot_credentials (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  token_enc text NOT NULL,            -- AES-256-GCM encrypted Discord bot token
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_processes (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  desired_state text NOT NULL DEFAULT 'stopped' CHECK (desired_state IN ('running','stopped')),
  status text NOT NULL DEFAULT 'offline',
  container_id text,
  last_error text,
  last_started_at timestamptz,
  last_exit_code integer,
  restart_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_logs (
  id bigserial PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  stream text NOT NULL CHECK (stream IN ('stdout','stderr','system')),
  line text NOT NULL
);
CREATE INDEX bot_logs_bot_idx ON bot_logs(bot_id, id DESC);

CREATE TABLE settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES bots(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('github','zip','manual')),
  source text,
  status text NOT NULL CHECK (status IN ('success','failed')),
  detail jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
