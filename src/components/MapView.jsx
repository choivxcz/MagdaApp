import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 draws the map in a separate worker file. Let Vite copy it
// into the build and tell MapLibre where it ended up.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { DIRECTIONS, seatStatus } from '../lib/directions.js';
import { JEEP_SVG } from './Icon.jsx';

maplibregl.setWorkerUrl(workerUrl);

// Free OpenStreetMap-based tiles, no API key needed.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function makeEl(className, text) {
  const el = document.createElement('div');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

function fillJeepMarker(el, j) {
  const dir = DIRECTIONS[j.direction] ?? DIRECTIONS.to_santa_cruz;
  const seats = seatStatus(j);
  // classList keeps MapLibre's own marker classes.
  el.classList.remove(...Object.values(DIRECTIONS).map((d) => d.className));
  el.classList.add('jeep-marker', dir.className);
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Jeepney ${j.plate}, see driver`);
  // Build the parts once and only update their text afterwards. Replacing
  // them on every refresh would swallow a tap that lands mid-refresh.
  if (!el.firstChild) {
    const icon = makeEl('jeep-icon');
    icon.innerHTML = JEEP_SVG;
    const label = makeEl('jeep-label');
    label.append(makeEl('jeep-plate'), makeEl('jeep-seats'));
    el.append(icon, label);
  }
  const [plateEl, seatsEl] = el.lastChild.children;
  plateEl.textContent = j.plate;
  seatsEl.hidden = seats.level === 'unknown';
  seatsEl.className = `jeep-seats seats-${seats.level}`;
  seatsEl.textContent = seats.level === 'full' ? 'Full' : `${seats.free}`;
}

// Shows the route, stops, jeepneys, the rider's pickup and the phone's own position.
// onReady(map) hands the map to the screen so it can add its own buttons.
// onJeepTap(id) runs when a jeepney marker is tapped.
export default function MapView({ route, jeepneys = [], pickup, me, onPick, onJeepTap, activeDirection, visible = true, padding, onReady }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const jeepMarkers = useRef(new Map());
  const pickupMarker = useRef(null);
  const meMarker = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onJeepTapRef = useRef(onJeepTap);
  onJeepTapRef.current = onJeepTap;
  const activeRef = useRef(activeDirection);
  activeRef.current = activeDirection;
  const paddingRef = useRef(padding);
  paddingRef.current = padding;
  const fitted = useRef(false);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds: route.bounds,
      fitBoundsOptions: { padding: { top: 40, bottom: 40, left: 30, right: 30, ...(paddingRef.current ?? {}) } },
      attributionControl: { compact: true },
    });

    map.on('load', () => {
      const layout = { 'line-cap': 'round', 'line-join': 'round' };
      const legs = Object.entries(route.legs);
      for (const [direction, leg] of legs) {
        map.addSource(`leg-${direction}`, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.coordinates } },
        });
      }
      // line-offset follows each line's own travel direction, so the same
      // positive value puts each direction on its own (right-hand) side.
      for (const [direction] of legs) {
        map.addLayer({
          id: `leg-${direction}-casing`, type: 'line', source: `leg-${direction}`, layout,
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-offset': 3 },
        });
      }
      for (const [direction] of legs) {
        map.addLayer({
          id: `leg-${direction}`, type: 'line', source: `leg-${direction}`, layout,
          paint: { 'line-color': DIRECTIONS[direction].color, 'line-width': 5, 'line-offset': 3 },
        });
      }
      applyActive(map, activeRef.current);
    });

    for (const stop of route.stops) {
      const el = makeEl('stop-marker');
      el.title = stop.name;
      new maplibregl.Marker({ element: el })
        .setLngLat(stop.coord)
        .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(stop.name))
        .addTo(map);
    }

    map.on('click', (e) => {
      // A tap on a jeepney opens its driver, it doesn't move the pickup pin.
      if (e.originalEvent?.target?.closest?.('.jeep-marker')) return;
      onPickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
    });
    // A map built inside a hidden tab has no size yet; fit it when first shown.
    fitted.current = containerRef.current.clientHeight > 0;
    mapRef.current = map;
    onReady?.(map);

    return () => {
      map.remove();
      mapRef.current = null;
      jeepMarkers.current.clear();
      pickupMarker.current = null;
      meMarker.current = null;
    };
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // The map stays alive while other tabs are open; redraw at the right size when shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    map.resize();
    if (!fitted.current && containerRef.current.clientHeight > 0) {
      fitted.current = true;
      // Room for floating panels is already set with setPadding, so only a small margin here.
      map.fitBounds(route.bounds, { padding: { top: 30, bottom: 30, left: 30, right: 30 }, animate: false });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leave room for floating panels when centering the map.
  useEffect(() => {
    if (padding) mapRef.current?.setPadding({ top: 0, bottom: 0, left: 0, right: 0, ...padding });
  }, [padding?.top, padding?.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyActive(map, active) {
    for (const direction of Object.keys(route.legs)) {
      if (!map.getLayer(`leg-${direction}`)) continue;
      const dim = active && active !== direction;
      map.setPaintProperty(`leg-${direction}`, 'line-opacity', dim ? 0.3 : 1);
      map.setPaintProperty(`leg-${direction}-casing`, 'line-opacity', dim ? 0 : 1);
    }
    if (active && map.getLayer(`leg-${active}`)) map.moveLayer(`leg-${active}`);
  }
  useEffect(() => {
    if (mapRef.current) applyActive(mapRef.current, activeDirection);
  }, [activeDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();
    for (const j of jeepneys) {
      seen.add(j.id);
      let marker = jeepMarkers.current.get(j.id);
      if (!marker) {
        const el = makeEl('jeep-marker');
        const id = j.id;
        el.tabIndex = 0;
        el.addEventListener('click', () => onJeepTapRef.current?.(id));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onJeepTapRef.current?.(id); });
        marker = new maplibregl.Marker({ element: el }).setLngLat([j.lng, j.lat]).addTo(map);
        jeepMarkers.current.set(j.id, marker);
      } else {
        marker.setLngLat([j.lng, j.lat]);
      }
      const el = marker.getElement();
      fillJeepMarker(el, j);
      el.classList.toggle('is-dim', !!activeDirection && j.direction !== activeDirection);
    }
    for (const [id, marker] of jeepMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        jeepMarkers.current.delete(id);
      }
    }
  }, [jeepneys, activeDirection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pickup) {
      pickupMarker.current?.remove();
      pickupMarker.current = null;
      return;
    }
    if (!pickupMarker.current) {
      const el = makeEl('pickup-marker');
      el.append(makeEl('pickup-pin'));
      pickupMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(pickup).addTo(map);
    } else {
      pickupMarker.current.setLngLat(pickup);
    }
  }, [pickup]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      meMarker.current = new maplibregl.Marker({ element: makeEl('me-marker') }).setLngLat(me).addTo(map);
    } else {
      meMarker.current.setLngLat(me);
    }
  }, [me]);

  return <div ref={containerRef} className="map" />;
}

// Round floating buttons on the map: zoom and "find me".
export function MapButtons({ map, onLocate, children }) {
  return (
    <div className="map-buttons">
      {children}
      <div className="map-btn-group">
        <button className="map-btn" onClick={() => map?.zoomIn()} aria-label="Zoom in">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className="map-btn" onClick={() => map?.zoomOut()} aria-label="Zoom out">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /></svg>
        </button>
      </div>
      {onLocate && (
        <button className="map-btn" onClick={onLocate} aria-label="Find my location">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3" /></svg>
        </button>
      )}
    </div>
  );
}
