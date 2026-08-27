import { db } from './db';
import { wake } from './broadcast';
import {
  fuzzPoint, haversine, insideFence, destPoint,
  fenceCenter, randomPointInFence,
  circleInsideFence, scalePolygon, translatePolygon, polygonCentroid, pointInPolygon, polygonArea,
  circleDistanceForOverlap, estimatePolygonOverlapFrac,
} from '../geo';
import type { GameSettings, Geofence, LatLng, PingPoint } from '../types';
import { INFECTED_POOL, SURVIVOR_POOL, POWERUPS, MAX_INVENTORY } from '../powerups';

const STALE_LOC_MS = 3 * 60 * 1000;
export const CAPTURE_TOKEN_TTL_MS = 120 * 1000;
export const LOC_FRESH_FOR_CAPTURE_MS = 120 * 1000;

const OOB_TIER1_MS = 5 * 1000;
const OOB_TIER2_BREACHES = 2;
const FENCE_WARN_MS = 30 * 1000;
export const ADRENALINE_MS = 2 * 60 * 1000;
export const DEADZONE_MS = 5 * 60 * 1000;
export const LURE_TRACK_MS = 30 * 1000;
export const RESURRECT_IMMUNE_MS = 30 * 1000;

export async function emitEvent(
  gameId: string, type: string, audience: string, payload: Record<string, unknown> = {}
) {
  await db.from('events').insert({ game_id: gameId, type, audience, payload });
}

export function effActive(player: any, key: string): boolean {
  const e = player.effects?.[key];
  return !!e && new Date(e).getTime() > Date.now();
}
async function setEffect(playerId: string, current: any, key: string, until: number) {
  const effects = { ...(current ?? {}), [key]: new Date(until).toISOString() };
  await db.from('players').update({ effects }).eq('id', playerId);
  return effects;
}
async function clearEffect(playerId: string, current: any, key: string) {
  const e = { ...(current ?? {}) };
  delete e[key];
  await db.from('players').update({ effects: e }).eq('id', playerId);
}

// ── moving fence ─────────────────────────────────────────────────────
export function initialActiveFence(settings: GameSettings, start: LatLng): Geofence {
  const master = settings.geofence;
  if (master.type === 'circle') {
    const r = Math.min(settings.activeRadiusM ?? (master.radiusM ?? 800), master.radiusM ?? 800);
    let center = start;
    if (!circleInsideFence(master, center, r)) center = master.center ?? start;
    return { type: 'circle', center, radiusM: r };
  }
  const frac = Math.min(1, Math.max(0.05, settings.activeAreaFrac ?? 0.5));
  const k = Math.sqrt(frac);
  return { type: 'polygon', points: scalePolygon(master.points!, k) };
}

export function nextActiveFence(master: Geofence, active: Geofence): Geofence {
  // Keep consecutive play areas from relocating too wildly or barely moving at all —
  // target a random 10–40% area overlap between the old and new active fence.
  const targetOverlap = 0.10 + Math.random() * 0.30;

  if (active.type === 'circle' && active.radiusM && active.center) {
    const d = circleDistanceForOverlap(active.radiusM, targetOverlap);
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const center = destPoint(active.center, d, angle);
      if (circleInsideFence(master, center, active.radiusM)) return { type: 'circle', center, radiusM: active.radiusM };
    }
    // Master too small to hit the target overlap at this distance — fall back to any valid spot.
    for (let i = 0; i < 80; i++) {
      const c = randomPointInFence(master);
      if (circleInsideFence(master, c, active.radiusM)) return { type: 'circle', center: c, radiusM: active.radiusM };
    }
    return { type: 'circle', center: fenceCenter(master), radiusM: active.radiusM };
  }

  const pts = active.points!;
  const c = polygonCentroid(pts);
  // Approximate the polygon's "radius" to translate a reasonable trial distance for the target overlap,
  // then verify each candidate against the actual shape via Monte Carlo before accepting it.
  const approxR = Math.sqrt(polygonArea(pts) / Math.PI);
  const d = circleDistanceForOverlap(approxR, targetOverlap);
  let best: Geofence | null = null;
  let bestErr = Infinity;
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const target = destPoint(c, d, angle);
    const moved = translatePolygon(pts, target.lat - c.lat, target.lng - c.lng);
    if (!master.points || !moved.every((p) => pointInPolygon(p, master.points!))) continue;
    const overlap = estimatePolygonOverlapFrac(pts, moved, 150);
    const err = Math.abs(overlap - targetOverlap);
    if (err < bestErr) { bestErr = err; best = { type: 'polygon', points: moved }; }
    if (overlap >= 0.10 && overlap <= 0.40) return { type: 'polygon', points: moved }; // good enough, stop early
  }
  if (best) return best; // closest valid candidate found, even if outside the exact band
  return active; // master too constrained to move at all
}

export function shrinkFence(active: Geofence): Geofence {
  const k = Math.sqrt(0.925);
  if (active.type === 'circle' && active.radiusM) {
    return { type: 'circle', center: active.center!, radiusM: active.radiusM * k };
  }
  return { type: 'polygon', points: scalePolygon(active.points!, k) };
}

export function currentFence(game: any): Geofence {
  return (game.active_fence as Geofence) ?? (game.settings as GameSettings).geofence;
}

// ── lazy clock ───────────────────────────────────────────────────────
export async function tickIfDue(game: any) {
  if (game.status !== 'active') return;
  const nowIso = new Date().toISOString();
  if (game.ends_at && game.ends_at <= nowIso) { await finishGame(game.id); return; }

  const settings = game.settings as GameSettings;
  if (settings.fenceMoves && game.fence_move_at && game.fence_move_at <= nowIso && game.next_fence) {
    const nextMove = new Date(Date.now() + settings.fenceMoveMin * 60000).toISOString();
    const warnAt = new Date(Date.now() + settings.fenceMoveMin * 60000 - FENCE_WARN_MS).toISOString();
    const upcoming = nextActiveFence(game.master_fence ?? settings.geofence, game.next_fence);
    const { data: claimed } = await db
      .from('games')
      .update({ active_fence: game.next_fence, next_fence: upcoming, fence_move_at: nextMove, fence_warn_at: warnAt })
      .eq('id', game.id).eq('status', 'active').lte('fence_move_at', nowIso).select();
    if (claimed && claimed.length) {
      await emitEvent(game.id, 'fence_moved', 'all', {});
      await wake(game.id, 'fence');
      game = claimed[0];
    }
  }

  if (!game.next_ping_at || game.next_ping_at > nowIso) return;
  const nextAt = new Date(Date.now() + settings.pingIntervalMin * 60000).toISOString();
  const { data: claimed } = await db
    .from('games').update({ next_ping_at: nextAt })
    .eq('id', game.id).eq('status', 'active').lte('next_ping_at', nowIso).select();
  if (!claimed || claimed.length === 0) return;
  await doPingRound(claimed[0]);
}

export function hunterFuzzRadius(game: any): number {
  if (!game.started_at || !game.ends_at) return 0;
  const start = new Date(game.started_at).getTime();
  const end = new Date(game.ends_at).getTime();
  const frac = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  if (frac < 1 / 3) return 0;
  if (frac < 2 / 3) return 150;
  return 400;
}

async function doPingRound(game: any) {
  const { data: players } = await db.from('players').select('*').eq('game_id', game.id).eq('status', 'active');
  if (!players) return;
  const fresh = (p: any) =>
    p.last_lat != null && p.last_loc_at && Date.now() - new Date(p.last_loc_at).getTime() < STALE_LOC_MS;

  const survivors = players.filter((p) => p.role === 'survivor');
  const hunters = players.filter((p) => p.role === 'hunter');
  const anyNightVision = hunters.some((h) => effActive(h, 'night_vision'));
  const fuzz = anyNightVision ? 0 : hunterFuzzRadius(game);

  const { data: dz } = await db
    .from('nodes').select('*').eq('game_id', game.id).eq('kind', 'deadzone').gt('expires_at', new Date().toISOString());
  const deadzones = dz ?? [];
  const hiddenByDeadzone = (p: any) =>
    deadzones.some((z) => z.payload?.ownerId === p.id &&
      haversine({ lat: z.lat, lng: z.lng }, { lat: p.last_lat, lng: p.last_lng }) <= z.radius_m);

  const toHunters: PingPoint[] = [];
  for (const s of survivors) {
    if (effActive(s, 'cloak')) { await clearEffect(s.id, s.effects, 'cloak'); continue; }
    if (s.last_lat != null && hiddenByDeadzone(s)) continue;
    const decoyN = effActive(s, 'super_decoy') ? 5 : effActive(s, 'decoy') ? 3 : 0;
    if (fresh(s)) {
      const fp = fuzzPoint({ lat: s.last_lat, lng: s.last_lng }, fuzz);
      toHunters.push({ lat: fp.lat, lng: fp.lng, r: Math.max(fuzz, 25) });
    }
    if (decoyN > 0) {
      for (let i = 0; i < decoyN - 1; i++) {
        const d = randomPointInFence(currentFence(game));
        toHunters.push({ lat: d.lat, lng: d.lng, r: Math.max(fuzz, 25) });
      }
      await clearEffect(s.id, s.effects, decoyN === 5 ? 'super_decoy' : 'decoy');
    }
    if (s.pending_decoy) {
      const d = s.pending_decoy as LatLng;
      toHunters.push({ lat: d.lat, lng: d.lng, r: Math.max(fuzz, 25) });
    }
  }
  const toSurvivors: PingPoint[] = hunters.filter(fresh).map((h) => ({ lat: h.last_lat, lng: h.last_lng, r: 30 }));

  await db.from('pings').insert([
    { game_id: game.id, audience: 'hunters', kind: 'tick', points: toHunters },
    { game_id: game.id, audience: 'survivors', kind: 'tick', points: toSurvivors },
  ]);
  await db.from('players').update({ pending_decoy: null }).eq('game_id', game.id).not('pending_decoy', 'is', null);
  for (const h of hunters) {
    if (effActive(h, 'night_vision')) {
      const left = (h.effects?.night_vision_pings ?? 2) - 1;
      if (left <= 0) await clearEffect(h.id, h.effects, 'night_vision');
      else await db.from('players').update({ effects: { ...h.effects, night_vision_pings: left } }).eq('id', h.id);
    }
  }
  await maybeSpawnNodes(game, survivors.length);
  await emitEvent(game.id, 'ping', 'all', { fuzz });
  await wake(game.id, 'ping');
}

// ── pickup nodes ──────────────────────────────────────────────────────
export async function maybeSpawnNodes(game: any, survivorsLeft: number) {
  if (survivorsLeft <= 0) return;
  const { data: existing } = await db
    .from('nodes').select('id').eq('game_id', game.id).eq('kind', 'pickup').is('claimed_by', null);
  const have = existing?.length ?? 0;
  const target = Math.max(1, Math.round(5 / Math.max(1, survivorsLeft)) + 1);
  const toAdd = Math.max(0, target - have);
  if (toAdd <= 0) return;
  const fence = currentFence(game);
  const rows = [];
  for (let i = 0; i < toAdd; i++) {
    const p = randomPointInFence(fence);
    rows.push({
      game_id: game.id, lat: p.lat, lng: p.lng, radius_m: 45, kind: 'pickup', payload: {},
      expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
    });
  }
  if (rows.length) await db.from('nodes').insert(rows);
}

// ── game end / infection ──────────────────────────────────────────────
export async function finishGame(gameId: string) {
  const { data: players } = await db
    .from('players').select('id, role, status').eq('game_id', gameId).eq('status', 'active');
  const survivorsLeft = (players ?? []).filter((p) => p.role === 'survivor').length;
  const winner = survivorsLeft > 0 ? 'survivors' : 'hunters';
  const { data: claimed } = await db
    .from('games').update({ status: 'finished', winner })
    .eq('id', gameId).eq('status', 'active').select();
  if (!claimed || claimed.length === 0) return;
  await emitEvent(gameId, 'game_over', 'all', { winner, survivorsLeft });
  await wake(gameId, 'game_over');
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export async function infectPlayer(
  game: any, survivor: any, hunter: any | null, method: string, distanceM: number | null
) {
  const held: string[] = (survivor.powerups as string[]) ?? [];
  const dropRows = held.filter((id) => SURVIVOR_POOL.includes(id)).map((id) => {
    const p = randomPointInFence(currentFence(game));
    return {
      game_id: game.id, lat: p.lat, lng: p.lng, radius_m: 45, kind: 'drop',
      payload: { powerupId: id }, expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
    };
  });
  if (dropRows.length) await db.from('nodes').insert(dropRows);

  const offer = pickRandom(INFECTED_POOL, 3);
  await db.from('players').update({
    role: 'hunter', is_original_hunter: false, captured_at: new Date().toISOString(),
    decoys_left: 0, pending_decoy: null, powerups: [], effects: {}, pending_pickup_choices: offer,
  }).eq('id', survivor.id);

  await db.from('captures').insert({
    game_id: game.id, hunter_id: hunter?.id ?? null, survivor_id: survivor.id, method, distance_m: distanceM,
  });
  await emitEvent(game.id, 'infected', 'all', { name: survivor.name, by: hunter?.name ?? null, method });
  await emitEvent(game.id, 'choose_powerup', survivor.id, { offer });

  const { data: hunters } = await db
    .from('players').select('*').eq('game_id', game.id).eq('status', 'active').eq('role', 'hunter');
  const pts: PingPoint[] = (hunters ?? []).filter((h) => h.last_lat != null)
    .map((h) => ({ lat: h.last_lat, lng: h.last_lng, r: 50 }));
  await db.from('pings').insert({ game_id: game.id, audience: 'survivors', kind: 'capture', points: pts });

  const { data: remaining } = await db
    .from('players').select('id').eq('game_id', game.id).eq('status', 'active').eq('role', 'survivor');
  if (!remaining || remaining.length === 0) await finishGame(game.id);
  else await wake(game.id, 'infected');
}

export async function resurrectRandom(game: any): Promise<string | null> {
  const { data: infected } = await db
    .from('players').select('*').eq('game_id', game.id).eq('status', 'active')
    .eq('role', 'hunter').eq('is_original_hunter', false);
  if (!infected || infected.length === 0) return null;
  const target = infected[Math.floor(Math.random() * infected.length)];
  const immuneUntil = Date.now() + RESURRECT_IMMUNE_MS;
  await db.from('players').update({
    role: 'survivor', captured_at: null, powerups: [],
    effects: { immune: new Date(immuneUntil).toISOString(), adrenaline: new Date(immuneUntil).toISOString() },
    pending_pickup_choices: null,
  }).eq('id', target.id);
  await emitEvent(game.id, 'resurrected', 'all', { name: target.name });
  await emitEvent(game.id, 'you_resurrected', target.id, {});
  await wake(game.id, 'resurrect');
  return target.name;
}

// ── tiered out-of-bounds ──────────────────────────────────────────────
export async function handleBounds(game: any, player: any, pos: LatLng) {
  const fence = currentFence(game);
  const { data: dz } = await db
    .from('nodes').select('*').eq('game_id', game.id).eq('kind', 'deadzone').gt('expires_at', new Date().toISOString());
  const inDead = (dz ?? []).some((z) => haversine({ lat: z.lat, lng: z.lng }, pos) <= z.radius_m);
  const inside = inDead || insideFence(fence, pos);

  if (inside) {
    if (player.out_of_bounds_since) {
      await db.from('players').update({ out_of_bounds_since: null }).eq('id', player.id);
      await emitEvent(game.id, 'back_in_bounds', player.id, {});
    }
    return true;
  }

  if (!player.out_of_bounds_since) {
    await db.from('players').update({
      out_of_bounds_since: new Date().toISOString(),
      oob_breaches: (player.oob_breaches ?? 0) + 1,
    }).eq('id', player.id);
    await emitEvent(game.id, 'oob_warning', player.id, { graceSec: OOB_TIER1_MS / 1000 });
    await wake(game.id, 'oob');
    return false;
  }

  const out = Date.now() - new Date(player.out_of_bounds_since).getTime();
  if (out >= OOB_TIER1_MS) {
    await db.from('pings').insert({
      game_id: game.id,
      audience: player.role === 'survivor' ? 'hunters' : 'survivors',
      kind: 'oob', points: [{ lat: pos.lat, lng: pos.lng, r: 20 }],
    });
    await emitEvent(game.id, 'oob_reveal', player.role === 'survivor' ? 'hunters' : 'survivors', { name: player.name });
    await emitEvent(game.id, 'oob_revealed_you', player.id, {});
    if ((player.oob_breaches ?? 0) >= OOB_TIER2_BREACHES) {
      const held: string[] = (player.powerups as string[]) ?? [];
      if (held.length) {
        const idx = Math.floor(Math.random() * held.length);
        const lost = held[idx];
        await db.from('players').update({ powerups: held.filter((_, i) => i !== idx) }).eq('id', player.id);
        await emitEvent(game.id, 'oob_lost_powerup', player.id, { lost });
      }
    }
    await wake(game.id, 'oob_reveal');
  }
  return false;
}

export async function vetLocation(player: any, pos: LatLng, accuracy: number): Promise<string | null> {
  if (!isFinite(pos.lat) || !isFinite(pos.lng) || Math.abs(pos.lat) > 90 || Math.abs(pos.lng) > 180) return 'invalid';
  if (accuracy > 150) return 'accuracy';
  if (effActive(player, 'adrenaline')) return null;
  if (player.last_lat != null && player.last_loc_at) {
    const dt = (Date.now() - new Date(player.last_loc_at).getTime()) / 1000;
    if (dt > 0.5) {
      const speed = haversine({ lat: player.last_lat, lng: player.last_lng }, pos) / dt;
      if (speed > 15) {
        const flags = { ...(player.flags ?? {}), speed: ((player.flags?.speed as number) ?? 0) + 1 };
        await db.from('players').update({ flags }).eq('id', player.id);
        return 'speed';
      }
    }
  }
  return null;
}

// ── node interactions on each location update ─────────────────────────
export async function handleNodes(game: any, player: any, pos: LatLng) {
  const { data: nodes } = await db.from('nodes').select('*').eq('game_id', game.id).is('claimed_by', null);
  if (!nodes) return;
  const now = Date.now();
  for (const n of nodes) {
    if (n.expires_at && new Date(n.expires_at).getTime() < now) continue;
    if (haversine({ lat: n.lat, lng: n.lng }, pos) > n.radius_m) continue;

    if (n.kind === 'lure' && player.role === 'survivor') {
      await db.from('nodes').update({ claimed_by: player.id }).eq('id', n.id).is('claimed_by', null);
      await setEffect(player.id, player.effects, 'tracked', now + LURE_TRACK_MS);
      await emitEvent(game.id, 'lure_sprung', 'hunters', { name: player.name });
      await emitEvent(game.id, 'you_flagged', player.id, { untilSec: LURE_TRACK_MS / 1000 });
      await wake(game.id, 'lure');
      continue;
    }
    if (n.kind === 'tripwire' && player.role === 'hunter') {
      const owner = n.payload?.ownerId as string | undefined;
      if (owner && owner !== player.id) {
        await db.from('pings').insert({
          game_id: game.id, audience: 'survivors', kind: 'capture',
          points: [{ lat: pos.lat, lng: pos.lng, r: 25 }],
        });
        await emitEvent(game.id, 'tripwire_hit', owner, { lat: pos.lat, lng: pos.lng });
        await wake(game.id, 'tripwire');
      }
      continue;
    }
    if ((n.kind === 'pickup' || n.kind === 'drop') && player.role === 'survivor') {
      await grantPickup(game, player, n);
      continue;
    }
  }
}

async function grantPickup(game: any, player: any, node: any) {
  const held: string[] = (player.powerups as string[]) ?? [];
  if (held.length >= MAX_INVENTORY) return;
  if (node.kind === 'drop') {
    const id = node.payload?.powerupId as string;
    if (!id || held.includes(id)) return;
    await db.from('nodes').update({ claimed_by: player.id }).eq('id', node.id).is('claimed_by', null);
    await db.from('players').update({ powerups: [...held, id] }).eq('id', player.id);
    await emitEvent(game.id, 'pickup', player.id, { id });
    await wake(game.id, 'pickup');
    return;
  }
  const selfSelect = await isSelfSelect(game);
  if (selfSelect) {
    if (player.pending_pickup_choices) return;
    const options = pickRandom(SURVIVOR_POOL.filter((id) => !held.includes(id)), 3);
    if (options.length === 0) return;
    await db.from('nodes').update({ claimed_by: player.id }).eq('id', node.id).is('claimed_by', null);
    await db.from('players').update({ pending_pickup_choices: options }).eq('id', player.id);
    await emitEvent(game.id, 'pickup_choose', player.id, { options });
    await wake(game.id, 'pickup');
  } else {
    const pool = SURVIVOR_POOL.filter((id) => !held.includes(id));
    if (pool.length === 0) return;
    const id = weightedRandomByPhase(game, pool);
    await db.from('nodes').update({ claimed_by: player.id }).eq('id', node.id).is('claimed_by', null);
    await db.from('players').update({ powerups: [...held, id] }).eq('id', player.id);
    await emitEvent(game.id, 'pickup', player.id, { id });
    await wake(game.id, 'pickup');
  }
}

function weightedRandomByPhase(game: any, pool: string[]): string {
  const start = game.started_at ? new Date(game.started_at).getTime() : Date.now();
  const end = game.ends_at ? new Date(game.ends_at).getTime() : Date.now() + 1;
  const frac = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  const rw: Record<string, number> = { common: 1, rare: 0.2 + frac * 1.3, ultra: frac * frac * 0.8 };
  const weights = pool.map((id) => rw[(POWERUPS[id]?.rarity ?? 'common')] ?? 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

export async function isSelfSelect(game: any): Promise<boolean> {
  if (game.started_at && game.ends_at) {
    const start = new Date(game.started_at).getTime();
    const end = new Date(game.ends_at).getTime();
    if ((Date.now() - start) / (end - start) >= 2 / 3) return true;
  }
  const { data: players } = await db.from('players').select('role, is_original_hunter').eq('game_id', game.id);
  const all = players ?? [];
  const originalHunters = all.filter((p) => p.is_original_hunter).length;
  const originalSurvivors = all.length - originalHunters;
  if (originalSurvivors <= 0) return false;
  const survivorsNow = all.filter((p) => p.role === 'survivor').length;
  return (originalSurvivors - survivorsNow) / originalSurvivors >= 0.7;
}
