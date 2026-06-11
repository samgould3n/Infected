'use client';
import { useEffect, useState } from 'react';

export default function Timer({ endsAt, serverNow }: { endsAt: string; serverNow: string }) {
  // Trust server time: compute offset once per state refresh.
  const offset = new Date(serverNow).getTime() - Date.now();
  const [left, setLeft] = useState(() => new Date(endsAt).getTime() - (Date.now() + offset));

  useEffect(() => {
    const id = setInterval(() => {
      setLeft(new Date(endsAt).getTime() - (Date.now() + offset));
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt, offset]);

  const s = Math.max(0, Math.floor(left / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <div className={'timer' + (s < 300 ? ' low' : '')}>{mm}:{ss}</div>;
}
