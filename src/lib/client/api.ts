'use client';

export interface Session {
  gameId: string;
  code: string;
  playerId: string;
  token: string;
}

export function getSession(code: string): Session | null {
  try {
    return JSON.parse(localStorage.getItem('mh:' + code.toUpperCase()) ?? 'null');
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem('mh:' + s.code.toUpperCase(), JSON.stringify(s));
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { 'x-player-token': opts.token } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as T;
}
