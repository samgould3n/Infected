'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, saveSession } from '@/lib/client/api';

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const s = await api('/api/games/join', { method: 'POST', body: { code, name } });
      saveSession(s);
      router.push('/game/' + s.code);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main className="wrap" style={{ justifyContent: 'center' }}>
      <div>
        <p className="eyebrow">street game protocol</p>
        <h1 className="brand">MAN<span className="hunt">HUNT</span></h1>
        <p className="tagline">
          One team hunts. One team hides. Every capture turns a survivor into a hunter.
          Played on real streets, on real legs, with real GPS pings.
        </p>

        <div className="panel">
          <label className="field">
            <span>Room code</span>
            <input
              className="input mono"
              placeholder="e.g. K7Q2M"
              maxLength={5}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ textTransform: 'uppercase', letterSpacing: '0.25em' }}
            />
          </label>
          <label className="field">
            <span>Your name</span>
            <input
              className="input"
              placeholder="What do they call you?"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={busy || code.length !== 5 || !name.trim()} onClick={join}>
            {busy ? 'Joining…' : 'Join the game'}
          </button>
        </div>

        <Link className="btn ghost" href="/new">Host a new game</Link>
        <p className="hint" style={{ marginTop: 18 }}>
          You&apos;ll need to allow location and camera access. Works best added to your home screen.
        </p>
      </div>
    </main>
  );
}
