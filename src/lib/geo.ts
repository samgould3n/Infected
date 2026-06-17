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

// ── v2 geometry helpers (moving fence, scaling, random placement) ──

const EARTH = 6371000;

/** Approximate planar area (m²) of a polygon using an equirectangular projection. */
export function polygonArea(pts: LatLng[]): number {
  if (!pts || pts.length < 3) return 0;
  const lat0 = rad(pts.reduce((s, p) => s + p.lat, 0) / pts.length);
  const xy = pts.map((p) => ({ x: rad(p.lng) * Math.cos(lat0) * EARTH, y: rad(p.lat) * EARTH }));
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    a += (xy[j].x + xy[i].x) * (xy[j].y - xy[i].y);
  }
  return Math.abs(a / 2);
}

export function circleArea(radiusM: number): number {
  return Math.PI * radiusM * radiusM;
}

/** Centroid of a polygon (vertex average — good enough for placement). */
export function polygonCentroid(pts: LatLng[]): LatLng {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat, lng };
}

/** Scale a polygon about its centroid by linear factor k (area scales by k²). */
export function scalePolygon(pts: LatLng[], k: number): LatLng[] {
  const c = polygonCentroid(pts);
  const latScale = 1; // degrees scale ~linearly for small areas
  return pts.map((p) => ({
    lat: c.lat + (p.lat - c.lat) * k * latScale,
    lng: c.lng + (p.lng - c.lng) * k,
  }));
}

/** Translate a polygon by a lat/lng delta. */
export function translatePolygon(pts: LatLng[], dLat: number, dLng: number): LatLng[] {
  return pts.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }));
}

/** Axis-aligned bounding box of a polygon. */
export function polygonBounds(pts: LatLng[]) {
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

/** True if every vertex of `inner` lies inside `outer`. */
export function polygonInsidePolygon(inner: LatLng[], outer: LatLng[]): boolean {
  return inner.every((p) => pointInPolygon(p, outer));
}

/** True if a circle (center,r) lies fully within the master fence. */
export function circleInsideFence(master: Geofence, center: LatLng, radiusM: number): boolean {
  if (master.type === 'circle' && master.center && master.radiusM) {
    return haversine(master.center, center) + radiusM <= master.radiusM;
  }
  if (master.type === 'polygon' && master.points) {
    // sample the circle perimeter; cheap and sufficient
    for (let i = 0; i < 12; i++) {
      const pt = destPoint(center, radiusM, (i / 12) * Math.PI * 2);
      if (!pointInPolygon(pt, master.points)) return false;
    }
    return pointInPolygon(center, master.points);
  }
  return true;
}

/** Uniform-ish random point inside a fence (rejection sampling for polygons). */
export function randomPointInFence(f: Geofence): LatLng {
  if (f.type === 'circle' && f.center && f.radiusM) {
    const d = f.radiusM * Math.sqrt(Math.random());
    return destPoint(f.center, d, Math.random() * Math.PI * 2);
  }
  if (f.type === 'polygon' && f.points && f.points.length >= 3) {
    const b = polygonBounds(f.points);
    for (let i = 0; i < 200; i++) {
      const p = {
        lat: b.minLat + Math.random() * (b.maxLat - b.minLat),
        lng: b.minLng + Math.random() * (b.maxLng - b.minLng),
      };
      if (pointInPolygon(p, f.points)) return p;
    }
    return polygonCentroid(f.points);
  }
  return fenceCenter(f);
}

/** Area of any fence in m². */
export function fenceArea(f: Geofence): number {
  if (f.type === 'circle' && f.radiusM) return circleArea(f.radiusM);
  if (f.type === 'polygon' && f.points) return polygonArea(f.points);
  return 0;
}
