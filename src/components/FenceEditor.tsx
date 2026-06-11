'use client';
import { useEffect, useRef } from 'react';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { Geofence } from '@/lib/types';

interface Props {
  value: Geofence;
  onChange: (f: Geofence) => void;
}

/** Tap the map to place a circle centre, or to add polygon corners. */
export default function FenceEditor({ value, onChange }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (disposed || !divRef.current || mapRef.current) return;
      const c = value.center ?? { lat: 53.5675, lng: -0.0815 };
      const map = L.map(divRef.current, { zoomControl: true }).setView([c.lat, c.lng], 14);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on('click', (e: any) => {
        const v = valueRef.current;
        if (v.type === 'circle') {
          onChangeRef.current({ ...v, center: { lat: e.latlng.lat, lng: e.latlng.lng } });
        } else {
          onChangeRef.current({
            ...v,
            points: [...(v.points ?? []), { lat: e.latlng.lat, lng: e.latlng.lng }],
          });
        }
      });
      mapRef.current = map;
      draw(L, value);
      // try to centre on the host's own position
      navigator.geolocation?.getCurrentPosition(
        (p) => map.setView([p.coords.latitude, p.coords.longitude], 14),
        () => {},
        { timeout: 4000 }
      );
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!mapRef.current || !layerRef.current) return;
      const L = (await import('leaflet')).default;
      draw(L, value);
      if (value.type === 'circle' && value.center) {
        mapRef.current.panTo([value.center.lat, value.center.lng]);
      }
    })();
  }, [value]);

  function draw(L: any, f: Geofence) {
    const layer = layerRef.current!;
    layer.clearLayers();
    if (f.type === 'circle' && f.center && f.radiusM) {
      L.circle([f.center.lat, f.center.lng], {
        radius: f.radiusM,
        color: '#ffc53b',
        weight: 2,
        dashArray: '6 6',
        fillColor: '#ffc53b',
        fillOpacity: 0.06,
      }).addTo(layer);
    }
    if (f.type === 'polygon' && f.points?.length) {
      for (const p of f.points) {
        L.circleMarker([p.lat, p.lng], { radius: 4, color: '#ffc53b', fillOpacity: 1 }).addTo(layer);
      }
      if (f.points.length >= 2) {
        L.polygon(f.points.map((p) => [p.lat, p.lng]), {
          color: '#ffc53b',
          weight: 2,
          dashArray: '6 6',
          fillColor: '#ffc53b',
          fillOpacity: 0.06,
        }).addTo(layer);
      }
    }
  }

  return <div ref={divRef} className="map" style={{ height: '40dvh' }} />;
}
