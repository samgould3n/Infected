import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { tickIfDue } from '@/lib/server/engine';
import type { PingPoint, StateResponse } from '@/lib/types';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);

  let { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);

  await tickIfDue(game);
  // Re-read in case the tick changed status / produced pings.
  ({ data: game } = await db.from('games').select('*').eq('id', params.id).single());
  if (!game) return err('Game not found', 404);

  const { data: players } = await db
    .from('players')
    .select('id, name, role, status, is_original_hunter')
    .eq('game_id', game.id)
    .order('joined_at');
  const active = (players ?? []).filter((p) => p.status === 'active');
  const survivors = active.filter((p) => p.role === 'survivor').length;
  const hunters = active.filter((p) => p.role === 'hunter').length;
  const infected = active.filter((p) => p.role === 'hunter' && !p.is_original_hunter).length;

  // Visibility rules: each player only ever receives the opposing team's pings.
  let pingPoints: PingPoint[] = [];
  let pingAt: string | null = null;
  if (me.role && game.status !== 'lobby') {
    const audience = me.role === 'hunter' ? 'hunters' : 'survivors';
    const { data: lastTick } = await db
      .from('pings')
      .select('*')
      .eq('game_id', game.id)
      .eq('audience', audience)
      .eq('kind', 'tick')
      .order('created_at', { ascending: false })
      .limit(1);
    const tick = lastTick?.[0];
    if (tick) {
      pingPoints = (tick.points as PingPoint[]).map((p) => ({ lat: p.lat, lng: p.lng, r: p.r }));
      pingAt = tick.created_at;
    }
    // Extra reveals (out-of-bounds, capture broadcasts) since the last tick.
    let q = db
      .from('pings')
      .select('*')
      .eq('game_id', game.id)
      .eq('audience', audience)
      .neq('kind', 'tick')
      .order('created_at', { ascending: false })
      .limit(3);
    if (tick) q = q.gt('created_at', tick.created_at);
    const { data: extras } = await q;
    for (const ex of extras ?? []) {
      pingPoints = pingPoints.concat(
        (ex.points as PingPoint[]).map((p) => ({ lat: p.lat, lng: p.lng, r: p.r }))
      );
      if (!pingAt || ex.created_at > pingAt) pingAt = ex.created_at;
    }
  }

  // Optional teammate visibility for hunters (live positions, same team only).
  let teammates: StateResponse['teammates'] = null;
  if (me.role === 'hunter' && game.settings.huntersSeeEachOther && game.status === 'active') {
    const { data: mates } = await db
      .from('players')
      .select('id, name, last_lat, last_lng, last_loc_at')
      .eq('game_id', game.id)
      .eq('role', 'hunter')
      .eq('status', 'active')
      .neq('id', me.id);
    teammates = (mates ?? [])
      .filter((m) => m.last_lat != null)
      .map((m) => ({ name: m.name, lat: m.last_lat, lng: m.last_lng }));
  }

  const audiences = ['all', me.id, me.role === 'hunter' ? 'hunters' : 'survivors'];
  const { data: events } = await db
    .from('events')
    .select('id, type, payload, audience, created_at')
    .eq('game_id', game.id)
    .in('audience', audiences)
    .order('created_at', { ascending: false })
    .limit(15);

  const res: StateResponse = {
    game: {
      id: game.id,
      code: game.code,
      status: game.status,
      winner: game.winner,
      startedAt: game.started_at,
      endsAt: game.ends_at,
      serverNow: new Date().toISOString(),
      settings: game.settings,
      hostPlayer: game.host_player,
    },
    me: {
      id: me.id,
      name: me.name,
      role: me.role,
      status: me.status,
      decoysLeft: me.decoys_left,
      isOriginalHunter: me.is_original_hunter,
      capturedAt: me.captured_at,
    },
    players: active.map((p) => ({
      id: p.id,
      name: p.name,
      role: game.status === 'lobby' ? null : p.role,
      status: p.status,
      isOriginalHunter: p.is_original_hunter,
    })),
    counts: { survivors, hunters, infected },
    pings: { points: pingPoints, at: pingAt },
    teammates,
    events: (events ?? [])
      .reverse()
      .map((e) => ({ id: e.id, type: e.type, payload: e.payload, at: e.created_at })),
  };
  return Response.json(res);
}
