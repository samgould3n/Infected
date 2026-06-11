import type { Geofence, LatLng } from './types';

const R = 6371000; // earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function destPoint(p: LatLng, distM: number, bearingRad: number): LatLng {
  const d = distM / R;
  const lat1 = rad(p.lat);
  const lng1 = rad(p.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: deg(lat2), lng: deg(lng2) };
}

export function pointInPolygon(p: LatLng, pts: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng, yi = pts[i].lat;
    const xj = pts[j].lng, yj = pts[j].lat;
    const hit =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function insideFence(f: Geofence, p: LatLng): boolean {
  if (f.type === 'circle' && f.center && f.radiusM) {
    return haversine(f.center, p) <= f.radiusM;
  }
  if (f.type === 'polygon' && f.points && f.points.length >= 3) {
    return pointInPolygon(p, f.points);
  }
  return true;
}

export function fenceCenter(f: Geofence): LatLng {
  if (f.type === 'circle' && f.center) return f.center;
  if (f.points && f.points.length) {
    const lat = f.points.reduce((s, q) => s + q.lat, 0) / f.points.length;
    const lng = f.points.reduce((s, q) => s + q.lng, 0) / f.points.length;
    return { lat, lng };
  }
  return { lat: 53.5675, lng: -0.0815 };
}

/** Offset a point by a random bearing and 35–100% of maxM. maxM=0 returns the point unchanged. */
export function fuzzPoint(p: LatLng, maxM: number): LatLng {
  if (maxM <= 0) return { lat: p.lat, lng: p.lng };
  const d = maxM * (0.35 + 0.65 * Math.random());
  return destPoint(p, d, Math.random() * Math.PI * 2);
}
