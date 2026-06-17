import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';
import { insideFence } from '@/lib/geo';
import type { GameSettings, LatLng } from '@/lib/types';

/** Hunter places a Lure (fake pickup). Body: { at:{lat,lng} }. Consumes the held 'lure'. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.role !== 'hunter') return err('Only hunters can place a lure', 403);
  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game || game.status !== 'active') return err('Game is not running', 409);

  const held: string[] = (me.powerups as string[]) ?? [];
  if (!held.includes('lure')) return err('You do not have a Lure');

  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const at: LatLng = body.at;
  if (!at || !isFinite(at.lat) || !isFinite(at.lng)) return err('Tap the map to place the lure');
  const settings = game.settings as GameSettings;
  if (!insideFence(settings.geofence, at)) return err('Place it inside the play area');

  await db.from('nodes').insert({
    game_id: game.id, lat: at.lat, lng: at.lng, radius_m: 25, kind: 'lure', payload: { ownerId: me.id },
  });
  const i = held.indexOf('lure');
  await db.from('players').update({ powerups: held.filter((_, idx) => idx !== i) }).eq('id', me.id);
  await emitEvent(game.id, 'lure_placed', me.id, {});
  await wake(game.id, 'place');
  return Response.json({ ok: true });
}
