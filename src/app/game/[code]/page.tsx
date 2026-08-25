'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { api, getSession, saveSession, type Session } from '@/lib/client/api';
import { haversine } from '@/lib/geo';
import type { LatLng, StateResponse } from '@/lib/types';
import { POWERUPS } from '@/lib/powerups';
import Timer from '@/components/Timer';
import QRModal from '@/components/QRModal';
import ScannerModal from '@/components/ScannerModal';
import { PowerupBar, ChoiceModal } from '@/components/Powerups';

const GameMap = dynamic(() => import('@/components/GameMap'), { ssr: false });

const POLL_MS = 10_000;
const LOC_SEND_MS = 20_000;
const SONAR_SEND_MS = 6_000; // faster location cadence while Sonar is active (drives quicker hunter ping refresh)

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

  const [qrInfo, setQrInfo] = useState<{ qr: string; code: string; expiresInSec: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // power-up flows
  const [placing, setPlacing] = useState<string | null>(null);   // power-up id awaiting a map tap ('lure' | 'tripwire' | 'dead_zone')
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [hunterLoadout, setHunterLoadout] = useState<string[] | null>(null); // local: ids picked so far

  const lastSentRef = useRef<{ at: number; pos: LatLng | null }>({ at: 0, pos: null });
  const seenEventsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const stateRef = useRef<StateResponse | null>(null);
  stateRef.current = state;

  useEffect(() => { setSession(getSession(code)); }, [code]);

  const refresh = useCallback(async () => {
    const s = getSession(code);
    if (!s) return;
    try {
      const st = await api<StateResponse>(`/api/games/${s.gameId}/state`, { token: s.token });
      setState(st);
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

  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => setToasts((t) => t.slice(1)), 4500);
    return () => clearTimeout(id);
  }, [toasts]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const supa = createClient(url, key);
      channel = supa.channel('game:' + session.gameId).on('broadcast', { event: 'update' }, () => refresh()).subscribe();
    }
    return () => { clearInterval(id); channel?.unsubscribe(); };
  }, [session, refresh]);

  // geolocation watch + throttled upload (movement-triggered) + periodic fallback (stationary players)
  const myPosRef = useRef<LatLng | null>(null);
  const uploadLocation = useCallback(async (pos: LatLng, accuracy: number) => {
    if (!session) return;
    const last = lastSentRef.current;
    const moved = last.pos ? haversine(last.pos, pos) : Infinity;
    const st = stateRef.current;
    const sonar = st?.me.effects?.sonar && new Date(st.me.effects.sonar).getTime() > Date.now();
    const interval = sonar ? SONAR_SEND_MS : LOC_SEND_MS;
    if (Date.now() - last.at < interval && moved < 15) return;
    lastSentRef.current = { at: Date.now(), pos };
    try {
      const r = await api<{ ok: boolean; inBounds?: boolean }>(
        `/api/games/${session.gameId}/location`,
        { method: 'POST', token: session.token, body: { ...pos, accuracy } }
      );
      if (r.inBounds !== undefined) setInBounds(r.inBounds);
      if (sonar) refresh();
    } catch { /* retried next fix */ }
  }, [session, refresh]);

  useEffect(() => {
    if (!session || !('geolocation' in navigator)) {
      if (session) setGpsError('This device has no GPS support.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setGpsError(null);
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMyPos(pos);
        myPosRef.current = pos;
        uploadLocation(pos, p.coords.accuracy);
      },
      () => setGpsError('Location is blocked. Allow location access in your browser settings to play.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [session, uploadLocation]);

  // Bounds checking (in/out of the play area, tiered penalties) depends on repeated location
  // uploads — but watchPosition often stops firing callbacks once a phone is stationary, which
  // silently stalls the out-of-bounds tiers after the first warning. This independent timer
  // re-sends the last known fix on a fixed cadence regardless of movement, so a player standing
  // still just outside the fence still gets checked every few seconds.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (myPosRef.current) uploadLocation(myPosRef.current, 30);
    }, 6000);
    return () => clearInterval(id);
  }, [session, uploadLocation]);

  async function joinHere() {
    setBusy(true); setJoinError(null);
    try {
      const s = await api<Session>('/api/games/join', { method: 'POST', body: { code, name: joinName } });
      saveSession(s); setSession(s);
    } catch (e: any) { setJoinError(e.message); } finally { setBusy(false); }
  }

  async function startGame() {
    if (!session) return;
    setBusy(true);
    try { await api(`/api/games/${session.gameId}/start`, { method: 'POST', token: session.token }); await refresh(); }
    catch (e: any) { pushToast(e.message); } finally { setBusy(false); }
  }

  function pushToast(text: string) { setToasts((t) => [...t, { id: Math.random(), text }]); }

  async function requestCapture() {
    if (!session) return;
    try { setQrInfo(await api(`/api/games/${session.gameId}/capture/request`, { method: 'POST', token: session.token })); }
    catch (e: any) { pushToast(e.message); }
  }

  async function confirmCapture(payload: { qr?: string; code?: string }) {
    if (!session) return;
    setScanBusy(true); setScanError(null);
    try { await api(`/api/games/${session.gameId}/capture/confirm`, { method: 'POST', token: session.token, body: payload }); setScanning(false); await refresh(); }
    catch (e: any) { setScanError(e.message); } finally { setScanBusy(false); }
  }

  async function usePowerup(id: string) {
    if (!session) return;
    const def = POWERUPS[id];
    if (def?.placed) { setPlacing(id); pushToast(`Tap the map to place your ${def.name}.`); return; }
    try {
      await api(`/api/games/${session.gameId}/powerup`, { method: 'POST', token: session.token, body: { id } });
      await refresh();
      pushToast(`${def?.name ?? 'Power-up'} activated.`);
    } catch (e: any) { pushToast(e.message); }
  }

  async function placeAt(p: LatLng) {
    if (!session || !placing) return;
    const id = placing;
    setPlacing(null);
    try {
      if (id === 'lure') await api(`/api/games/${session.gameId}/lure`, { method: 'POST', token: session.token, body: { at: p } });
      else await api(`/api/games/${session.gameId}/powerup`, { method: 'POST', token: session.token, body: { id, at: p } });
      await refresh();
      pushToast(`${POWERUPS[id]?.name ?? 'It'} placed.`);
    } catch (e: any) { pushToast(e.message); }
  }

  async function choosePickup(id: string) {
    if (!session) return;
    setChoiceBusy(true);
    try { await api(`/api/games/${session.gameId}/powerup/choose`, { method: 'POST', token: session.token, body: { id } }); await refresh(); }
    catch (e: any) { pushToast(e.message); } finally { setChoiceBusy(false); }
  }

  async function chooseHunterLoadout(id: string) {
    if (!session) return;
    setChoiceBusy(true);
    try {
      const r = await api<{ powerups: string[]; loadoutComplete: boolean }>(
        `/api/games/${session.gameId}/powerup/choose`, { method: 'POST', token: session.token, body: { id, loadout: true } }
      );
      setHunterLoadout(r.powerups);
      await refresh();
    } catch (e: any) { pushToast(e.message); } finally { setChoiceBusy(false); }
  }

  // ── render ─────────────────────────────────────────────────────────
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
          <label className="field"><span>Your name</span>
            <input className="input" maxLength={20} value={joinName} onChange={(e) => setJoinName(e.target.value)} />
          </label>
          {joinError && <p className="error">{joinError}</p>}
          <button className="btn" disabled={busy || !joinName.trim()} onClick={joinHere}>{busy ? 'Joining…' : 'Join'}</button>
        </div>
      </main>
    );
  }

  if (!state) {
    return <main className="wrap" style={{ justifyContent: 'center', textAlign: 'center' }}><p className="eyebrow">connecting…</p></main>;
  }

  const { game, me, players, counts } = state;
  const roleClass = me.role === 'hunter' ? 'role-hunter' : 'role-survivor';

  if (game.status === 'finished') {
    const won = (game.winner === 'hunters' && me.role === 'hunter') || (game.winner === 'survivors' && me.role === 'survivor');
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
              <li key={p.id}><span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
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
          <p className="eyebrow" style={{ marginTop: 0 }}>Players · {players.length}/{game.settings.maxPlayers}</p>
          <ul className="playerlist">
            {players.map((p) => (
              <li key={p.id}><span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
                {p.id === game.hostPlayer && <span className="tag">host</span>}
              </li>
            ))}
          </ul>
        </div>
        <p className="hint" style={{ margin: '4px 0 14px' }}>
          {game.settings.durationMin} min match · pings every {game.settings.pingIntervalMin} min ·{' '}
          {game.settings.hunterCount} starting hunter{game.settings.hunterCount > 1 ? 's' : ''} ·{' '}
          {game.settings.fenceMoves ? `play area moves every ${game.settings.fenceMoveMin} min · ` : ''}
          power-ups on · roles assigned at random when the host starts.
        </p>
        {gpsError && <p className="error">{gpsError}</p>}
        {isHost ? (
          <button className="btn" disabled={busy || players.length < 2} onClick={startGame}>
            {players.length < 2 ? 'Waiting for players…' : busy ? 'Starting…' : 'Start the hunt'}
          </button>
        ) : (<p className="hint" style={{ textAlign: 'center' }}>Waiting for the host to start…</p>)}
        <Toasts toasts={toasts} />
      </main>
    );
  }

  // ── active match ───────────────────────────────────────────────────
  const isHunter = me.role === 'hunter';
  const pingAge = state.pings.at
    ? Math.round((new Date(game.serverNow).getTime() - new Date(state.pings.at).getTime()) / 60000)
    : null;
  const flagged = me.flaggedUntil && new Date(me.flaggedUntil).getTime() > Date.now();
  const fenceWarn = game.nextFence != null;
  const canConstrict = isHunter && me.isOriginalHunter && !game.constrictUsed && me.powerups.includes('constrict') && counts.survivors > 2;

  // Original hunter who hasn't chosen a starting loadout yet (held 0 power-ups, no pending choices)
  const needsLoadout = isHunter && me.isOriginalHunter && me.powerups.length < 2 && !me.pickupChoices && (hunterLoadout?.length ?? me.powerups.length) < 2;
  // Newly infected player choosing 1 of 3
  const infectedChoice = isHunter && me.pickupChoices && me.pickupChoices.length > 0;
  // Survivor self-select pickup choice
  const survivorChoice = !isHunter && me.pickupChoices && me.pickupChoices.length > 0;

  return (
    <main className={'wrap ' + roleClass}>
      <div className="hud">
        <div className="hud-row">
          <span className="rolebadge">{isHunter ? (me.isOriginalHunter ? 'Hunter' : 'Infected') : 'Survivor'}</span>
          {game.endsAt && <Timer endsAt={game.endsAt} serverNow={game.serverNow} />}
        </div>
        {flagged && <p className="error" style={{ margin: '8px 0 0', color: 'var(--hunter)' }}>⚑ You&apos;ve been flagged — a hunter is tracking you!</p>}
        {fenceWarn && <p className="error" style={{ margin: '8px 0 0', color: 'var(--amber)' }}>The play area is about to move — see the red outline.</p>}
        {!inBounds && <p className="error" style={{ margin: '8px 0 0' }}>You are outside the play area — get back in!</p>}
        {placing && <p className="hint" style={{ margin: '8px 0 0', color: 'var(--amber)' }}>Tap the map to place your {POWERUPS[placing]?.name}. <button className="btn small ghost" onClick={() => setPlacing(null)}>Cancel</button></p>}
        {gpsError && <p className="error" style={{ margin: '8px 0 0' }}>{gpsError}</p>}
      </div>

      <GameMap
        master={game.masterFence ?? game.settings.geofence}
        active={game.activeFence}
        next={game.nextFence}
        me={myPos}
        points={state.pings.points}
        nodes={state.nodes}
        teammates={state.teammates}
        role={me.role}
        placing={!!placing}
        onPlace={placeAt}
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
        <button className="btn danger" disabled={!!placing} onClick={requestCapture}>Capture — show QR</button>
      ) : (
        <button className="btn" disabled={!!placing} onClick={() => { setScanError(null); setScanning(true); }}>
          I&apos;ve been tagged — scan QR
        </button>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <PowerupBar powerups={me.powerups} onUse={usePowerup} disabled={!!placing} />
        {me.selfSelect && !isHunter && (
          <p className="hint" style={{ margin: '8px 0 0' }}>You now choose your own power-up at each node.</p>
        )}
        {canConstrict && (
          <p className="hint" style={{ margin: '8px 0 0' }}>Constrict shrinks the play area 7.5% — permanent, one use.</p>
        )}
      </div>

      <details className="panel" style={{ marginTop: 14 }}>
        <summary className="eyebrow" style={{ cursor: 'pointer' }}>Roster</summary>
        <ul className="playerlist" style={{ marginTop: 8 }}>
          {players.map((p) => (
            <li key={p.id}><span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
              <span className={'tag ' + (p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor')}>
                {p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor'}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {qrInfo && (
        <QRModal qr={qrInfo.qr} code={qrInfo.code} expiresInSec={qrInfo.expiresInSec}
          onClose={() => setQrInfo(null)} onExpired={() => setQrInfo(null)} />
      )}
      {scanning && (
        <ScannerModal busy={scanBusy} error={scanError} onClose={() => setScanning(false)}
          onScan={(qr) => confirmCapture({ qr })} onManualCode={(c) => confirmCapture({ code: c })} />
      )}

      {needsLoadout && (
        <ChoiceModal
          title="Choose your hunter loadout"
          subtitle={`Pick 2 power-ups (${hunterLoadout?.length ?? 0}/2 chosen)`}
          options={['constrict', 'lure', 'scent', 'alert', 'night_vision'].filter((id) => !(hunterLoadout ?? []).includes(id))}
          onChoose={chooseHunterLoadout}
          busy={choiceBusy}
        />
      )}
      {infectedChoice && (
        <ChoiceModal
          title="You&apos;ve been infected — you hunt now"
          subtitle="Pick one hunter power-up to start with"
          options={me.pickupChoices!}
          onChoose={choosePickup}
          busy={choiceBusy}
        />
      )}
      {survivorChoice && (
        <ChoiceModal
          title="Power-up node"
          subtitle="Choose one"
          options={me.pickupChoices!}
          onChoose={choosePickup}
          busy={choiceBusy}
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
      {toasts.slice(0, 3).map((t) => (<div className="toast" key={t.id}>{t.text}</div>))}
    </div>
  );
}

function describeEvent(e: { type: string; payload: any }): string | null {
  switch (e.type) {
    case 'joined': return `${e.payload.name} joined the lobby`;
    case 'left': return `${e.payload.name} left the game`;
    case 'start': return 'The hunt has begun. Run.';
    case 'ping': return 'New location ping on the map';
    case 'infected': return e.payload.by ? `${e.payload.name} was caught by ${e.payload.by} — they hunt now` : `${e.payload.name} has been infected`;
    case 'resurrected': return `${e.payload.name} clawed back to the survivors!`;
    case 'you_resurrected': return 'You are alive again — 30s immunity, run!';
    case 'oob_warning': return 'You are leaving the play area — turn back!';
    case 'oob_reveal': return `${e.payload.name} strayed out of bounds — position revealed`;
    case 'oob_revealed_you': return 'Out of bounds — your position was revealed!';
    case 'oob_lost_powerup': return `Out of bounds again — you lost your ${POWERUPS[e.payload.lost]?.name ?? 'power-up'}`;
    case 'back_in_bounds': return 'Back inside the play area';
    case 'fence_moved': return 'The play area has moved.';
    case 'constrict': return 'A hunter shrank the play area!';
    case 'pickup': return `Picked up ${POWERUPS[e.payload.id]?.name ?? 'a power-up'}`;
    case 'pickup_choose': return 'You reached a node — choose a power-up';
    case 'lure_sprung': return `${e.payload.name} walked into a lure — tracking active`;
    case 'you_flagged': return 'You triggered a lure… you\'re now flagged';
    case 'tripwire_hit': return 'Your tripwire caught a hunter!';
    case 'traps_revealed': return 'Hunter traps revealed on your map';
    case 'scent': return `Scent picked up ${e.payload.name}`;
    case 'alert': return 'Hunters called an Alert — pings incoming';
    case 'game_over': return e.payload.winner === 'hunters' ? 'All survivors infected.' : 'Time! Survivors win.';
    default: return null;
  }
}
