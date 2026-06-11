import { randomUUID } from 'crypto';
import { db } from '@/lib/server/db';
import { err } from '@/lib/server/auth';
import { emitEvent } from '@/lib/server/engine';
import { wake } from '@/lib/server/broadcast';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim().slice(0, 20);
  if (!code || !name) return err('Enter a room code and your name');

  const { data: game } = await db.from('games').select('*').eq('code', code).maybeSingle();
  if (!game) return err('No game found with that code', 404);
  if (game.status !== 'lobby') return err('That game has already started', 403);

  const { count } = await db
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)
    .eq('status', 'active');
  if ((count ?? 0) >= game.settings.maxPlayers) return err('That game is full', 403);

  const token = randomUUID();
  const { data: player, error } = await db
    .from('players')
    .insert({ game_id: game.id, name, token })
    .select()
    .single();
  if (error || !player) return err('Could not join, try again', 500);
  await emitEvent(game.id, 'joined', 'all', { name });
  await wake(game.id, 'lobby');
  return Response.json({ gameId: game.id, code, playerId: player.id, token });
}
