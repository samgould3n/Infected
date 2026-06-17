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

-- ============================================================
-- v2 UPDATE: moving geofence, power-ups, hunter abilities,
-- tiered out-of-bounds penalties. Safe to run on top of v1.
-- ============================================================

-- Per-game dynamic state (moving fence, master boundary, shrink).
alter table games add column if not exists master_fence jsonb;       -- outer boundary (never changes)
alter table games add column if not exists active_fence jsonb;       -- current play boundary (moves/shrinks)
alter table games add column if not exists next_fence jsonb;         -- previewed upcoming boundary during warning window
alter table games add column if not exists fence_move_at timestamptz;-- when the active fence becomes next_fence
alter table games add column if not exists fence_warn_at timestamptz;-- when to start showing the next-fence preview
alter table games add column if not exists constrict_used boolean not null default false;

-- Player power-up state.
alter table players add column if not exists powerups jsonb not null default '[]'::jsonb;        -- held power-up ids (survivor or hunter pool)
alter table players add column if not exists effects jsonb not null default '{}'::jsonb;         -- active timed effects -> expiry ISO
alter table players add column if not exists self_select boolean not null default false;         -- survivor reached the self-select phase (unused server-side gate; computed live)
alter table players add column if not exists oob_breaches integer not null default 0;            -- count of separate out-of-bounds breaches
alter table players add column if not exists pending_pickup_choices jsonb;                       -- when at a node in self-select mode: the 3 offered ids

-- Power-up pickup nodes on the map (survivor-only, hunter-invisible).
create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  radius_m double precision not null default 25,
  kind text not null default 'pickup',            -- pickup | lure (hunter trap) | drop (infected drop) | deadzone
  payload jsonb not null default '{}'::jsonb,      -- e.g. { ownerId, powerupId, expiresAt, fixed }
  claimed_by uuid,                                 -- player who consumed it
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_nodes_game on nodes(game_id, kind);

-- Hunter "lure" traps reuse the nodes table (kind='lure').
-- Survivor "dead zones" and "tripwires" also live in nodes (kind='deadzone'|'tripwire').

-- Lock down the v2 nodes table to match every other table (service-role bypasses RLS).
alter table nodes enable row level security;
