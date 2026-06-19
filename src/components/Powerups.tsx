'use client';
import { useState } from 'react';
import {
  Ghost, EyeOff, HeartPulse, Radar, Zap, ShieldOff, Crosshair, ScanSearch,
  Shrink, Magnet, Locate, BellRing, ScanEye, Plus, Info, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { POWERUPS } from '@/lib/powerups';

const ICONS: Record<string, any> = {
  Ghost, EyeOff, HeartPulse, Radar, Zap, ShieldOff, Crosshair, ScanSearch,
  Shrink, Magnet, Locate, BellRing, ScanEye,
};

function PowerupIcon({ id, size = 22 }: { id: string; size?: number }) {
  const def = POWERUPS[id];
  if (!def) return null;
  const Icon = ICONS[def.icon] ?? Ghost;
  const spin = def.id === 'sonar';
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      <Icon
        size={size}
        color={def.color}
        strokeWidth={def.id === 'adrenaline' || def.id === 'alert' || def.id === 'constrict' ? 2.4 : 1.8}
        style={spin ? { animation: 'mh-spin 4s linear infinite' } : undefined}
      />
      {def.id === 'super_decoy' && (
        <Plus size={Math.round(size * 0.55)} color="#ffc53b" strokeWidth={3}
          style={{ position: 'absolute', right: -4, bottom: -4, background: 'var(--panel-2)', borderRadius: '50%' }} />
      )}
    </span>
  );
}

function ensureSpinKeyframes() {
  if (typeof document === 'undefined' || document.getElementById('mh-spin-style')) return;
  const s = document.createElement('style');
  s.id = 'mh-spin-style';
  s.textContent = `@keyframes mh-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`;
  document.head.appendChild(s);
}

export function PowerupBar({
  powerups, onUse, disabled,
}: {
  powerups: string[];
  onUse: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [infoId, setInfoId] = useState<string | null>(null);
  ensureSpinKeyframes();

  const counts = powerups.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});
  const ids = Object.keys(counts);

  return (
    <div className="pudrawer">
      <button className="pudrawer-head" onClick={() => setOpen((o) => !o)}>
        <span>Power-ups{ids.length ? ` · ${powerups.length}` : ''}</span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        ids.length === 0 ? (
          <p className="hint" style={{ textAlign: 'center', margin: '10px 0 0' }}>
            No power-ups yet — walk through a glowing node on the map to grab one.
          </p>
        ) : (
          <div className="pubar">
            {ids.map((id) => {
              const def = POWERUPS[id];
              if (!def) return null;
              const n = counts[id];
              return (
                <div key={id} className={'pu rarity-' + def.rarity}>
                  <button className="pu-main" disabled={disabled} onClick={() => onUse(id)}>
                    <PowerupIcon id={id} />
                    <span className="pu-name">{def.name}{n > 1 ? ` ×${n}` : ''}</span>
                  </button>
                  <button className="pu-info" onClick={() => setInfoId(id)} aria-label={`About ${def.name}`}>
                    <Info size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}
      {infoId && POWERUPS[infoId] && (
        <div className="modal-backdrop" onClick={() => setInfoId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
              <PowerupIcon id={infoId} size={28} />
              <p className="eyebrow" style={{ margin: '0 0 0 8px', flex: 1 }}>{POWERUPS[infoId].name}</p>
              <button className="btn small ghost" onClick={() => setInfoId(null)}><X size={14} /></button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>{POWERUPS[infoId].blurb}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChoiceModal({
  title, subtitle, options, onChoose, onClose, busy,
}: {
  title: string;
  subtitle?: string;
  options: string[];
  onChoose: (id: string) => void;
  onClose?: () => void;
  busy?: boolean;
}) {
  ensureSpinKeyframes();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow" style={{ marginTop: 0 }}>{title}</p>
        {subtitle && <p className="hint" style={{ marginTop: 0 }}>{subtitle}</p>}
        <div className="choices">
          {options.map((id) => {
            const def = POWERUPS[id];
            if (!def) return null;
            return (
              <button key={id} className={'choice rarity-' + def.rarity} disabled={busy} onClick={() => onChoose(id)}>
                <PowerupIcon id={id} size={24} />
                <span className="choice-text">
                  <b>{def.name}</b>
                  <span>{def.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
