import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import {
  emitEvent, resurrectRandom, shrinkFence, currentFence,
  ADRENALINE_MS, DEADZONE_MS,
} from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';
import { POWERUPS } from '@/lib/powerups';
import { haversine, insideFence, fenceArea } from '@/lib/geo';
import type { GameSettings, LatLng } from '@/lib/types';

/** Activate a held power-up. Body: { id, at?: {lat,lng} } for placed power-ups. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.status !== 'active') return err('You have left this game', 403);
  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game || game.status !== 'active') return err('Game is not running', 409);

  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const id: string = body.id;
  const def = POWERUPS[id];
  if (!def) return err('Unknown power-up');

  const held: string[] = (me.powerups as string[]) ?? [];
  if (!held.includes(id)) return err('You do not have that power-up');
  if (def.team !== me.role) return err('Wrong team for that power-up');

  const settings = game.settings as GameSettings;
  // remove a single instance of the activated power-up
  const removeOne = () => { const i = held.indexOf(id); return held.filter((_, idx) => idx !== i); };

  const now = Date.now();
  const setMyEffect = async (key: string, ms: number, extra: Record<string, unknown> = {}) => {
    const effects = { ...(me.effects ?? {}), [key]: new Date(now + ms).toISOString(), ...extra };
    await db.from('players').update({ effects, powerups: removeOne() }).eq('id', me.id);
  };

  switch (id) {
    // ── survivor ──
    case 'decoy':
    case 'super_decoy':
      await setMyEffect(id, settings.pingIntervalMin * 60000 + 5000);
      break;
    case 'cloak':
      await setMyEffect('cloak', settings.pingIntervalMin * 60000 + 5000);
      break;
    case 'adrenaline':
      await setMyEffect('adrenaline', ADRENALINE_MS);
      break;
    case 'sonar':
      await setMyEffect('sonar', settings.pingIntervalMin * 60000);
      break;
    case 'resurrection': {
      const name = await resurrectRandom(game);
      if (!name) return err('There is no infected player to revive yet');
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      break;
    }
    case 'counter_trap': {
      const { data: lures } = await db
        .from('nodes').select('id, lat, lng').eq('game_id', game.id).eq('kind', 'lure').is('claimed_by', null);
      await emitEvent(game.id, 'traps_revealed', 'survivors',
        { traps: (lures ?? []).map((l) => ({ lat: l.lat, lng: l.lng })) });
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      await wake(game.id, 'counter');
      break;
    }
    case 'tripwire':
    case 'dead_zone': {
      const at: LatLng = body.at;
      if (!at || !isFinite(at.lat) || !isFinite(at.lng)) return err('Tap the map to place it');
      if (!insideFence(settings.geofence, at)) return err('Place it inside the play area');
      if (id === 'tripwire') {
        await db.from('nodes').insert({
          game_id: game.id, lat: at.lat, lng: at.lng, radius_m: 20, kind: 'tripwire',
          payload: { ownerId: me.id },
        });
      } else {
        // dead zone radius ≈ 10% of current active area
        const area = fenceArea(currentFence(game)) * 0.1;
        const radius = Math.max(40, Math.sqrt(area / Math.PI));
        await db.from('nodes').insert({
          game_id: game.id, lat: at.lat, lng: at.lng, radius_m: radius, kind: 'deadzone',
          payload: { ownerId: me.id }, expires_at: new Date(now + DEADZONE_MS).toISOString(),
        });
      }
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      await wake(game.id, 'place');
      break;
    }

    // ── hunter ──
    case 'scent': {
      const { data: survivors } = await db
        .from('players').select('name, last_lat, last_lng, last_loc_at')
        .eq('game_id', game.id).eq('status', 'active').eq('role', 'survivor');
      const mine = { lat: me.last_lat, lng: me.last_lng };
      let best: any = null, bestD = Infinity;
      for (const s of survivors ?? []) {
        if (s.last_lat == null) continue;
        const d = haversine(mine, { lat: s.last_lat, lng: s.last_lng });
        if (d < bestD) { bestD = d; best = s; }
      }
      if (!best) return err('No survivor location available yet');
      await db.from('pings').insert({
        game_id: game.id, audience: 'hunters', kind: 'capture',
        points: [{ lat: best.last_lat, lng: best.last_lng, r: 15 }],
      });
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      await emitEvent(game.id, 'scent', 'hunters', { name: best.name });
      await wake(game.id, 'scent');
      break;
    }
    case 'alert':
      // accelerate the next ping: bring next_ping_at forward
      await db.from('games').update({ next_ping_at: new Date(now + 15000).toISOString() }).eq('id', game.id);
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      await emitEvent(game.id, 'alert', 'hunters', {});
      await wake(game.id, 'alert');
      break;
    case 'night_vision':
      await setMyEffect('night_vision', settings.pingIntervalMin * 60000 * 2 + 5000, { night_vision_pings: 2 });
      break;
    case 'constrict': {
      if (!me.is_original_hunter) return err('Only original hunters can use Constrict');
      if (game.constrict_used) return err('Constrict has already been used this match');
      const { data: players } = await db
        .from('players').select('id').eq('game_id', game.id).eq('status', 'active').eq('role', 'survivor');
      if ((players?.length ?? 0) <= 2) return err('Cannot use Constrict with 2 or fewer survivors left');
      const shrunk = shrinkFence(currentFence(game));
      await db.from('games').update({ active_fence: shrunk, constrict_used: true }).eq('id', game.id);
      await db.from('players').update({ powerups: removeOne() }).eq('id', me.id);
      await emitEvent(game.id, 'constrict', 'all', {});
      await wake(game.id, 'fence');
      break;
    }
    default:
      return err('That power-up cannot be activated');
  }

  return Response.json({ ok: true });
}
