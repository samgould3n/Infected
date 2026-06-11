import { randomUUID } from 'crypto';
import { db } from '@/lib/server/db';
import { err } from '@/lib/server/auth';
import type { GameSettings } from '@/lib/types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code5 = () =>
  Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return err('Bad request'); }
  const name = String(body.hostName ?? '').trim().slice(0, 20);
  if (!name) return err('Enter your name');

  const s = body.settings ?? {};
  const settings: GameSettings = {
    durationMin: clamp(s.durationMin, 10, 240, 60),
    pingIntervalMin: clamp(s.pingIntervalMin, 2, 30, 10),
    maxPlayers: clamp(s.maxPlayers, 2, 60, 30),
    hunterCount: clamp(s.hunterCount, 1, 10, 2),
    captureRadiusM: clamp(s.captureRadiusM, 10, 100, 30),
    oobPenalty: ['warning', 'reveal', 'infect'].includes(s.oobPenalty) ? s.oobPenalty : 'reveal',
    huntersSeeEachOther: !!s.huntersSeeEachOther,
    decoysPerSurvivor: clamp(s.decoysPerSurvivor, 0, 5, 1),
    geofence: s.geofence,
  };
  const f = settings.geofence;
  const fenceOk =
    f &&
    ((f.type === 'circle' && f.center && f.radiusM && f.radiusM >= 100 && f.radiusM <= 10000) ||
      (f.type === 'polygon' && Array.isArray(f.points) && f.points.length >= 3));
  if (!fenceOk) return err('Set a play area on the map first');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = code5();
    const { data: game, error } = await db
      .from('games')
      .insert({ code, settings, status: 'lobby' })
      .select()
      .single();
    if (error) continue; // code collision, retry
    const token = randomUUID();
    const { data: player, error: pErr } = await db
      .from('players')
      .insert({ game_id: game.id, name, token })
      .select()
      .single();
    if (pErr || !player) return err('Could not create host player', 500);
    await db.from('games').update({ host_player: player.id }).eq('id', game.id);
    return Response.json({ gameId: game.id, code, playerId: player.id, token });
  }
  return err('Could not generate a room code, try again', 500);
}

function clamp(v: any, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}
