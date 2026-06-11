import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { emitEvent } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';
import type { GameSettings } from '@/lib/types';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);
  if (game.host_player !== me.id) return err('Only the host can start the game', 403);
  if (game.status !== 'lobby') return err('Game already started', 409);

  const { data: players } = await db
    .from('players')
    .select('*')
    .eq('game_id', game.id)
    .eq('status', 'active');
  if (!players || players.length < 2) return err('You need at least 2 players');

  const settings = game.settings as GameSettings;
  const hunterCount = Math.max(1, Math.min(settings.hunterCount, players.length - 1));
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const hunters = new Set(shuffled.slice(0, hunterCount).map((p) => p.id));

  for (const p of players) {
    const isHunter = hunters.has(p.id);
    await db
      .from('players')
      .update({
        role: isHunter ? 'hunter' : 'survivor',
        is_original_hunter: isHunter,
        decoys_left: isHunter ? 0 : settings.decoysPerSurvivor,
      })
      .eq('id', p.id);
  }

  const now = Date.now();
  const { error } = await db
    .from('games')
    .update({
      status: 'active',
      started_at: new Date(now).toISOString(),
      ends_at: new Date(now + settings.durationMin * 60000).toISOString(),
      next_ping_at: new Date(now + settings.pingIntervalMin * 60000).toISOString(),
    })
    .eq('id', game.id)
    .eq('status', 'lobby');
  if (error) return err('Could not start game', 500);

  await emitEvent(game.id, 'start', 'all', { hunters: hunterCount, players: players.length });
  await wake(game.id, 'start');
  return Response.json({ ok: true });
}
