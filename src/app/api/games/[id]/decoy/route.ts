import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent } from '@/lib/server/engine';
import { fuzzPoint } from '@/lib/geo';

/** Survivor ability: arm a decoy. The next hunter ping includes a fake point near you. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.role !== 'survivor') return err('Only survivors have decoys', 403);
  const { data: game } = await db.from('games').select('id, status').eq('id', params.id).single();
  if (!game || game.status !== 'active') return err('Game is not running', 409);
  if ((me.decoys_left ?? 0) <= 0) return err('No decoys left');
  if (me.last_lat == null) return err('Waiting for your GPS fix');
  if (me.pending_decoy) return err('A decoy is already armed for the next ping');

  const decoy = fuzzPoint({ lat: me.last_lat, lng: me.last_lng }, 450);
  await db
    .from('players')
    .update({ pending_decoy: decoy, decoys_left: me.decoys_left - 1 })
    .eq('id', me.id);
  await emitEvent(game.id, 'decoy_set', me.id, {});
  return Response.json({ ok: true, decoysLeft: me.decoys_left - 1 });
}
