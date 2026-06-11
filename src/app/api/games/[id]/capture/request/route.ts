import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { CAPTURE_TOKEN_TTL_MS } from '@/lib/server/engine';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Hunter requests a short-lived capture token, shown as a QR code on their phone. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.role !== 'hunter') return err('Only hunters can capture', 403);
  const { data: game } = await db.from('games').select('id, status').eq('id', params.id).single();
  if (!game || game.status !== 'active') return err('Game is not running', 409);

  const token = Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  const expires = new Date(Date.now() + CAPTURE_TOKEN_TTL_MS).toISOString();
  await db.from('players').update({ capture_token: token, capture_token_expires: expires }).eq('id', me.id);
  return Response.json({
    qr: `MH1|${game.id}|${me.id}|${token}`,
    code: token,
    expiresInSec: CAPTURE_TOKEN_TTL_MS / 1000,
  });
}
