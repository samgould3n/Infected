import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import { haversine } from '@/lib/geo';
import { infectPlayer, LOC_FRESH_FOR_CAPTURE_MS } from '@/lib/server/engine';

/**
 * Capture verification (multi-signal):
 *  1. Physical tag in the real world (social trigger).
 *  2. Tagged survivor scans the hunter's rotating QR token (or types the
 *     6-character fallback code) — proves a face-to-face interaction and
 *     identifies exactly which hunter made the capture.
 *  3. Server cross-checks both phones' recent GPS fixes: both must be fresh
 *     and within captureRadiusM of each other (widened by reported GPS
 *     accuracy, capped) — defeats remote collusion / token sharing.
 *  4. Token is single-use and expires after 2 minutes — defeats replays.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);
  if (me.role !== 'survivor') return err('Only survivors can confirm a capture', 403);
  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game || game.status !== 'active') return err('Game is not running', 409);

  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }

  let hunter: any = null;
  let token = '';
  if (typeof body.qr === 'string' && body.qr.startsWith('MH1|')) {
    const [, gid, hid, t] = body.qr.split('|');
    if (gid !== game.id) return err('That QR code belongs to a different game');
    token = t ?? '';
    const { data } = await db.from('players').select('*').eq('id', hid).eq('game_id', game.id).maybeSingle();
    hunter = data;
  } else if (typeof body.code === 'string') {
    token = body.code.trim().toUpperCase();
    const { data } = await db
      .from('players')
      .select('*')
      .eq('game_id', game.id)
      .eq('capture_token', token)
      .maybeSingle();
    hunter = data;
  }

  if (!hunter || hunter.role !== 'hunter' || hunter.status !== 'active') {
    return err('Capture code not recognised');
  }
  if (
    !hunter.capture_token ||
    hunter.capture_token !== token ||
    !hunter.capture_token_expires ||
    new Date(hunter.capture_token_expires).getTime() < Date.now()
  ) {
    return err('That capture code has expired — ask the hunter to show a fresh one');
  }

  const freshEnough = (p: any) =>
    p.last_lat != null && p.last_loc_at && Date.now() - new Date(p.last_loc_at).getTime() < LOC_FRESH_FOR_CAPTURE_MS;
  if (!freshEnough(me) || !freshEnough(hunter)) {
    return err('Waiting for a recent GPS fix from both phones — stand still for a moment and try again');
  }

  const distance = haversine(
    { lat: me.last_lat, lng: me.last_lng },
    { lat: hunter.last_lat, lng: hunter.last_lng }
  );
  const slack = Math.min(50, ((me.last_accuracy ?? 0) + (hunter.last_accuracy ?? 0)) / 2);
  const allowed = (game.settings.captureRadiusM ?? 30) + slack;
  if (distance > allowed) {
    return err(`GPS check failed — your phones are ${Math.round(distance)}m apart`);
  }

  // Single-use: burn the token before applying the capture.
  await db
    .from('players')
    .update({ capture_token: null, capture_token_expires: null })
    .eq('id', hunter.id)
    .eq('capture_token', token);

  await infectPlayer(game, me, hunter, body.qr ? 'qr+gps' : 'code+gps', distance);
  return Response.json({ ok: true, newRole: 'hunter' });
}
