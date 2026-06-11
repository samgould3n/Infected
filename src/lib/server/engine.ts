import { db } from './db';
import { wake } from './broadcast';
import { fuzzPoint, haversine, insideFence } from '../geo';
import type { GameSettings, LatLng, PingPoint } from '../types';

const STALE_LOC_MS = 3 * 60 * 1000; // location older than this is excluded from pings
const OOB_GRACE_MS = 45 * 1000;     // grace period before out-of-bounds penalty fires

export async function emitEvent(
  gameId: string,
  type: string,
  audience: string,
  payload: Record<string, unknown> = {}
) {
  await db.from('events').insert({ game_id: gameId, type, audience, payload });
}

/**
 * Balance model: Option C (dynamic information scaling).
 * As the match progresses (and the hunter team naturally grows through
 * infection), hunter-facing pings degrade from exact points to wide zones.
 * Returns fuzz radius in metres for survivor positions shown to hunters.
 */
export function hunterFuzzRadius(game: any): number {
  if (!game.started_at || !game.ends_at) return 0;
  const start = new Date(game.started_at).getTime();
  const end = new Date(game.ends_at).getTime();
  const frac = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  if (frac < 1 / 3) return 0;    // early game: precise pings
  if (frac < 2 / 3) return 150;  // mid game: approximate zones
  return 400;                    // late game: coarse zones
}

/**
 * Lazy game clock. There is no background worker: every location update and
 * state fetch calls this, and an atomic conditional UPDATE on games.next_ping_at
 * guarantees exactly one caller performs each ping round. With 15–30 phones
 * posting locations every ~20s, ticks fire within seconds of being due.
 */
export async function tickIfDue(game: any) {
  if (game.status !== 'active') return;
  const nowIso = new Date().toISOString();

  if (game.ends_at && game.ends_at <= nowIso) {
    await finishGame(game.id);
    return;
  }
  if (!game.next_ping_at || game.next_ping_at > nowIso) return;

  const settings = game.settings as GameSettings;
  const nextAt = new Date(Date.now() + settings.pingIntervalMin * 60000).toISOString();
  const { data: claimed } = await db
    .from('games')
    .update({ next_ping_at: nextAt })
    .eq('id', game.id)
    .eq('status', 'active')
    .lte('next_ping_at', nowIso)
    .select();
  if (!claimed || claimed.length === 0) return; // another request won the race
  await doPingRound(claimed[0]);
}

async function doPingRound(game: any) {
  const settings = game.settings as GameSettings;
  const { data: players } = await db
    .from('players')
    .select('*')
    .eq('game_id', game.id)
    .eq('status', 'active');
  if (!players) return;

  const fresh = (p: any) =>
    p.last_lat != null && p.last_loc_at && Date.now() - new Date(p.last_loc_at).getTime() < STALE_LOC_MS;

  const survivors = players.filter((p) => p.role === 'survivor');
  const hunters = players.filter((p) => p.role === 'hunter');
  const fuzz = hunterFuzzRadius(game);

  // Survivor positions (plus any armed decoys) -> hunters
  const toHunters: PingPoint[] = [];
  for (const s of survivors) {
    if (fresh(s)) {
      const fp = fuzzPoint({ lat: s.last_lat, lng: s.last_lng }, fuzz);
      toHunters.push({ lat: fp.lat, lng: fp.lng, r: Math.max(fuzz, 25) });
    }
    if (s.pending_decoy) {
      const d = s.pending_decoy as LatLng;
      toHunters.push({ lat: d.lat, lng: d.lng, r: Math.max(fuzz, 25) }); // indistinguishable from a real ping
    }
  }
  // Hunter positions -> survivors (always a modest radius; GPS uncertainty)
  const toSurvivors: PingPoint[] = hunters
    .filter(fresh)
    .map((h) => ({ lat: h.last_lat, lng: h.last_lng, r: 30 }));

  await db.from('pings').insert([
    { game_id: game.id, audience: 'hunters', kind: 'tick', points: toHunters },
    { game_id: game.id, audience: 'survivors', kind: 'tick', points: toSurvivors },
  ]);
  await db.from('players').update({ pending_decoy: null }).eq('game_id', game.id).not('pending_decoy', 'is', null);
  await emitEvent(game.id, 'ping', 'all', { fuzz });
  await wake(game.id, 'ping');
}

export async function finishGame(gameId: string) {
  const { data: players } = await db
    .from('players')
    .select('id, role, status')
    .eq('game_id', gameId)
    .eq('status', 'active');
  const survivorsLeft = (players ?? []).filter((p) => p.role === 'survivor').length;
  const winner = survivorsLeft > 0 ? 'survivors' : 'hunters';
  const { data: claimed } = await db
    .from('games')
    .update({ status: 'finished', winner })
    .eq('id', gameId)
    .eq('status', 'active')
    .select();
  if (!claimed || claimed.length === 0) return;
  await emitEvent(gameId, 'game_over', 'all', { winner, survivorsLeft });
  await wake(gameId, 'game_over');
}

export async function infectPlayer(
  game: any,
  survivor: any,
  hunter: any | null,
  method: string,
  distanceM: number | null
) {
  await db
    .from('players')
    .update({
      role: 'hunter',
      is_original_hunter: false,
      captured_at: new Date().toISOString(),
      decoys_left: 0,
      pending_decoy: null,
    })
    .eq('id', survivor.id);
  await db.from('captures').insert({
    game_id: game.id,
    hunter_id: hunter?.id ?? null,
    survivor_id: survivor.id,
    method,
    distance_m: distanceM,
  });
  await emitEvent(game.id, 'infected', 'all', {
    name: survivor.name,
    by: hunter?.name ?? null,
    method,
  });

  // Spec: on infection, all remaining survivors receive the most recent
  // hunter-team location ping. Generate a fresh one from live positions.
  const { data: hunters } = await db
    .from('players')
    .select('*')
    .eq('game_id', game.id)
    .eq('status', 'active')
    .eq('role', 'hunter');
  const pts: PingPoint[] = (hunters ?? [])
    .filter((h) => h.last_lat != null)
    .map((h) => ({ lat: h.last_lat, lng: h.last_lng, r: 50 }));
  await db.from('pings').insert({ game_id: game.id, audience: 'survivors', kind: 'capture', points: pts });

  const { data: remaining } = await db
    .from('players')
    .select('id')
    .eq('game_id', game.id)
    .eq('status', 'active')
    .eq('role', 'survivor');
  if (!remaining || remaining.length === 0) {
    await finishGame(game.id);
  } else {
    await wake(game.id, 'infected');
  }
}

/** Geofence enforcement with a grace period and configurable penalty. */
export async function handleBounds(game: any, player: any, pos: LatLng) {
  const settings = game.settings as GameSettings;
  const inside = insideFence(settings.geofence, pos);

  if (inside) {
    if (player.out_of_bounds_since) {
      await db.from('players').update({ out_of_bounds_since: null }).eq('id', player.id);
      await emitEvent(game.id, 'back_in_bounds', player.id, {});
    }
    return true;
  }

  if (!player.out_of_bounds_since) {
    await db.from('players').update({ out_of_bounds_since: new Date().toISOString() }).eq('id', player.id);
    await emitEvent(game.id, 'oob_warning', player.id, { graceSec: OOB_GRACE_MS / 1000 });
    await wake(game.id, 'oob');
    return false;
  }

  const since = new Date(player.out_of_bounds_since).getTime();
  if (Date.now() - since >= OOB_GRACE_MS) {
    // Reset the clock so the penalty repeats at most once per grace window.
    await db.from('players').update({ out_of_bounds_since: new Date().toISOString() }).eq('id', player.id);
    if (settings.oobPenalty === 'reveal') {
      await db.from('pings').insert({
        game_id: game.id,
        audience: player.role === 'survivor' ? 'hunters' : 'survivors',
        kind: 'oob',
        points: [{ lat: pos.lat, lng: pos.lng, r: 25 }],
      });
      await emitEvent(game.id, 'oob_reveal', player.role === 'survivor' ? 'hunters' : 'survivors', { name: player.name });
      await emitEvent(game.id, 'oob_revealed_you', player.id, {});
      await wake(game.id, 'oob_reveal');
    } else if (settings.oobPenalty === 'infect' && player.role === 'survivor') {
      await infectPlayer(game, player, null, 'out_of_bounds', null);
    } else {
      await emitEvent(game.id, 'oob_warning', player.id, { graceSec: OOB_GRACE_MS / 1000 });
    }
  }
  return false;
}

/**
 * Anti-cheat: plausibility checks on reported locations.
 * Returns null if accepted, or a rejection reason.
 */
export async function vetLocation(player: any, pos: LatLng, accuracy: number): Promise<string | null> {
  if (!isFinite(pos.lat) || !isFinite(pos.lng) || Math.abs(pos.lat) > 90 || Math.abs(pos.lng) > 180) {
    return 'invalid';
  }
  if (accuracy > 150) return 'accuracy'; // too imprecise to be useful (or being faked badly)
  if (player.last_lat != null && player.last_loc_at) {
    const dt = (Date.now() - new Date(player.last_loc_at).getTime()) / 1000;
    if (dt > 0.5) {
      const speed = haversine({ lat: player.last_lat, lng: player.last_lng }, pos) / dt;
      if (speed > 15) {
        // > 54 km/h on foot: teleport / spoof. Keep last trusted fix, raise a flag.
        const flags = { ...(player.flags ?? {}), speed: ((player.flags?.speed as number) ?? 0) + 1 };
        await db.from('players').update({ flags }).eq('id', player.id);
        return 'speed';
      }
    }
  }
  return null;
}

export const CAPTURE_TOKEN_TTL_MS = 120 * 1000;
export const LOC_FRESH_FOR_CAPTURE_MS = 120 * 1000;
