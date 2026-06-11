'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  qr: string;
  code: string;
  expiresInSec: number;
  onClose: () => void;
  onExpired: () => void;
}

/** Hunter side of a capture: shows the rotating QR token + fallback code. */
export default function QRModal({ qr, code, expiresInSec, onClose, onExpired }: Props) {
  const [src, setSrc] = useState('');
  const [left, setLeft] = useState(expiresInSec);

  useEffect(() => {
    QRCode.toDataURL(qr, { margin: 1, width: 520, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [qr]);

  useEffect(() => {
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0) onExpired();
  }, [left, onExpired]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Capture</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Tag the survivor, then have them scan this with the in-app scanner.
        </p>
        <div className="qrbox">{src && <img src={src} alt="Capture QR code" />}</div>
        <p className="hint" style={{ textAlign: 'center' }}>
          Backup code: <b className="mono" style={{ fontSize: 18, color: 'var(--text)' }}>{code}</b>
          <br />
          Expires in {Math.max(0, left)}s
        </p>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
