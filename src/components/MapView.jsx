import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 draws the map in a separate worker file. Let Vite copy it
// into the build and tell MapLibre where it ended up.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { DIRECTIONS, seatStatus } from '../lib/directions.js';
import { JEEP_SVG, WAITING_SVG, PATHS } from './Icon.jsx';
import { LANDMARK_CATS, landmarksGeoJSON } from '../lib/landmarks.js';
import { markerTag, inService } from '../lib/tripStatus.js';

maplibregl.setWorkerUrl(workerUrl);

// Free OpenStreetMap-based tiles, no API key needed.
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
// Night map: same map tiles (already on the phone), only a ~20 KB style.
export const MAP_STYLE_NIGHT = 'https://tiles.openfreemap.org/styles/dark';
export const COMMUNITY_COLOR = '#0f766e';

// Jeepneys glide to their new spot instead of jumping, so the map feels
// alive even with fewer updates (which saves data). Big jumps (a phone that
// was out of signal) and "reduce motion" phones just move.
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function glide(marker, to, ms = 1600) {
  cancelAnimationFrame(marker.glideFrame);
  const from = marker.getLngLat();
  const dx = to[0] - from.lng;
  const dy = to[1] - from.lat;
  if (reducedMotion() || document.hidden || Math.abs(dx) + Math.abs(dy) > 0.02) { marker.setLngLat(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    marker.setLngLat([from.lng + dx * e, from.lat + dy * e]);
    if (k < 1) marker.glideFrame = requestAnimationFrame(step);
  };
  marker.glideFrame = requestAnimationFrame(step);
}

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
    label.append(makeEl('jeep-plate'), makeEl('jeep-seats'), makeEl('jeep-status'));
    el.append(icon, label);
  }
  const [plateEl, seatsEl, statusEl] = el.lastChild.children;
  plateEl.textContent = j.plate;
  seatsEl.hidden = seats.level === 'unknown';
  seatsEl.className = `jeep-seats seats-${seats.level}`;
  seatsEl.textContent = seats.level === 'full' ? 'Full' : `${seats.free}`;
  // "Loading", "Break", "Breakdown", "Last trip"...
  const tag = markerTag(j);
  statusEl.hidden = !tag;
  statusEl.textContent = tag ?? '';
  statusEl.className = `jeep-status ${j.tripStatus ?? 'on_trip'}`;
  el.classList.toggle('out-of-service', !inService(j));
}

// Shows the route, stops, jeepneys, the rider's pickup and the phone's own position.
// onReady(map) hands the map to the screen so it can add its own buttons.
// onJeepTap(id) runs when a jeepney marker is tapped.
// The rider's own journey, drawn in violet on top of everything: walking
// (dotted), jeepney rides (solid) and tricycle rides (dashed amber).
export const GUIDE_COLOR = '#7c3aed';
export const TRIKE_COLOR = '#d97706';
const EMPTY = { type: 'FeatureCollection', features: [] };
const linesData = (list) => ({
  type: 'FeatureCollection',
  features: (list ?? []).filter((c) => c?.length > 1).map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
});

// Keep the map on the Magdalena – Santa Cruz route: the middle of what you
// see must stay within the route area plus room to walk to a sakayan, and
// you can't zoom out much past the view that fits the whole route.
const LIMIT_MARGIN_KM = 4; // tricycles reach places a few km off the route
const EXTRA_ZOOM_OUT = 0.15;

function centerBox(route) {
  const [[x1, y1], [x2, y2]] = route.bounds;
  const dLat = LIMIT_MARGIN_KM / 110.57;
  const dLng = LIMIT_MARGIN_KM / (111.32 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180));
  return [[x1 - dLng, y1 - dLat], [x2 + dLng, y2 + dLat]];
}

// Zoom level at which the whole route just fits between the floating panels.
function fitZoom(map, route) {
  const el = map.getContainer();
  const pad = map.getPadding();
  const [[x1, y1], [x2, y2]] = route.bounds;
  const a = map.project([x1, y2]);
  const b = map.project([x2, y1]);
  const availW = el.clientWidth - pad.left - pad.right - 60;
  const availH = el.clientHeight - pad.top - pad.bottom - 60;
  if (availW <= 0 || availH <= 0) return null;
  return map.getZoom() + Math.log2(Math.min(availW / Math.abs(b.x - a.x), availH / Math.abs(b.y - a.y)));
}

function applyLimits(map, route) {
  if (!hasSize(map)) return;
  const z = fitZoom(map, route);
  if (Number.isFinite(z)) map.setMinZoom(Math.max(0, z - EXTRA_ZOOM_OUT));
  keepOnRoute(map, route);
}

// Everything outside the route area, faded so the corridor stands out.
function outsideMask(route) {
  const [[x1, y1], [x2, y2]] = centerBox(route);
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
        [[x1, y1], [x1, y2], [x2, y2], [x2, y1], [x1, y1]],
      ],
    },
  };
}

// ---- Landmarks layer -------------------------------------------------------
// Round colored icons with the place name. Iconic places (rank 0) show even
// zoomed out; big ones from zoom 13.5; restaurants, shops and the rest only
// when zoomed in. MapLibre hides labels that would overlap.
const LM_LAYERS = ['landmarks-r3', 'landmarks-r2', 'landmarks-r1', 'landmarks-r0'];
const BASE_POI_LAYERS = ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'];

function iconSvg(color, path) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28">`
    + `<circle cx="14" cy="14" r="12" fill="${color}" stroke="#fff" stroke-width="2.4"/>`
    + `<g transform="translate(7 7) scale(0.5833)"><path d="${path}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

async function addLandmarkImages(map) {
  await Promise.all(Object.entries(LANDMARK_CATS).map(async ([cat, c]) => {
    const id = `lm-${cat}`;
    if (map.hasImage(id)) return;
    const img = new Image(56, 56);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(c.color, PATHS[c.icon] ?? PATHS.pin))}`;
    await img.decode();
    if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
  }));
}

async function addLandmarkLayers(map, list, show) {
  try {
    await addLandmarkImages(map);
  } catch {
    return; // icons couldn't be drawn: the map works without landmarks
  }
  if (!map.getStyle() || map.getSource('landmarks')) return;
  map.addSource('landmarks', { type: 'geojson', data: landmarksGeoJSON(list) });
  map.addSource('landmark-selected', { type: 'geojson', data: EMPTY });
  const before = map.getLayer('guide-trike-casing') ? 'guide-trike-casing' : undefined;
  map.addLayer({
    id: 'landmark-selected', type: 'circle', source: 'landmark-selected',
    paint: { 'circle-radius': 20, 'circle-color': '#c84b0c', 'circle-opacity': 0.18, 'circle-stroke-color': '#c84b0c', 'circle-stroke-width': 2.5 },
  }, before);
  const text = map.isNight
    ? { 'text-color': '#e7e2dc', 'text-halo-color': '#111111', 'text-halo-width': 1.6 }
    : { 'text-color': '#1f2124', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 };
  const levels = [
    // rank, minzoom, icon size, label from zoom, font, label size
    [3, 16.2, 0.72, 17, 'Noto Sans Regular', 11],
    [2, 15, 0.78, 16, 'Noto Sans Regular', 11.5],
    [1, 13.5, 0.85, 14.8, 'Noto Sans Regular', 12],
    [0, 11, 1.05, 11, 'Noto Sans Bold', 12.5],
  ];
  for (const [rank, minzoom, size, labelZoom, font, textSize] of levels) {
    map.addLayer({
      id: `landmarks-r${rank}`, type: 'symbol', source: 'landmarks', minzoom,
      filter: ['==', ['get', 'rank'], rank],
      layout: {
        visibility: show ? 'visible' : 'none',
        'icon-image': ['get', 'img'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, size * 0.85, 17, size * 1.1],
        'text-field': labelZoom <= minzoom ? ['get', 'name'] : ['step', ['zoom'], '', labelZoom, ['get', 'name']],
        'text-font': [font],
        'text-size': textSize,
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
        'symbol-sort-key': rank,
      },
      paint: rank === 0 ? { ...text, 'text-color': map.isNight ? '#fdba74' : '#7a2e05' } : text,
    }, before);
  }
  setBasePois(map, !show);
}

function setBasePois(map, visible) {
  for (const id of BASE_POI_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

// The landmark under a tap (with a little room for fingers), as its properties.
function landmarkAt(map, point) {
  const layers = LM_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!layers.length) return null;
  const f = map.queryRenderedFeatures([[point.x - 12, point.y - 12], [point.x + 12, point.y + 12]], { layers })[0];
  return f ? { ...f.properties, coord: f.geometry.coordinates } : null;
}

// Tricycle / e-trike routes and terminals added by commuters (approved).
const COMMUNITY_LAYERS = ['community-terminals', 'community-routes-hit'];
function communityData(list) {
  return {
    type: 'FeatureCollection',
    features: (list ?? []).map((p) => (p.kind === 'local_route' && p.path?.length > 1
      ? { type: 'Feature', properties: { id: p.id, kind: p.kind, name: p.name }, geometry: { type: 'LineString', coordinates: p.path } }
      : { type: 'Feature', properties: { id: p.id, kind: p.kind, name: p.name }, geometry: { type: 'Point', coordinates: p.point } })),
  };
}
function addCommunityLayers(map, list) {
  if (!map.getStyle() || map.getSource('community')) return;
  map.addSource('community', { type: 'geojson', data: communityData(list) });
  const before = map.getLayer('guide-trike-casing') ? 'guide-trike-casing' : undefined;
  const lines = ['==', ['geometry-type'], 'LineString'];
  map.addLayer({ id: 'community-routes', type: 'line', source: 'community', filter: lines, minzoom: 12,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COMMUNITY_COLOR, 'line-width': 3, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } }, before);
  map.addLayer({ id: 'community-routes-hit', type: 'line', source: 'community', filter: lines, minzoom: 12,
    paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'community-terminals', type: 'circle', source: 'community', filter: ['==', ['geometry-type'], 'Point'], minzoom: 12,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 7], 'circle-color': COMMUNITY_COLOR, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, before);
  map.addLayer({ id: 'community-labels', type: 'symbol', source: 'community', minzoom: 15,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true, 'symbol-placement': 'point', 'text-max-width': 9 },
    paint: map.isNight ? { 'text-color': '#5eead4', 'text-halo-color': '#111', 'text-halo-width': 1.5 } : { 'text-color': '#0b4f4a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, before);
}
function communityAt(map, point) {
  const layers = COMMUNITY_LAYERS.filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  return map.queryRenderedFeatures([[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]], { layers })[0]?.properties ?? null;
}

// A hidden map (another tab is open) has no size: don't adjust it then.
const hasSize = (map) => {
  const el = map.getContainer();
  return el.clientWidth > 0 && el.clientHeight > 0;
};

function keepOnRoute(map, route) {
  // Moving the map here fires "move" again, which calls this again. Without
  // this guard, a hidden (zero-size) map could bounce between our limit and
  // MapLibre's own forever and freeze the page.
  if (map.keepingOnRoute || !hasSize(map)) return;
  const [[x1, y1], [x2, y2]] = centerBox(route);
  const c = map.getCenter();
  const lng = Math.min(Math.max(c.lng, x1), x2);
  const lat = Math.min(Math.max(c.lat, y1), y2);
  if (Math.abs(lng - c.lng) < 1e-9 && Math.abs(lat - c.lat) < 1e-9) return;
  map.keepingOnRoute = true;
  try {
    map.setCenter([lng, lat]);
  } finally {
    map.keepingOnRoute = false;
  }
}

// guide: { walks, rides, trikes: [coordinate lists], markers: [{ kind, point, label }] }
//   kind is 'board' (sakayan), 'alight' (babaan) or 'transfer'.
// dest: the rider's destination point (red pin).
// waiting: [{ point, people, dim }] passengers waiting for a ride (driver view).
// landmarks: places along the route (landmarks.js); showLandmarks turns them
// on/off; onLandmarkTap(landmark) runs when one is tapped; selectedLandmark
// (id) gets a highlight ring.
export default function MapView({
  route, jeepneys = [], pickup, dest, me, guide, waiting, onPick, onJeepTap, activeDirection, visible = true, padding, onReady,
  landmarks, showLandmarks = true, onLandmarkTap, selectedLandmark, community, onCommunityTap, night = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const jeepMarkers = useRef(new Map());
  const pickupMarker = useRef(null);
  const destMarker = useRef(null);
  const meMarker = useRef(null);
  const guideMarkers = useRef({});
  const waitingMarkers = useRef([]);
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onJeepTapRef = useRef(onJeepTap);
  onJeepTapRef.current = onJeepTap;
  const activeRef = useRef(activeDirection);
  activeRef.current = activeDirection;
  const paddingRef = useRef(padding);
  paddingRef.current = padding;
  const landmarksRef = useRef(landmarks);
  landmarksRef.current = landmarks;
  const showLandmarksRef = useRef(showLandmarks);
  showLandmarksRef.current = showLandmarks;
  const onLandmarkTapRef = useRef(onLandmarkTap);
  onLandmarkTapRef.current = onLandmarkTap;
  const fitted = useRef(false);
  const communityRef = useRef(community);
  communityRef.current = community;
  const onCommunityTapRef = useRef(onCommunityTap);
  onCommunityTapRef.current = onCommunityTap;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: night ? MAP_STYLE_NIGHT : MAP_STYLE,
      bounds: route.bounds,
      renderWorldCopies: false,
      fitBoundsOptions: { padding: { top: 40, bottom: 40, left: 30, right: 30, ...(paddingRef.current ?? {}) } },
      attributionControl: { compact: true },
    });

    map.isNight = night;
    map.on('load', () => {
      const layout = { 'line-cap': 'round', 'line-join': 'round' };
      map.addSource('outside', { type: 'geojson', data: outsideMask(route) });
      map.addLayer({ id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-color': night ? '#000000' : '#f3efe9', 'fill-opacity': night ? 0.55 : 0.72 } });
      map.addLayer({ id: 'outside-edge', type: 'line', source: 'outside', paint: { 'line-color': '#c84b0c', 'line-opacity': 0.35, 'line-width': 1.5, 'line-dasharray': [3, 2] } });
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
          paint: { 'line-color': night ? '#1a1a1a' : '#ffffff', 'line-width': 8, 'line-offset': 3 },
        });
      }
      for (const [direction] of legs) {
        map.addLayer({
          id: `leg-${direction}`, type: 'line', source: `leg-${direction}`, layout,
          paint: { 'line-color': DIRECTIONS[direction].color, 'line-width': 5, 'line-offset': 3 },
        });
      }
      if (landmarksRef.current?.length) addLandmarkLayers(map, landmarksRef.current, showLandmarksRef.current);
      addCommunityLayers(map, communityRef.current);
      map.addSource('guide-ride', { type: 'geojson', data: EMPTY });
      map.addSource('guide-walk', { type: 'geojson', data: EMPTY });
      map.addSource('guide-trike', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'guide-trike-casing', type: 'line', source: 'guide-trike', layout, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ id: 'guide-trike', type: 'line', source: 'guide-trike', layout, paint: { 'line-color': TRIKE_COLOR, 'line-width': 5, 'line-dasharray': [1.6, 1.2] } });
      map.addLayer({ id: 'guide-ride-casing', type: 'line', source: 'guide-ride', layout, paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-offset': 3 } });
      map.addLayer({ id: 'guide-ride', type: 'line', source: 'guide-ride', layout, paint: { 'line-color': GUIDE_COLOR, 'line-width': 7, 'line-offset': 3 } });
      map.addLayer({ id: 'guide-walk-casing', type: 'line', source: 'guide-walk', layout, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
      map.addLayer({ id: 'guide-walk', type: 'line', source: 'guide-walk', layout, paint: { 'line-color': GUIDE_COLOR, 'line-width': 5, 'line-dasharray': [0.1, 1.8] } });
      applyActive(map, activeRef.current);
      applyGuide(map, guideRef.current);
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
      // A tap on (or right next to) a landmark opens its card.
      const lm = landmarkAt(map, e.point);
      if (lm) { onLandmarkTapRef.current?.(lm); return; }
      const cp = onCommunityTapRef.current ? communityAt(map, e.point) : null;
      if (cp) { onCommunityTapRef.current(cp.id); return; }
      onPickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
    });
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = landmarkAt(map, e.point) || communityAt(map, e.point) ? 'pointer' : '';
    });
    // Stay on the route while panning, and re-check the zoom-out limit when
    // the map is shown, the phone is rotated or the window is resized.
    map.on('move', () => keepOnRoute(map, route));
    map.on('load', () => applyLimits(map, route));
    map.on('resize', () => { if (containerRef.current?.clientHeight) applyLimits(map, route); });
    // A map built inside a hidden tab has no size yet; fit it when first shown.
    fitted.current = containerRef.current.clientHeight > 0;
    mapRef.current = map;
    if (import.meta.env.DEV) window.__sakayMap = map; // for testing in the browser console
    onReady?.(map);

    return () => {
      map.remove();
      mapRef.current = null;
      jeepMarkers.current.clear();
      pickupMarker.current = null;
      destMarker.current = null;
      meMarker.current = null;
      guideMarkers.current = {};
      waitingMarkers.current = [];
    };
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // The map stays alive while other tabs are open; redraw at the right size when shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    map.resize();
    if (paddingRef.current && hasSize(map)) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0, ...paddingRef.current });
    if (!fitted.current && containerRef.current.clientHeight > 0) {
      fitted.current = true;
      // Room for floating panels is already set with setPadding, so only a small margin here.
      map.fitBounds(route.bounds, { padding: { top: 30, bottom: 30, left: 30, right: 30 }, animate: false });
    }
    applyLimits(map, route);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leave room for floating panels when centering the map. A hidden map
  // gets its padding when it is shown (see the effect above).
  useEffect(() => {
    const map = mapRef.current;
    if (!padding || !map || !hasSize(map)) return;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0, ...padding });
    if (map.loaded()) applyLimits(map, route);
  }, [padding?.top, padding?.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyActive(map, active) {
    for (const direction of Object.keys(route.legs)) {
      if (!map.getLayer(`leg-${direction}`)) continue;
      const dim = active && active !== direction;
      map.setPaintProperty(`leg-${direction}`, 'line-opacity', dim ? 0.3 : 1);
      map.setPaintProperty(`leg-${direction}-casing`, 'line-opacity', dim ? 0 : 1);
    }
    // Bring the active direction forward, but keep the violet guide on top.
    if (active && map.getLayer(`leg-${active}`)) map.moveLayer(`leg-${active}`, map.getLayer('guide-ride-casing') ? 'guide-ride-casing' : undefined);
  }

  function applyGuide(map, g) {
    if (map.getSource('guide-ride')) {
      map.getSource('guide-ride').setData(linesData(g?.rides));
      map.getSource('guide-walk').setData(linesData(g?.walks));
      map.getSource('guide-trike').setData(linesData(g?.trikes));
    }
    // Markers are matched by position in the list, so they move instead of flickering.
    const wanted = g?.markers ?? [];
    const have = guideMarkers.current;
    wanted.forEach((m, i) => {
      const key = `${i}:${m.kind}:${m.label}`;
      let marker = have[i];
      if (marker && marker.key !== key) { marker.remove(); marker = null; }
      if (!marker) {
        const el = makeEl(`guide-marker ${m.kind}`);
        el.append(makeEl('guide-label', m.label));
        marker = new maplibregl.Marker({ element: el }).setLngLat(m.point).addTo(map);
        marker.key = key;
        have[i] = marker;
      } else {
        marker.setLngLat(m.point);
      }
    });
    for (const i of Object.keys(have)) {
      if (+i >= wanted.length) { have[i].remove(); delete have[i]; }
    }
  }
  useEffect(() => {
    if (mapRef.current) applyGuide(mapRef.current, guide);
  }, [guide]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const src = mapRef.current?.getSource('community');
    if (src) src.setData(communityData(community));
  }, [community]);

  // Waiting passengers: a few markers, simply redrawn on each refresh.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of waitingMarkers.current) m.remove();
    waitingMarkers.current = (waiting ?? []).map((w) => {
      const el = makeEl(`waiting-marker${w.dim ? ' is-dim' : ''}`);
      el.innerHTML = WAITING_SVG;
      el.append(makeEl('waiting-count', String(w.people)));
      el.setAttribute('aria-label', `${w.people} waiting`);
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(w.point).addTo(map);
    });
  }, [waiting]);
  useEffect(() => {
    if (mapRef.current) applyActive(mapRef.current, activeDirection);
  }, [activeDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Landmarks on/off (the map's own small POIs come back when ours are off).
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('landmarks')) return;
    for (const id of LM_LAYERS) map.setLayoutProperty(id, 'visibility', showLandmarks ? 'visible' : 'none');
    setBasePois(map, !showLandmarks);
  }, [showLandmarks]);

  // Ring around the landmark whose card is open.
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource('landmark-selected');
    if (!src) return;
    const l = selectedLandmark && landmarks?.find((x) => x.id === selectedLandmark);
    src.setData(l ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: l.coord } } : EMPTY);
  }, [selectedLandmark, landmarks]);

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
        glide(marker, [j.lng, j.lat]);
      }
      const el = marker.getElement();
      fillJeepMarker(el, j);
      el.classList.toggle('is-dim', !!activeDirection && j.direction !== activeDirection);
    }
    for (const [id, marker] of jeepMarkers.current) {
      if (!seen.has(id)) {
        cancelAnimationFrame(marker.glideFrame);
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
    if (!dest) {
      destMarker.current?.remove();
      destMarker.current = null;
      return;
    }
    if (!destMarker.current) {
      const el = makeEl('dest-marker');
      el.append(makeEl('dest-pin'));
      destMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(dest).addTo(map);
    } else {
      destMarker.current.setLngLat(dest);
    }
  }, [dest]);

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
