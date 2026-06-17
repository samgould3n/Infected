import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent, initialActiveFence, nextActiveFence } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';
import { fenceCenter } from '@/lib/geo';
import { SURVIVOR_POOL } from '@/lib/powerups';
import type { GameSettings, LatLng } from '@/lib/types';

function pick2(): string[] {
  const shuffled = [...SURVIVOR_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);
  if (game.host_player !== me.id) return err('Only the host can start the game', 403);
  if (game.status !== 'lobby') return err('Game already started', 409);

  const { data: players } = await db
    .from('players')
    .select('*')
    .eq('game_id', game.id)
    .eq('status', 'active');
  if (!players || players.length < 2) return err('You need at least 2 players');

  const settings = game.settings as GameSettings;
  const hunterCount = Math.max(1, Math.min(settings.hunterCount, players.length - 1));
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const hunters = new Set(shuffled.slice(0, hunterCount).map((p) => p.id));

  for (const p of players) {
    const isHunter = hunters.has(p.id);
    await db
      .from('players')
      .update({
        role: isHunter ? 'hunter' : 'survivor',
        is_original_hunter: isHunter,
        decoys_left: 0,
        powerups: isHunter ? [] : pick2(),  // survivors start with 2 random; hunters choose at start client-side
        effects: {},
        pending_pickup_choices: null,
      })
      .eq('id', p.id);
  }

  // Determine the players' start location (host's fix, else any fix, else fence centre).
  const located = players.find((p) => p.id === game.host_player && p.last_lat != null)
    ?? players.find((p) => p.last_lat != null);
  const start: LatLng = located
    ? { lat: located.last_lat, lng: located.last_lng }
    : fenceCenter(settings.geofence);

  const master = settings.geofence;
  const active = initialActiveFence(settings, start);
  const next = settings.fenceMoves ? nextActiveFence(master, active) : null;

  const now = Date.now();
  const fenceMoveAt = settings.fenceMoves ? new Date(now + settings.fenceMoveMin * 60000).toISOString() : null;
  const fenceWarnAt = settings.fenceMoves ? new Date(now + settings.fenceMoveMin * 60000 - 30000).toISOString() : null;

  const { error } = await db
    .from('games')
    .update({
      status: 'active',
      started_at: new Date(now).toISOString(),
      ends_at: new Date(now + settings.durationMin * 60000).toISOString(),
      next_ping_at: new Date(now + settings.pingIntervalMin * 60000).toISOString(),
      master_fence: master,
      active_fence: active,
      next_fence: next,
      fence_move_at: fenceMoveAt,
      fence_warn_at: fenceWarnAt,
      constrict_used: false,
    })
    .eq('id', game.id)
    .eq('status', 'lobby');
  if (error) return err('Could not start game', 500);

  await emitEvent(game.id, 'start', 'all', { hunters: hunterCount, players: players.length });
  await wake(game.id, 'start');
  return Response.json({ ok: true });
}
