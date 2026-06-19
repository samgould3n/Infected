export type Role = 'hunter' | 'survivor';
export type GameStatus = 'lobby' | 'active' | 'finished';

export interface LatLng { lat: number; lng: number }

export interface Geofence {
  type: 'circle' | 'polygon';
  center?: LatLng;
  radiusM?: number;
  points?: LatLng[];
}

export interface GameSettings {
  durationMin: number;        // match length
  pingIntervalMin: number;    // how often locations are revealed
  maxPlayers: number;
  hunterCount: number;        // starting hunters
  captureRadiusM: number;     // GPS co-location threshold for capture verification
  oobPenalty: 'warning' | 'reveal' | 'infect'; // legacy; v2 uses a fixed tier ladder
  huntersSeeEachOther: boolean;
  decoysPerSurvivor: number;  // legacy; superseded by the power-up system
  geofence: Geofence;         // the MASTER boundary drawn by the host
  fenceMoves: boolean;        // does the active fence relocate during the match?
  fenceMoveMin: number;       // minutes between moves
  activeRadiusM?: number;     // active circle radius when master is a circle
  activeAreaFrac?: number;    // active area as a fraction of master area when master is a polygon
}

export interface MapNode {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
  kind: 'pickup' | 'drop' | 'lure' | 'deadzone' | 'tripwire';
  expiresAt: string | null;
}

export interface PingPoint { lat: number; lng: number; r: number }

export interface GameEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface StateResponse {
  game: {
    id: string; code: string; status: GameStatus; winner: string | null;
    startedAt: string | null; endsAt: string | null; serverNow: string;
    settings: GameSettings; hostPlayer: string | null;
    masterFence: Geofence | null;
    activeFence: Geofence | null;
    nextFence: Geofence | null;      // shown as a preview during the warning window
    fenceMoveAt: string | null;      // when active becomes next
    constrictUsed: boolean;
  };
  me: {
    id: string; name: string; role: Role | null; status: string;
    decoysLeft: number; isOriginalHunter: boolean; capturedAt: string | null;
    powerups: string[];
    effects: Record<string, string>;  // effectId -> expiry ISO
    selfSelect: boolean;              // survivor reached self-select phase
    pickupChoices: string[] | null;   // if standing on a node in self-select mode
    flaggedUntil: string | null;      // tracked by a hunter lure
  };
  players: { id: string; name: string; role: Role | null; status: string; isOriginalHunter: boolean }[];
  counts: { survivors: number; hunters: number; infected: number };
  pings: { points: PingPoint[]; at: string | null };
  teammates: { name: string; lat: number; lng: number }[] | null;
  nodes: MapNode[];                   // map nodes visible to ME (survivor pickups, dead zones, hunter lures for hunters)
  events: GameEvent[];
}
