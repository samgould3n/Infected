/**
 * Wake-up signal sent over Supabase Realtime (REST broadcast endpoint).
 * Deliberately carries no game data: clients refetch their role-scoped
 * state from /state, so visibility rules are always enforced server-side
 * and a player cannot read the other team's data off the channel.
 */
export async function wake(gameId: string, type: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: `game:${gameId}`, event: 'update', payload: { type }, private: false }],
      }),
    });
  } catch {
    /* non-fatal: clients also poll every 10s */
  }
}
