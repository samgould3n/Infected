'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function Timer({ endsAt, serverNow }: { endsAt: string; serverNow: string }) {
  // Server/device clock offset. Capture it when serverNow changes, but only
  // adopt a new value if it differs by >2s (real clock skew) — small jitter
  // from network latency must not nudge the countdown.
  const offsetRef = useRef<number | null>(null);
  useMemo(() => {
    const o = new Date(serverNow).getTime() - Date.now();
    if (offsetRef.current === null || Math.abs(o - offsetRef.current) > 2000) {
      offsetRef.current = o;
    }
  }, [serverNow]);

  const end = useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const s = Math.max(0, Math.floor((end - (now + (offsetRef.current ?? 0))) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <div className={'timer' + (s < 300 ? ' low' : '')}>{mm}:{ss}</div>;
}
