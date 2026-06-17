import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';
import { POWERUPS, MAX_INVENTORY, HUNTER_POOL } from '@/lib/powerups';

/**
 * Resolve a pending choice. Three cases share this endpoint:
 *  - survivor self-select pickup (pending_pickup_choices holds 3 ids) -> pick 1
 *  - newly-infected player choosing 1 of 3 hunter power-ups -> pick 1
 *  - original hunter's start-of-game loadout: pick 2 from the full hunter pool
 * Body: { id }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);

  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const id: string = body.id;
  if (!POWERUPS[id]) return err('Unknown power-up');

  const held: string[] = (me.powerups as string[]) ?? [];
  const choices: string[] = (me.pending_pickup_choices as string[]) ?? [];

  // Original-hunter start loadout: choose 2 from the full hunter pool, no duplicates.
  const isHunterLoadout =
    me.role === 'hunter' && me.is_original_hunter && choices.length === 0 && held.length < 2 &&
    body.loadout === true;
  if (isHunterLoadout) {
    if (!HUNTER_POOL.includes(id)) return err('Not a hunter power-up');
    if (held.includes(id)) return err('You already chose that one');
    const next = [...held, id];
    await db.from('players').update({ powerups: next }).eq('id', me.id);
    return Response.json({ ok: true, powerups: next, loadoutComplete: next.length >= 2 });
  }

  if (!choices.length) return err('Nothing to choose right now');
  if (!choices.includes(id)) return err('That is not one of your options');
  const next = held.length >= MAX_INVENTORY ? held : [...held, id];
  await db.from('players').update({ powerups: next, pending_pickup_choices: null }).eq('id', me.id);
  await emitEvent(params.id, 'pickup', me.id, { id });
  await wake(params.id, 'pickup');
  return Response.json({ ok: true, powerups: next });
}
