import { db } from '@/lib/server/db';
import { err, getPlayer } from '@/lib/server/auth';
import type { PingPoint } from '@/lib/types';

/**
 * DEV-ONLY debugging endpoint: streams every player's raw, unfuzzed live position plus every
 * map node regardless of role, so a developer can watch the true game state while testing.
 * Never used by the normal player UI — gated behind DEBUG_KEY so it can't leak into a real match.
 * Still requires a valid player token for this game (two-factor: a real session + the debug key).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const debugKey = process.env.DEBUG_KEY;
  if (!debugKey) return err('Debug mode is not enabled on this deployment', 404);
  const providedKey = req.headers.get('x-debug-key');
  if (providedKey !== debugKey) return err('Invalid debug key', 403);

  const me = await getPlayer(req, params.id);
  if (!me) return err('Not in this game', 401);

  const { data: game } = await db.from('games').select('*').eq('id', params.id).single();
  if (!game) return err('Game not found', 404);

  const { data: players } = await db
    .from('players')
    .select('id, name, role, status, is_original_hunter, last_lat, last_lng, last_loc_at, out_of_bounds_since')
    .eq('game_id', game.id)
    .order('joined_at');

  const { data: rawNodes } = await db.from('nodes').select('*').eq('game_id', game.id).is('claimed_by', null);

  // Both audiences' normal (fuzzed/role-gated) ping trails, for side-by-side comparison with raw positions.
  const { data: hunterPings } = await db
    .from('pings').select('*').eq('game_id', game.id).eq('audience', 'hunters')
    .order('created_at', { ascending: false }).limit(1);
  const { data: survivorPings } = await db
    .from('pings').select('*').eq('game_id', game.id).eq('audience', 'survivors')
    .order('created_at', { ascending: false }).limit(1);

  return Response.json({
    game: {
      id: game.id, code: game.code, status: game.status,
      masterFence: game.master_fence ?? game.settings.geofence,
      activeFence: game.active_fence ?? null,
      nextFence: game.next_fence ?? null,
      serverNow: new Date().toISOString(),
    },
    players: (players ?? []).map((p) => ({
      id: p.id, name: p.name, role: p.role, status: p.status, isOriginalHunter: p.is_original_hunter,
      lat: p.last_lat, lng: p.last_lng, lastLocAt: p.last_loc_at, outOfBoundsSince: p.out_of_bounds_since,
    })),
    nodes: (rawNodes ?? []).map((n) => ({
      id: n.id, lat: n.lat, lng: n.lng, radiusM: n.radius_m, kind: n.kind,
      ownerId: n.payload?.ownerId ?? null, powerupId: n.payload?.powerupId ?? null, expiresAt: n.expires_at,
    })),
    fuzzedPings: {
      toHunters: (hunterPings?.[0]?.points as PingPoint[] | undefined) ?? [],
      toSurvivors: (survivorPings?.[0]?.points as PingPoint[] | undefined) ?? [],
    },
  });
}
