-- MANHUNT database schema. Paste this whole file into the Supabase SQL Editor and click Run.
create extension if not exists pgcrypto;

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'lobby',          -- lobby | active | finished
  settings jsonb not null,
  host_player uuid,
  started_at timestamptz,
  ends_at timestamptz,
  next_ping_at timestamptz,
  winner text,                                    -- hunters | survivors
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  token text unique not null,
  role text,                                      -- hunter | survivor (null in lobby)
  is_original_hunter boolean not null default false,
  status text not null default 'active',          -- active | left
  last_lat double precision,
  last_lng double precision,
  last_accuracy double precision,
  last_loc_at timestamptz,
  decoys_left integer not null default 0,
  pending_decoy jsonb,
  capture_token text,
  capture_token_expires timestamptz,
  out_of_bounds_since timestamptz,
  flags jsonb not null default '{}'::jsonb,
  captured_at timestamptz,
  joined_at timestamptz not null default now()
);

create table if not exists pings (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  audience text not null,                         -- hunters | survivors
  kind text not null default 'tick',              -- tick | oob | capture
  points jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  hunter_id uuid references players(id),
  survivor_id uuid references players(id),
  distance_m double precision,
  method text,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  type text not null,
  audience text not null default 'all',           -- all | hunters | survivors | <player uuid>
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_players_game on players(game_id);
create index if not exists idx_players_token on players(token);
create index if not exists idx_pings_game on pings(game_id, audience, created_at desc);
create index if not exists idx_events_game on events(game_id, created_at desc);
create index if not exists idx_games_code on games(code);

-- Lock everything down. The app only talks to the database through server code
-- using the service-role key, which bypasses row level security.
alter table games enable row level security;
alter table players enable row level security;
alter table pings enable row level security;
alter table captures enable row level security;
alter table events enable row level security;
