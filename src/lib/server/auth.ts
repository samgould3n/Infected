import { db } from './db';

/** Resolve the calling player from the x-player-token header, scoped to one game. */
export async function getPlayer(req: Request, gameId: string) {
  const token = req.headers.get('x-player-token');
  if (!token) return null;
  const { data } = await db
    .from('players')
    .select('*')
    .eq('token', token)
    .eq('game_id', gameId)
    .maybeSingle();
  return data ?? null;
}

export function err(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
