'use client';
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onScan: (text: string) => void;
  onManualCode: (code: string) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}

/** Survivor side of a capture: scan the hunter's QR (or type the backup code). */
export default function ScannerModal({ onScan, onManualCode, onClose, busy, error }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scannedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const loop = () => {
          const v = videoRef.current;
          if (v && ctx && v.readyState === v.HAVE_ENOUGH_DATA && !scannedRef.current) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (found?.data) {
              scannedRef.current = true;
              navigator.vibrate?.(150);
              onScan(found.data);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch {
        setCamError('Camera unavailable — type the 6-character code from the hunter instead.');
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // allow re-scan after a failed attempt
  useEffect(() => {
    if (error) scannedRef.current = false;
  }, [error]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Tagged?</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Scan the hunter&apos;s capture code to confirm.
        </p>
        {!camError && (
          <div className="scanbox">
            <video ref={videoRef} playsInline muted />
            <div className="scanline" />
          </div>
        )}
        {camError && <p className="hint">{camError}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="input mono"
            placeholder="Backup code"
            maxLength={6}
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }}
          />
          <button
            className="btn small"
            disabled={busy || manual.length !== 6}
            onClick={() => onManualCode(manual)}
          >
            {busy ? '...' : 'Confirm'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
