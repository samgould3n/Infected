'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { getSession } from '@/lib/client/api';
import type { Geofence, PingPoint } from '@/lib/types';

const GameMap = dynamic(() => import('@/components/GameMap'), { ssr: false });

const POLL_MS = 3_000; // continuous fast refresh — this view is for debugging, not for players

interface DebugPlayer {
  id: string; name: string; role: 'hunter' | 'survivor' | null; status: string; isOriginalHunter: boolean;
  lat: number | null; lng: number | null; lastLocAt: string | null; outOfBoundsSince: string | null;
}
interface DebugNode {
  id: string; lat: number; lng: number; radiusM: number; kind: string;
  ownerId: string | null; powerupId: string | null; expiresAt: string | null;
}
interface DebugState {
  game: { id: string; code: string; status: string; masterFence: Geofence; activeFence: Geofence | null; nextFence: Geofence | null; serverNow: string };
  players: DebugPlayer[];
  nodes: DebugNode[];
  fuzzedPings: { toHunters: PingPoint[]; toSurvivors: PingPoint[] };
}

/**
 * DEV-ONLY page. Streams every player's true, unfuzzed position continuously (no role-based fog
 * of war), alongside the normal fuzzed ping trail for comparison. Requires an existing player
 * session for this game code AND the deployment's DEBUG_KEY — never linked to from the normal
 * game UI, and the API silently 404s if DEBUG_KEY isn't set on the server at all.
 */
export default function DebugPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const [debugKey, setDebugKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [data, setData] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('mh:debugKey');
    if (saved) { setDebugKey(saved); setKeyInput(saved); }
  }, []);

  const refresh = useCallback(async () => {
    const session = getSession(code);
    if (!session) { setError('No active session for this game code — join or host it in a normal tab first.'); return; }
    if (!debugKey) return;
    try {
      const res = await fetch(`/api/games/${session.gameId}/debug`, {
        headers: { 'x-player-token': session.token, 'x-debug-key': debugKey },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Debug request failed'); return; }
      setError(null);
      setData(json);
    } catch {
      setError('Network error');
    }
  }, [code, debugKey]);

  useEffect(() => {
    if (!debugKey) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [debugKey, refresh]);

  if (!debugKey) {
    return (
      <main className="wrap" style={{ justifyContent: 'center' }}>
        <p className="eyebrow">dev debug view · {code}</p>
        <div className="panel">
          <label className="field"><span>Debug key</span>
            <input className="input" type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={!keyInput.trim()}
            onClick={() => { localStorage.setItem('mh:debugKey', keyInput.trim()); setDebugKey(keyInput.trim()); }}
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="wrap" style={{ justifyContent: 'center' }}>
        <p className="error">{error}</p>
        <button className="btn ghost" onClick={() => { localStorage.removeItem('mh:debugKey'); setDebugKey(''); }}>
          Re-enter key
        </button>
      </main>
    );
  }

  if (!data) {
    return <main className="wrap" style={{ justifyContent: 'center', textAlign: 'center' }}><p className="eyebrow">loading…</p></main>;
  }

  const allFuzzed = [...data.fuzzedPings.toHunters, ...data.fuzzedPings.toSurvivors];
  const nodesForMap = data.nodes.map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, radiusM: n.radiusM, kind: n.kind as any, expiresAt: n.expiresAt }));

  return (
    <main className="wrap">
      <div className="hud">
        <div className="hud-row">
          <span className="rolebadge">DEV — live tracking</span>
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Solid labeled dots = true position (updates every {POLL_MS / 1000}s). Faint circles = the normal fuzzed ping trail players actually see.
        </p>
      </div>

      <GameMap
        master={data.game.masterFence}
        active={data.game.activeFence}
        next={data.game.nextFence}
        me={null}
        points={allFuzzed}
        nodes={nodesForMap}
        role={null}
        rawPlayers={data.players}
      />

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="eyebrow" style={{ marginTop: 0 }}>Players</p>
        <ul className="playerlist">
          {data.players.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <span className={'tag ' + (p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor')}>
                {p.role ?? 'unassigned'}{p.outOfBoundsSince ? ' · OOB' : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
