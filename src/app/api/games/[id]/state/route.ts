import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { tickIfDue, isSelfSelect } from '@/lib/server/engine';
import type { MapNode, PingPoint, StateResponse } from '@/lib/types';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);

  let { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);

  await tickIfDue(game);
  ({ data: game } = await db.from('games').select('*').eq('id', params.id).single());
  if (!game) return err('Game not found', 404);

  // refresh me (effects/powerups/choices may have changed during tick)
  const { data: meFresh } = await db.from('players').select('*').eq('id', me.id).single();
  if (meFresh) me = meFresh;

  const { data: players } = await db
    .from('players')
    .select('id, name, role, status, is_original_hunter')
    .eq('game_id', game.id)
    .order('joined_at');
  const active = (players ?? []).filter((p) => p.status === 'active');
  const survivors = active.filter((p) => p.role === 'survivor').length;
  const hunters = active.filter((p) => p.role === 'hunter').length;
  const infected = active.filter((p) => p.role === 'hunter' && !p.is_original_hunter).length;

  // Pings (role-scoped).
  let pingPoints: PingPoint[] = [];
  let pingAt: string | null = null;
  if (me.role && game.status !== 'lobby') {
    const audience = me.role === 'hunter' ? 'hunters' : 'survivors';
    const { data: lastTick } = await db
      .from('pings').select('*')
      .eq('game_id', game.id).eq('audience', audience).eq('kind', 'tick')
      .order('created_at', { ascending: false }).limit(1);
    const tick = lastTick?.[0];
    if (tick) {
      pingPoints = (tick.points as PingPoint[]).map((p) => ({ lat: p.lat, lng: p.lng, r: p.r }));
      pingAt = tick.created_at;
    }
    let q = db
      .from('pings').select('*')
      .eq('game_id', game.id).eq('audience', audience).neq('kind', 'tick')
      .order('created_at', { ascending: false }).limit(6);
    if (tick) q = q.gt('created_at', tick.created_at);
    const { data: extras } = await q;
    for (const ex of extras ?? []) {
      pingPoints = pingPoints.concat((ex.points as PingPoint[]).map((p) => ({ lat: p.lat, lng: p.lng, r: p.r })));
      if (!pingAt || ex.created_at > pingAt) pingAt = ex.created_at;
    }
  }

  // Teammate visibility for hunters.
  let teammates: StateResponse['teammates'] = null;
  if (me.role === 'hunter' && game.settings.huntersSeeEachOther && game.status === 'active') {
    const { data: mates } = await db
      .from('players').select('id, name, last_lat, last_lng')
      .eq('game_id', game.id).eq('role', 'hunter').eq('status', 'active').neq('id', me.id);
    teammates = (mates ?? []).filter((m) => m.last_lat != null).map((m) => ({ name: m.name, lat: m.last_lat, lng: m.last_lng }));
  }

  // Map nodes, role-scoped:
  //  - survivors see: pickup, drop (their reclaim), deadzone (all), tripwire (their own)
  //  - hunters see: lure (their team's traps), deadzone (all)
  let nodes: MapNode[] = [];
  if (game.status === 'active') {
    const nowIso = new Date().toISOString();
    const { data: rawNodes } = await db
      .from('nodes').select('*').eq('game_id', game.id).is('claimed_by', null);
    for (const n of rawNodes ?? []) {
      if (n.expires_at && n.expires_at < nowIso) continue;
      const visible =
        (me.role === 'survivor' && (n.kind === 'pickup' || n.kind === 'drop' || n.kind === 'deadzone'
          || (n.kind === 'tripwire' && n.payload?.ownerId === me.id)))
        || (me.role === 'hunter' && (n.kind === 'lure' || n.kind === 'deadzone'));
      if (!visible) continue;
      nodes.push({ id: n.id, lat: n.lat, lng: n.lng, radiusM: n.radius_m, kind: n.kind, expiresAt: n.expires_at ?? null });
    }
  }

  const audiences = ['all', me.id, me.role === 'hunter' ? 'hunters' : 'survivors'];
  const { data: events } = await db
    .from('events').select('id, type, payload, audience, created_at')
    .eq('game_id', game.id).in('audience', audiences)
    .order('created_at', { ascending: false }).limit(20);

  const activeFence = (game.active_fence ?? null) as any;
  // Only preview the next fence inside the 30s warning window.
  const inWarn = game.fence_warn_at && game.fence_warn_at <= new Date().toISOString();
  const nextFence = inWarn ? (game.next_fence ?? null) : null;

  const res: StateResponse = {
    game: {
      id: game.id, code: game.code, status: game.status, winner: game.winner,
      startedAt: game.started_at, endsAt: game.ends_at, serverNow: new Date().toISOString(),
      settings: game.settings, hostPlayer: game.host_player,
      masterFence: game.master_fence ?? game.settings.geofence,
      activeFence: activeFence ?? (game.status === 'active' ? game.settings.geofence : null),
      nextFence,
      fenceMoveAt: game.fence_move_at ?? null,
      constrictUsed: !!game.constrict_used,
    },
    me: {
      id: me.id, name: me.name, role: me.role, status: me.status,
      decoysLeft: me.decoys_left, isOriginalHunter: me.is_original_hunter, capturedAt: me.captured_at,
      powerups: (me.powerups as string[]) ?? [],
      effects: (me.effects as Record<string, string>) ?? {},
      selfSelect: game.status === 'active' ? await isSelfSelect(game) : false,
      pickupChoices: (me.pending_pickup_choices as string[]) ?? null,
      flaggedUntil: me.effects?.tracked ?? null,
    },
    players: active.map((p) => ({
      id: p.id, name: p.name,
      role: game.status === 'lobby' ? null : p.role,
      status: p.status, isOriginalHunter: p.is_original_hunter,
    })),
    counts: { survivors, hunters, infected },
    pings: { points: pingPoints, at: pingAt },
    teammates,
    nodes,
    events: (events ?? []).reverse().map((e) => ({ id: e.id, type: e.type, payload: e.payload, at: e.created_at })),
  };
  return Response.json(res);
}
