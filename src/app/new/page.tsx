'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { api, saveSession } from '@/lib/client/api';
import type { Geofence } from '@/lib/types';

const FenceEditor = dynamic(() => import('@/components/FenceEditor'), { ssr: false });

const PRESETS: { name: string; fence: Geofence }[] = [
  { name: 'Grimsby town centre', fence: { type: 'circle', center: { lat: 53.5675, lng: -0.0815 }, radiusM: 800 } },
  { name: 'Hyde Park, London', fence: { type: 'circle', center: { lat: 51.5073, lng: -0.1657 }, radiusM: 1000 } },
  { name: 'Manchester city centre', fence: { type: 'circle', center: { lat: 53.4794, lng: -2.2453 }, radiusM: 800 } },
];

export default function NewGame() {
  const router = useRouter();
  const [hostName, setHostName] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [pingIntervalMin, setPingIntervalMin] = useState(10);
  const [maxPlayers, setMaxPlayers] = useState(30);
  const [hunterCount, setHunterCount] = useState(2);
  const [captureRadiusM, setCaptureRadiusM] = useState(30);
  const [decoysPerSurvivor, setDecoysPerSurvivor] = useState(1);
  const [oobPenalty, setOobPenalty] = useState<'warning' | 'reveal' | 'infect'>('reveal');
  const [huntersSeeEachOther, setHuntersSeeEachOther] = useState(true);
  const [fence, setFence] = useState<Geofence>({
    type: 'circle',
    center: { lat: 53.5675, lng: -0.0815 },
    radiusM: 800,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const s = await api('/api/games', {
        method: 'POST',
        body: {
          hostName,
          settings: {
            durationMin, pingIntervalMin, maxPlayers, hunterCount,
            captureRadiusM, decoysPerSurvivor, oobPenalty, huntersSeeEachOther,
            geofence: fence,
          },
        },
      });
      saveSession(s);
      router.push('/game/' + s.code);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  const fenceReady =
    (fence.type === 'circle' && !!fence.center && !!fence.radiusM) ||
    (fence.type === 'polygon' && (fence.points?.length ?? 0) >= 3);

  return (
    <main className="wrap">
      <p className="eyebrow">new game</p>
      <h1 className="brand" style={{ fontSize: 30 }}>SET THE <span className="hunt">TRAP</span></h1>

      <div className="panel">
        <label className="field">
          <span>Your name (you&apos;ll be the host)</span>
          <input className="input" maxLength={20} value={hostName} onChange={(e) => setHostName(e.target.value)} />
        </label>
      </div>

      <div className="panel">
        <p className="eyebrow" style={{ marginTop: 0 }}>Play area</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <button
            className={'btn small ' + (fence.type === 'circle' ? '' : 'ghost')}
            onClick={() => setFence({ type: 'circle', center: fence.center ?? PRESETS[0].fence.center, radiusM: fence.radiusM ?? 800 })}
          >
            Circle
          </button>
          <button
            className={'btn small ' + (fence.type === 'polygon' ? '' : 'ghost')}
            onClick={() => setFence({ type: 'polygon', points: [] })}
          >
            Draw shape
          </button>
          <select
            className="input"
            style={{ padding: 9 }}
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.name === e.target.value);
              if (p) setFence({ ...p.fence });
            }}
          >
            <option value="" disabled>Presets…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <FenceEditor value={fence} onChange={setFence} />
        {fence.type === 'circle' && (
          <label className="field" style={{ marginTop: 10 }}>
            <span>Tap the map to move the centre · radius {fence.radiusM}m</span>
            <input
              type="range" min={200} max={3000} step={50}
              value={fence.radiusM ?? 800}
              onChange={(e) => setFence({ ...fence, radiusM: Number(e.target.value) })}
            />
          </label>
        )}
        {fence.type === 'polygon' && (
          <div className="row" style={{ marginTop: 10 }}>
            <p className="hint" style={{ margin: 0 }}>Tap the map to add corners ({fence.points?.length ?? 0} so far, need 3+)</p>
            <button className="btn small ghost" onClick={() => setFence({ type: 'polygon', points: [] })}>Clear</button>
          </div>
        )}
      </div>

      <div className="panel">
        <p className="eyebrow" style={{ marginTop: 0 }}>Match rules</p>
        <label className="field">
          <span>Match length: {durationMin} min</span>
          <input type="range" min={15} max={180} step={5} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Location ping every: {pingIntervalMin} min</span>
          <input type="range" min={2} max={20} step={1} value={pingIntervalMin} onChange={(e) => setPingIntervalMin(Number(e.target.value))} />
        </label>
        <div className="row">
          <label className="field">
            <span>Starting hunters</span>
            <input className="input" type="number" min={1} max={10} value={hunterCount} onChange={(e) => setHunterCount(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Max players</span>
            <input className="input" type="number" min={2} max={60} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Capture range (m)</span>
            <input className="input" type="number" min={10} max={100} value={captureRadiusM} onChange={(e) => setCaptureRadiusM(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Decoys per survivor</span>
            <input className="input" type="number" min={0} max={5} value={decoysPerSurvivor} onChange={(e) => setDecoysPerSurvivor(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>Leaving the area</span>
          <select className="input" value={oobPenalty} onChange={(e) => setOobPenalty(e.target.value as any)}>
            <option value="warning">Warning only</option>
            <option value="reveal">Reveal their position to the other team</option>
            <option value="infect">Survivors get infected</option>
          </select>
        </label>
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={huntersSeeEachOther}
            onChange={(e) => setHuntersSeeEachOther(e.target.checked)}
            style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
          />
          <span style={{ margin: 0 }}>Hunters can see each other on the map</span>
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || !hostName.trim() || !fenceReady} onClick={create}>
        {busy ? 'Creating…' : 'Create lobby'}
      </button>
      <p className="hint" style={{ marginTop: 12 }}>
        Recommended balance: pings get fuzzier for hunters as the match goes on, so a growing
        hunter team never gets perfect information. Decoys give survivors a panic button.
      </p>
    </main>
  );
}
