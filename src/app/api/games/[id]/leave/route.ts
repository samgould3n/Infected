import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent, finishGame } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  await db.from('players').update({ status: 'left' }).eq('id', me.id);
  await emitEvent(params.id, 'left', 'all', { name: me.name });

  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (game?.status === 'active') {
    const { data: remaining } = await db
      .from('players')
      .select('id, role')
      .eq('game_id', params.id)
      .eq('status', 'active');
    const s = (remaining ?? []).filter((p) => p.role === 'survivor').length;
    const h = (remaining ?? []).filter((p) => p.role === 'hunter').length;
    if (s === 0 || h === 0) await finishGame(params.id);
  }
  await wake(params.id, 'lobby');
  return Response.json({ ok: true });
}
