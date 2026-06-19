// Central catalogue of every power-up. Shared by client (labels) and server (rarity, pools).
export type Team = 'survivor' | 'hunter';
export type Rarity = 'common' | 'rare' | 'ultra';

export interface PowerupDef {
  id: string;
  team: Team;
  name: string;
  rarity: Rarity;
  blurb: string;
  // placement: does using it require choosing a map location?
  placed?: boolean;
  icon: string;   // lucide-react component name
  color: string;  // atmospheric stroke colour for the icon
}

export const POWERUPS: Record<string, PowerupDef> = {
  // ── Survivor (cool / blue-purple palette) ──
  decoy: { id: 'decoy', team: 'survivor', name: 'Decoy', rarity: 'common', icon: 'Ghost', color: '#a8d8ea',
    blurb: '3 pings (including your real one) appear at random spots on your next hunter ping.' },
  super_decoy: { id: 'super_decoy', team: 'survivor', name: 'Super Decoy', rarity: 'rare', icon: 'Ghost', color: '#a8d8ea',
    blurb: '5 pings (including your real one) scatter across the map on your next hunter ping.' },
  cloak: { id: 'cloak', team: 'survivor', name: 'Cloak', rarity: 'common', icon: 'EyeOff', color: '#9b7fe8',
    blurb: 'You are skipped from the next hunter ping entirely.' },
  resurrection: { id: 'resurrection', team: 'survivor', name: 'Resurrection', rarity: 'ultra', icon: 'HeartPulse', color: '#6bcfb0',
    blurb: 'Revive a random infected player back to the survivors with 30s of immunity + speed.' },
  sonar: { id: 'sonar', team: 'survivor', name: 'Sonar', rarity: 'rare', icon: 'Radar', color: '#7ee8fa',
    blurb: 'For one ping cycle you receive hunter positions ~10× more often.' },
  adrenaline: { id: 'adrenaline', team: 'survivor', name: 'Adrenaline', rarity: 'common', icon: 'Zap', color: '#f0f0f0',
    blurb: 'Run flat-out for 2 minutes without being flagged for moving too fast.' },
  dead_zone: { id: 'dead_zone', team: 'survivor', name: 'Dead Zone', rarity: 'rare', placed: true, icon: 'ShieldOff', color: '#7c5cff',
    blurb: 'Create a 5-min zone where you are hidden from pings and immune to bounds. Visible to all.' },
  tripwire: { id: 'tripwire', team: 'survivor', name: 'Tripwire', rarity: 'common', placed: true, icon: 'Crosshair', color: '#ffc53b',
    blurb: 'Place a wire; if a hunter crosses it you instantly get that hunter\u2019s position. Lasts all game.' },
  counter_trap: { id: 'counter_trap', team: 'survivor', name: 'Counter Trap', rarity: 'common', icon: 'ScanSearch', color: '#cdd8e3',
    blurb: 'Reveal every hunter trap currently on the map to all survivors.' },

  // ── Hunter (warm / red-amber palette) ──
  constrict: { id: 'constrict', team: 'hunter', name: 'Constrict', rarity: 'rare', icon: 'Shrink', color: '#ff3b5c',
    blurb: 'Permanently shrink the play area by 7.5%. Original hunters only, once per match.' },
  lure: { id: 'lure', team: 'hunter', name: 'Lure', rarity: 'rare', placed: true, icon: 'Magnet', color: '#ffc53b',
    blurb: 'Drop a fake pickup. The first survivor to enter is tracked (rapid pings) for 30s.' },
  scent: { id: 'scent', team: 'hunter', name: 'Scent', rarity: 'common', icon: 'Locate', color: '#ff6b3b',
    blurb: 'Reveal the exact current location of the nearest survivor to you.' },
  alert: { id: 'alert', team: 'hunter', name: 'Alert', rarity: 'common', icon: 'BellRing', color: '#f0f0f0',
    blurb: 'Survivor pings come more frequently until the next normal cycle.' },
  night_vision: { id: 'night_vision', team: 'hunter', name: 'Night Vision', rarity: 'rare', icon: 'ScanEye', color: '#39d98a',
    blurb: 'The next 2 survivor pings are shown with no fuzz \u2014 exact positions.' },
};

export const SURVIVOR_POOL = Object.values(POWERUPS).filter((p) => p.team === 'survivor').map((p) => p.id);
export const HUNTER_POOL = Object.values(POWERUPS).filter((p) => p.team === 'hunter').map((p) => p.id);
// Pool offered to a newly-infected player (hunter pool minus Constrict).
export const INFECTED_POOL = HUNTER_POOL.filter((id) => id !== 'constrict');

export const MAX_INVENTORY = 5;
