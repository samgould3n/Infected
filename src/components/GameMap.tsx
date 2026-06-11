'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { Geofence, LatLng, PingPoint } from '@/lib/types';
import { fenceCenter } from '@/lib/geo';

interface Props {
  geofence: Geofence;
  me: LatLng | null;
  points: PingPoint[];
  teammates?: { name: string; lat: number; lng: number }[] | null;
  role: 'hunter' | 'survivor' | null;
}

export default function GameMap({ geofence, me, points, teammates, role }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (disposed || !divRef.current || mapRef.current) return;
      const c = fenceCenter(geofence);
      const map = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView(
        [c.lat, c.lng],
        15
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      // fence
      if (geofence.type === 'circle' && geofence.center && geofence.radiusM) {
        const f = L.circle([geofence.center.lat, geofence.center.lng], {
          radius: geofence.radiusM,
          color: '#ffc53b',
          weight: 2,
          dashArray: '6 6',
          fill: false,
        }).addTo(map);
        map.fitBounds(f.getBounds(), { padding: [16, 16] });
      } else if (geofence.type === 'polygon' && geofence.points?.length) {
        const f = L.polygon(
          geofence.points.map((p) => [p.lat, p.lng] as [number, number]),
          { color: '#ffc53b', weight: 2, dashArray: '6 6', fill: false }
        ).addTo(map);
        map.fitBounds(f.getBounds(), { padding: [16, 16] });
      }
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !layerRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      const layer = layerRef.current!;
      layer.clearLayers();
      const enemy = role === 'hunter' ? '#38e89c' : '#ff3b5c'; // opposing team colour
      for (const p of points) {
        L.circle([p.lat, p.lng], {
          radius: Math.max(p.r, 15),
          color: enemy,
          weight: 1.5,
          fillColor: enemy,
          fillOpacity: 0.12,
        }).addTo(layer);
        L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color: enemy,
          fillColor: enemy,
          fillOpacity: 0.9,
        }).addTo(layer);
      }
      for (const t of teammates ?? []) {
        L.circleMarker([t.lat, t.lng], {
          radius: 5,
          color: '#ffc53b',
          fillColor: '#ffc53b',
          fillOpacity: 0.9,
        })
          .bindTooltip(t.name, { permanent: false })
          .addTo(layer);
      }
      if (me) {
        const mine = role === 'hunter' ? '#ff3b5c' : '#38e89c';
        L.circleMarker([me.lat, me.lng], {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: mine,
          fillOpacity: 1,
        }).addTo(layer);
      }
    })();
  }, [ready, points, me, teammates, role]);

  return <div ref={divRef} className="map" />;
}
