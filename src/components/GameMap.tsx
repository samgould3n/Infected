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
}

function drawFence(L: any, layer: any, f: Geofence | null, opts: any) {
  if (!f) return;
  if (f.type === 'circle' && f.center && f.radiusM) {
    L.circle([f.center.lat, f.center.lng], { radius: f.radiusM, fill: false, ...opts }).addTo(layer);
  } else if (f.type === 'polygon' && f.points?.length) {
    L.polygon(f.points.map((p) => [p.lat, p.lng] as [number, number]), { fill: false, ...opts }).addTo(layer);
  }
}

export default function GameMap({ master, active, next, me, points, nodes, teammates, role, placing, onPlace }: Props) {
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
      drawFence(L, layer, master, { color: '#5b6470', weight: 1, dashArray: '2 8', opacity: 0.7 });   // master: faint
      drawFence(L, layer, active, { color: '#ffc53b', weight: 2, dashArray: '6 6' });                  // active: amber
      drawFence(L, layer, next, { color: '#ff3b5c', weight: 2, dashArray: '2 6', opacity: 0.9 });      // next: red preview
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
      const enemy = role === 'hunter' ? '#38e89c' : '#ff3b5c';
      for (const p of points) {
        L.circle([p.lat, p.lng], { radius: Math.max(p.r, 15), color: enemy, weight: 1.5, fillColor: enemy, fillOpacity: 0.12 }).addTo(layer);
        L.circleMarker([p.lat, p.lng], { radius: 5, color: enemy, fillColor: enemy, fillOpacity: 0.9 }).addTo(layer);
      }
      // nodes
      for (const n of nodes) {
        if (n.kind === 'deadzone') {
          L.circle([n.lat, n.lng], { radius: n.radiusM, color: '#7c5cff', weight: 1.5, dashArray: '4 6', fillColor: '#7c5cff', fillOpacity: 0.12 }).addTo(layer);
        } else if (n.kind === 'lure') {
          L.circleMarker([n.lat, n.lng], { radius: 7, color: '#ff3b5c', weight: 2, fillColor: '#2a0d12', fillOpacity: 0.9 })
            .bindTooltip('Lure', { permanent: false }).addTo(layer);
        } else if (n.kind === 'tripwire') {
          L.circleMarker([n.lat, n.lng], { radius: 6, color: '#ffc53b', weight: 2, fillColor: '#3a2d0a', fillOpacity: 0.9 })
            .bindTooltip('Your tripwire', { permanent: false }).addTo(layer);
        } else {
          // pickup / drop
          const col = n.kind === 'drop' ? '#9cff57' : '#38e89c';
          L.circleMarker([n.lat, n.lng], { radius: 7, color: col, weight: 2, fillColor: col, fillOpacity: 0.85 })
            .bindTooltip(n.kind === 'drop' ? 'Dropped power-up' : 'Power-up', { permanent: false }).addTo(layer);
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
    })();
  }, [ready, points, nodes, me, teammates, role]);

  return <div ref={divRef} className="map" style={placing ? { outline: '2px solid var(--amber)' } : undefined} />;
}
