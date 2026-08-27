'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { Geofence, LatLng, MapNode, PingPoint } from '@/lib/types';
import { fenceCenter } from '@/lib/geo';

interface Props {
  master: Geofence;
  active: Geofence | null;
  next: Geofence | null;
  me: LatLng | null;
  points: PingPoint[];
  nodes: MapNode[];
  teammates?: { name: string; lat: number; lng: number }[] | null;
  role: 'hunter' | 'survivor' | null;
  placing?: boolean;
  onPlace?: (p: LatLng) => void;
  /** DEV ONLY: every player's true, unfuzzed position with a persistent name/role label. */
  rawPlayers?: { id: string; name: string; role: 'hunter' | 'survivor' | null; isOriginalHunter?: boolean; lat: number | null; lng: number | null }[];
}

function drawFence(L: any, layer: any, f: Geofence | null, opts: any) {
  if (!f) return;
  if (f.type === 'circle' && f.center && f.radiusM) {
    L.circle([f.center.lat, f.center.lng], { radius: f.radiusM, fill: false, ...opts }).addTo(layer);
  } else if (f.type === 'polygon' && f.points?.length) {
    L.polygon(f.points.map((p) => [p.lat, p.lng] as [number, number]), { fill: false, ...opts }).addTo(layer);
  }
}

/** Inject the SVG hatch pattern into Leaflet's SVG renderer once. */
function ensureHatchPattern() {
  if (document.getElementById('mh-hatch-pattern')) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  // Find Leaflet's SVG pane
  const leafletSvg = document.querySelector('.leaflet-overlay-pane svg');
  if (!leafletSvg) return;
  let defs = leafletSvg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(svgNS, 'defs'); leafletSvg.prepend(defs); }
  const pat = document.createElementNS(svgNS, 'pattern');
  pat.setAttribute('id', 'mh-hatch-pattern');
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', '7');
  pat.setAttribute('height', '7');
  pat.setAttribute('patternTransform', 'rotate(45)');
  const line = document.createElementNS(svgNS, 'line');
  line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
  line.setAttribute('x2', '0'); line.setAttribute('y2', '7');
  line.setAttribute('stroke', '#5b6470');
  line.setAttribute('stroke-width', '4');
  line.setAttribute('stroke-opacity', '0.95');
  pat.appendChild(line);
  defs.appendChild(pat);
}

/** Draw a hatched "exclusion zone" between master and active fences. */
function drawHatchZone(L: any, layer: any, master: Geofence, active: Geofence | null) {
  if (!active) return;

  if (master.type === 'circle' && master.center && master.radiusM &&
      active.type === 'circle' && active.center && active.radiusM) {
    // Leaflet circle with a hole: use a polygon approximation of the donut.
    // Outer ring (master), inner hole (active) — Leaflet supports holes via nested arrays.
    const outerPts = approxCircle(master.center, master.radiusM, 64);
    const innerPts = approxCircle(active.center, active.radiusM, 64);
    L.polygon([outerPts, innerPts], {
      color: '#5b6470', weight: 1, opacity: 0.5,
      fillColor: '#5b6470', fillOpacity: 0.5,
      fillRule: 'evenodd',
    }).addTo(layer);
    // Apply the SVG hatch pattern after the element is in the DOM
    requestAnimationFrame(() => {
      ensureHatchPattern();
      const svgs = document.querySelectorAll('.leaflet-overlay-pane path');
      svgs.forEach((el) => {
        const fill = (el as SVGElement).getAttribute('fill');
        if (fill === '#5b6470') (el as SVGElement).setAttribute('fill', 'url(#mh-hatch-pattern)');
      });
    });
  } else if (master.type === 'polygon' && master.points?.length &&
             active.type === 'polygon' && active.points?.length) {
    const outer = master.points.map((p) => [p.lat, p.lng] as [number, number]);
    const inner = active.points.map((p) => [p.lat, p.lng] as [number, number]);
    L.polygon([outer, inner], {
      color: '#5b6470', weight: 1, opacity: 0.5,
      fillColor: '#5b6470', fillOpacity: 0.5,
      fillRule: 'evenodd',
    }).addTo(layer);
    requestAnimationFrame(() => {
      ensureHatchPattern();
      const svgs = document.querySelectorAll('.leaflet-overlay-pane path');
      svgs.forEach((el) => {
        const fill = (el as SVGElement).getAttribute('fill');
        if (fill === '#5b6470') (el as SVGElement).setAttribute('fill', 'url(#mh-hatch-pattern)');
      });
    });
  }
}

function approxCircle(center: LatLng, radiusM: number, steps: number): [number, number][] {
  const pts: [number, number][] = [];
  const lat0 = center.lat * Math.PI / 180;
  const R = 6371000;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(angle)) / R * (180 / Math.PI);
    const dLng = (radiusM * Math.sin(angle)) / (R * Math.cos(lat0)) * (180 / Math.PI);
    pts.push([center.lat + dLat, center.lng + dLng]);
  }
  return pts;
}

export default function GameMap({ master, active, next, me, points, nodes, teammates, role, placing, onPlace, rawPlayers }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const fenceLayerRef = useRef<LayerGroup | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const onPlaceRef = useRef(onPlace);
  const placingRef = useRef(placing);
  onPlaceRef.current = onPlace;
  placingRef.current = placing;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (disposed || !divRef.current || mapRef.current) return;
      const c = fenceCenter(active ?? master);
      const map = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView([c.lat, c.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      fenceLayerRef.current = L.layerGroup().addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on('click', (e: any) => {
        if (placingRef.current && onPlaceRef.current) onPlaceRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      mapRef.current = map;
      setReady(true);
    })();
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fences (master + active + next preview)
  useEffect(() => {
    if (!ready || !fenceLayerRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      const layer = fenceLayerRef.current!;
      layer.clearLayers();
      drawHatchZone(L, layer, master, active);                                                         // grey hatch between master and active
      drawFence(L, layer, master, { color: '#5b6470', weight: 1, dashArray: '2 8', opacity: 0.7 });   // master: faint outline
      drawFence(L, layer, active, { color: '#ffc53b', weight: 2, dashArray: '6 6' });                  // active: amber dashed
      drawFence(L, layer, next, { color: '#ff3b5c', weight: 4, dashArray: null, opacity: 1 });         // next: thick solid red
      const fit = active ?? master;
      if (fit.type === 'circle' && fit.center && fit.radiusM) {
        const cc = L.circle([fit.center.lat, fit.center.lng], { radius: fit.radiusM });
        mapRef.current!.fitBounds(cc.getBounds(), { padding: [24, 24] });
      } else if (fit.type === 'polygon' && fit.points?.length) {
        const pg = L.polygon(fit.points.map((p) => [p.lat, p.lng] as [number, number]));
        mapRef.current!.fitBounds(pg.getBounds(), { padding: [24, 24] });
      }
    })();
  }, [ready, master, active, next]);

  // dynamic markers (pings, nodes, teammates, me)
  useEffect(() => {
    if (!ready || !layerRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      const layer = layerRef.current!;
      layer.clearLayers();

      // Inject pulse keyframes once
      if (!document.getElementById('mh-node-styles')) {
        const s = document.createElement('style');
        s.id = 'mh-node-styles';
        s.textContent = `
          @keyframes mh-pulse { 0%,100%{transform:scale(1);opacity:.7} 50%{transform:scale(1.55);opacity:0} }
          @keyframes mh-pulse-fast { 0%,100%{transform:scale(1);opacity:.7} 50%{transform:scale(1.55);opacity:0} }
          .mh-node-wrap { position:relative; width:50px; height:50px; }
          .mh-ring { position:absolute; inset:0; border-radius:50%; border:2px solid #7dd8f8; animation:mh-pulse 2s ease-out infinite; pointer-events:none; }
          .mh-ring.fast { animation:mh-pulse-fast .9s ease-out infinite; }
          .mh-core { position:absolute; inset:14px; border-radius:50%; background:#7dd8f8; display:flex; align-items:center; justify-content:center; }
          .mh-label { position:absolute; bottom:-18px; left:50%; transform:translateX(-50%); white-space:nowrap; font-size:10px; font-weight:600; letter-spacing:.06em; color:#7dd8f8; text-shadow:0 0 6px rgba(125,216,248,.9); }
        `;
        document.head.appendChild(s);
      }

      const enemy = role === 'hunter' ? '#38e89c' : '#ff3b5c';
      for (const p of points) {
        L.circle([p.lat, p.lng], { radius: Math.max(p.r, 15), color: enemy, weight: 1.5, fillColor: enemy, fillOpacity: 0.12 }).addTo(layer);
        L.circleMarker([p.lat, p.lng], { radius: 5, color: enemy, fillColor: enemy, fillOpacity: 0.9 }).addTo(layer);
      }

      const now = Date.now();
      for (const n of nodes) {
        if (n.kind === 'deadzone') {
          L.circle([n.lat, n.lng], { radius: n.radiusM, color: '#7c5cff', weight: 1.5, dashArray: '4 6', fillColor: '#7c5cff', fillOpacity: 0.12 }).addTo(layer);
        } else if (n.kind === 'tripwire') {
          L.circleMarker([n.lat, n.lng], { radius: 6, color: '#ffc53b', weight: 2, fillColor: '#3a2d0a', fillOpacity: 0.9 })
            .bindTooltip('Your tripwire', { permanent: false }).addTo(layer);
        } else if (n.kind === 'pickup' || n.kind === 'drop' || n.kind === 'lure') {
          // All three look identical to survivors (lure deception).
          // Determine if expiring soon (last 30s).
          const expiring = n.expiresAt
            ? new Date(n.expiresAt).getTime() - now < 30000
            : false;
          const label = n.kind === 'drop' ? 'DROPPED' : 'POWER-UP';
          // Star SVG path (5-point, 16px)
          const starSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#0a1f2e" stroke="#7dd8f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
          const icon = L.divIcon({
            className: '',
            html: `<div class="mh-node-wrap"><div class="mh-ring${expiring ? ' fast' : ''}"></div><div class="mh-core">${starSvg}</div><div class="mh-label">${label}</div></div>`,
            iconSize: [50, 50],
            iconAnchor: [25, 25],
          });
          L.marker([n.lat, n.lng], { icon }).addTo(layer);
        }
      }

      for (const t of teammates ?? []) {
        L.circleMarker([t.lat, t.lng], { radius: 5, color: '#ffc53b', fillColor: '#ffc53b', fillOpacity: 0.9 })
          .bindTooltip(t.name, { permanent: false }).addTo(layer);
      }
      if (me) {
        const mine = role === 'hunter' ? '#ff3b5c' : '#38e89c';
        L.circleMarker([me.lat, me.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: mine, fillOpacity: 1 }).addTo(layer);
      }

      // DEV ONLY: every player's true position, permanently labeled.
      for (const p of rawPlayers ?? []) {
        if (p.lat == null || p.lng == null) continue;
        const col = p.role === 'hunter' ? (p.isOriginalHunter ? '#ff3b5c' : '#ffc53b') : '#38e89c';
        L.circleMarker([p.lat, p.lng], { radius: 8, color: '#ffffff', weight: 2, fillColor: col, fillOpacity: 0.95 })
          .bindTooltip(`${p.name} · ${p.role === 'hunter' ? (p.isOriginalHunter ? 'hunter' : 'infected') : 'survivor'}`,
            { permanent: true, direction: 'top', offset: [0, -10], className: 'mh-dev-label' })
          .addTo(layer);
      }
    })();
  }, [ready, points, nodes, me, teammates, role, rawPlayers]);

  return <div ref={divRef} className="map" style={placing ? { outline: '2px solid var(--amber)' } : undefined} />;
}
