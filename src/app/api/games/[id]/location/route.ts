import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { handleBounds, tickIfDue, vetLocation } from '@/lib/server/engine';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.status !== 'active') return err('You have left this game', 403);
  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const pos = { lat: Number(body.lat), lng: Number(body.lng) };
  const accuracy = Number(body.accuracy ?? 999);

  const rejected = await vetLocation(me, pos, accuracy);
  if (rejected) return Response.json({ ok: false, reason: rejected });

  await db
    .from('players')
    .update({
      last_lat: pos.lat,
      last_lng: pos.lng,
      last_accuracy: accuracy,
      last_loc_at: new Date().toISOString(),
    })
    .eq('id', me.id);

  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);

  let inBounds = true;
  if (game.status === 'active') {
    inBounds = await handleBounds(game, me, pos);
    await tickIfDue(game);
  }
  return Response.json({ ok: true, inBounds });
}
