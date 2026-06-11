'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { api, getSession, saveSession, type Session } from '@/lib/client/api';
import { haversine } from '@/lib/geo';
import type { LatLng, StateResponse } from '@/lib/types';
import Timer from '@/components/Timer';
import QRModal from '@/components/QRModal';
import ScannerModal from '@/components/ScannerModal';

const GameMap = dynamic(() => import('@/components/GameMap'), { ssr: false });

const POLL_MS = 10_000;
const LOC_SEND_MS = 20_000;

interface Toast { id: number; text: string }

export default function GamePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? '').toUpperCase();

  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<StateResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [inBounds, setInBounds] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [joinName, setJoinName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // capture flows
  const [qrInfo, setQrInfo] = useState<{ qr: string; code: string; expiresInSec: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const lastSentRef = useRef<{ at: number; pos: LatLng | null }>({ at: 0, pos: null });
  const seenEventsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const stateRef = useRef<StateResponse | null>(null);
  stateRef.current = state;

  useEffect(() => {
    setSession(getSession(code));
  }, [code]);

  const refresh = useCallback(async () => {
    const s = getSession(code);
    if (!s) return;
    try {
      const st = await api<StateResponse>(`/api/games/${s.gameId}/state`, { token: s.token });
      setState(st);
      // toast new events
      const fresh = st.events.filter((e) => !seenEventsRef.current.has(e.id));
      for (const e of fresh) seenEventsRef.current.add(e.id);
      if (!firstLoadRef.current) {
        const msgs = fresh.map(describeEvent).filter(Boolean) as string[];
        if (msgs.length) {
          navigator.vibrate?.([120, 60, 120]);
          setToasts((t) => [...t, ...msgs.map((text) => ({ id: Math.random(), text }))]);
        }
      }
      firstLoadRef.current = false;
    } catch (e: any) {
      if (String(e.message).includes('Not in this game')) setFatal('Your session for this game is no longer valid.');
    }
  }, [code]);

  // expire toasts
  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => setToasts((t) => t.slice(1)), 4500);
    return () => clearTimeout(id);
  }, [toasts]);

  // poll + realtime wake-ups
  useEffect(() => {
    if (!session) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const supa = createClient(url, key);
      channel = supa
        .channel('game:' + session.gameId)
        .on('broadcast', { event: 'update' }, () => refresh())
        .subscribe();
    }
    return () => {
      clearInterval(id);
      channel?.unsubscribe();
    };
  }, [session, refresh]);

  // geolocation watch + throttled upload (uploads also drive the server game clock)
  useEffect(() => {
    if (!session || !('geolocation' in navigator)) {
      if (session) setGpsError('This device has no GPS support.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      async (p) => {
        setGpsError(null);
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMyPos(pos);
        const last = lastSentRef.current;
        const moved = last.pos ? haversine(last.pos, pos) : Infinity;
        if (Date.now() - last.at < LOC_SEND_MS && moved < 15) return;
        lastSentRef.current = { at: Date.now(), pos };
        try {
          const r = await api<{ ok: boolean; inBounds?: boolean }>(
            `/api/games/${session.gameId}/location`,
            { method: 'POST', token: session.token, body: { ...pos, accuracy: p.coords.accuracy } }
          );
          if (r.inBounds !== undefined) setInBounds(r.inBounds);
        } catch { /* retried on next fix */ }
      },
      () => setGpsError('Location is blocked. Allow location access in your browser settings to play.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [session]);

  async function joinHere() {
    setBusy(true);
    setJoinError(null);
    try {
      const s = await api<Session>('/api/games/join', { method: 'POST', body: { code, name: joinName } });
      saveSession(s);
      setSession(s);
    } catch (e: any) {
      setJoinError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startGame() {
    if (!session) return;
    setBusy(true);
    try {
      await api(`/api/games/${session.gameId}/start`, { method: 'POST', token: session.token });
      await refresh();
    } catch (e: any) {
      setToasts((t) => [...t, { id: Math.random(), text: e.message }]);
    } finally {
      setBusy(false);
    }
  }

  async function requestCapture() {
    if (!session) return;
    try {
      const info = await api(`/api/games/${session.gameId}/capture/request`, { method: 'POST', token: session.token });
      setQrInfo(info);
    } catch (e: any) {
      setToasts((t) => [...t, { id: Math.random(), text: e.message }]);
    }
  }

  async function confirmCapture(payload: { qr?: string; code?: string }) {
    if (!session) return;
    setScanBusy(true);
    setScanError(null);
    try {
      await api(`/api/games/${session.gameId}/capture/confirm`, { method: 'POST', token: session.token, body: payload });
      setScanning(false);
      await refresh();
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setScanBusy(false);
    }
  }

  async function fireDecoy() {
    if (!session) return;
    try {
      const r = await api(`/api/games/${session.gameId}/decoy`, { method: 'POST', token: session.token });
      setToasts((t) => [...t, { id: Math.random(), text: `Decoy armed — it fires with the next ping. ${r.decoysLeft} left.` }]);
      refresh();
    } catch (e: any) {
      setToasts((t) => [...t, { id: Math.random(), text: e.message }]);
    }
  }

  // ── render ──────────────────────────────────────────────────────────
  if (fatal) {
    return (
      <main className="wrap" style={{ justifyContent: 'center' }}>
        <p className="error">{fatal}</p>
        <button className="btn ghost" onClick={() => router.push('/')}>Back to start</button>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="wrap" style={{ justifyContent: 'center' }}>
        <p className="eyebrow">room {code}</p>
        <h1 className="brand" style={{ fontSize: 30 }}>JOIN THE <span className="hunt">GAME</span></h1>
        <div className="panel">
          <label className="field">
            <span>Your name</span>
            <input className="input" maxLength={20} value={joinName} onChange={(e) => setJoinName(e.target.value)} />
          </label>
          {joinError && <p className="error">{joinError}</p>}
          <button className="btn" disabled={busy || !joinName.trim()} onClick={joinHere}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="wrap" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <p className="eyebrow">connecting…</p>
      </main>
    );
  }

  const { game, me, players, counts } = state;
  const roleClass = me.role === 'hunter' ? 'role-hunter' : 'role-survivor';

  if (game.status === 'finished') {
    const won =
      (game.winner === 'hunters' && me.role === 'hunter') ||
      (game.winner === 'survivors' && me.role === 'survivor');
    return (
      <main className={'wrap ' + roleClass}>
        <div className="winner">
          <p className="eyebrow">match over</p>
          <h2 style={{ color: game.winner === 'hunters' ? 'var(--hunter)' : 'var(--survivor)' }}>
            {game.winner === 'hunters' ? 'Hunters win' : 'Survivors win'}
          </h2>
          <p className="hint">{won ? 'Your team took it.' : 'Better luck next time.'}</p>
        </div>
        <div className="panel">
          <p className="eyebrow" style={{ marginTop: 0 }}>Final roster</p>
          <ul className="playerlist">
            {players.map((p) => (
              <li key={p.id}>
                <span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
                <span className={'tag ' + (p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor')}>
                  {p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survived'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn ghost" onClick={() => router.push('/')}>Back to start</button>
      </main>
    );
  }

  if (game.status === 'lobby') {
    const isHost = game.hostPlayer === me.id;
    return (
      <main className="wrap">
        <p className="eyebrow">lobby · share this code</p>
        <div className="roomcode">{game.code}</div>
        <div className="panel" style={{ marginTop: 14 }}>
          <p className="eyebrow" style={{ marginTop: 0 }}>
            Players · {players.length}/{game.settings.maxPlayers}
          </p>
          <ul className="playerlist">
            {players.map((p) => (
              <li key={p.id}>
                <span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
                {p.id === game.hostPlayer && <span className="tag">host</span>}
              </li>
            ))}
          </ul>
        </div>
        <p className="hint" style={{ margin: '4px 0 14px' }}>
          {game.settings.durationMin} min match · pings every {game.settings.pingIntervalMin} min ·{' '}
          {game.settings.hunterCount} starting hunter{game.settings.hunterCount > 1 ? 's' : ''} ·
          roles are assigned at random when the host starts.
        </p>
        {gpsError && <p className="error">{gpsError}</p>}
        {isHost ? (
          <button className="btn" disabled={busy || players.length < 2} onClick={startGame}>
            {players.length < 2 ? 'Waiting for players…' : busy ? 'Starting…' : 'Start the hunt'}
          </button>
        ) : (
          <p className="hint" style={{ textAlign: 'center' }}>Waiting for the host to start…</p>
        )}
        <Toasts toasts={toasts} />
      </main>
    );
  }

  // ── active match ────────────────────────────────────────────────────
  const isHunter = me.role === 'hunter';
  const pingAge = state.pings.at
    ? Math.round((new Date(game.serverNow).getTime() - new Date(state.pings.at).getTime()) / 60000)
    : null;

  return (
    <main className={'wrap ' + roleClass}>
      <div className="hud">
        <div className="hud-row">
          <span className="rolebadge">
            {isHunter ? (me.isOriginalHunter ? 'Hunter' : 'Infected') : 'Survivor'}
          </span>
          {game.endsAt && <Timer endsAt={game.endsAt} serverNow={game.serverNow} />}
        </div>
        {!inBounds && (
          <p className="error" style={{ margin: '8px 0 0' }}>
            You are outside the play area — get back in!
          </p>
        )}
        {gpsError && <p className="error" style={{ margin: '8px 0 0' }}>{gpsError}</p>}
      </div>

      <GameMap
        geofence={game.settings.geofence}
        me={myPos}
        points={state.pings.points}
        teammates={state.teammates}
        role={me.role}
      />

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="row">
          <div className="stat"><b style={{ color: 'var(--survivor)' }}>{counts.survivors}</b><span>survivors</span></div>
          <div className="stat"><b style={{ color: 'var(--hunter)' }}>{counts.hunters}</b><span>hunters</span></div>
          <div className="stat"><b style={{ color: 'var(--amber)' }}>{counts.infected}</b><span>infected</span></div>
        </div>
        <p className="hint" style={{ textAlign: 'center', marginBottom: 0 }}>
          {pingAge === null
            ? `First ${isHunter ? 'survivor' : 'hunter'} ping in under ${game.settings.pingIntervalMin} min.`
            : `${isHunter ? 'Survivor' : 'Hunter'} ping from ${pingAge} min ago · next within ${game.settings.pingIntervalMin} min.`}
        </p>
      </div>

      {isHunter ? (
        <button className="btn danger" onClick={requestCapture}>Capture — show QR</button>
      ) : (
        <>
          <button className="btn" onClick={() => { setScanError(null); setScanning(true); }}>
            I&apos;ve been tagged — scan QR
          </button>
          {me.decoysLeft > 0 && (
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={fireDecoy}>
              Drop a decoy ping ({me.decoysLeft} left)
            </button>
          )}
        </>
      )}

      <details className="panel" style={{ marginTop: 14 }}>
        <summary className="eyebrow" style={{ cursor: 'pointer' }}>Roster</summary>
        <ul className="playerlist" style={{ marginTop: 8 }}>
          {players.map((p) => (
            <li key={p.id}>
              <span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
              <span className={'tag ' + (p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor')}>
                {p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor'}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {qrInfo && (
        <QRModal
          qr={qrInfo.qr}
          code={qrInfo.code}
          expiresInSec={qrInfo.expiresInSec}
          onClose={() => setQrInfo(null)}
          onExpired={() => setQrInfo(null)}
        />
      )}
      {scanning && (
        <ScannerModal
          busy={scanBusy}
          error={scanError}
          onClose={() => setScanning(false)}
          onScan={(qr) => confirmCapture({ qr })}
          onManualCode={(c) => confirmCapture({ code: c })}
        />
      )}
      <Toasts toasts={toasts} />
    </main>
  );
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.slice(0, 3).map((t) => (
        <div className="toast" key={t.id}>{t.text}</div>
      ))}
    </div>
  );
}

function describeEvent(e: { type: string; payload: any }): string | null {
  switch (e.type) {
    case 'joined': return `${e.payload.name} joined the lobby`;
    case 'left': return `${e.payload.name} left the game`;
    case 'start': return 'The hunt has begun. Run.';
    case 'ping': return 'New location ping on the map';
    case 'infected':
      return e.payload.by
        ? `${e.payload.name} was caught by ${e.payload.by} — they hunt now`
        : `${e.payload.name} has been infected`;
    case 'oob_warning': return 'You are leaving the play area — turn back!';
    case 'oob_reveal': return `${e.payload.name} strayed out of bounds — position revealed`;
    case 'oob_revealed_you': return 'Out of bounds too long — your position was revealed!';
    case 'back_in_bounds': return 'Back inside the play area';
    case 'game_over': return e.payload.winner === 'hunters' ? 'All survivors infected.' : 'Time! Survivors win.';
    default: return null;
  }
}
