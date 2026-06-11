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
  oobPenalty: 'warning' | 'reveal' | 'infect'; // out-of-bounds penalty
  huntersSeeEachOther: boolean;
  decoysPerSurvivor: number;  // limited-use decoy pings (balance Option B)
  geofence: Geofence;
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
  };
  me: {
    id: string; name: string; role: Role | null; status: string;
    decoysLeft: number; isOriginalHunter: boolean; capturedAt: string | null;
  };
  players: { id: string; name: string; role: Role | null; status: string; isOriginalHunter: boolean }[];
  counts: { survivors: number; hunters: number; infected: number };
  pings: { points: PingPoint[]; at: string | null };
  teammates: { name: string; lat: number; lng: number }[] | null;
  events: GameEvent[];
}
