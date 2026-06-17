'use client';
import { POWERUPS } from '@/lib/powerups';

export function PowerupBar({
  powerups, onUse, disabled,
}: {
  powerups: string[];
  onUse: (id: string) => void;
  disabled?: boolean;
}) {
  if (!powerups.length) {
    return <p className="hint" style={{ textAlign: 'center', margin: '10px 0 0' }}>No power-ups yet — walk through a glowing node on the map to grab one.</p>;
  }
  // collapse duplicates into counts
  const counts = powerups.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});
  return (
    <div className="pubar">
      {Object.entries(counts).map(([id, n]) => {
        const def = POWERUPS[id];
        if (!def) return null;
        return (
          <button key={id} className={'pu rarity-' + def.rarity} disabled={disabled} onClick={() => onUse(id)} title={def.blurb}>
            <span className="pu-name">{def.name}{n > 1 ? ` ×${n}` : ''}</span>
            <span className="pu-blurb">{def.blurb}</span>
          </button>
        );
      })}
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
                <b>{def.name}</b>
                <span>{def.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
