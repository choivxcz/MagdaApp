// Finding places: the route's stops (with the names people really use),
// and any other place via Photon, a free OpenStreetMap search service
// (photon.komoot.io, no key). Results are limited to the area the jeepneys
// and tricycles serve.
//
// No React or browser-only code here: the AI server uses it too.
import { normalize, ALIASES } from './assistant/knowledge.js';
import { distanceMeters } from './geo.js';

const PHOTON = 'https://photon.komoot.io';
export const SERVICE_KM = 6; // how far around the route we look for places

// The route's box, grown by `km` on every side: [[minLng, minLat], [maxLng, maxLat]].
export function serviceBox(route, km = SERVICE_KM) {
  const [[x1, y1], [x2, y2]] = route.bounds;
  const dLat = km / 110.57;
  const dLng = km / (111.32 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180));
  return [[x1 - dLng, y1 - dLat], [x2 + dLng, y2 + dLat]];
}

export const inBox = ([[x1, y1], [x2, y2]], [x, y]) => x >= x1 && x <= x2 && y >= y1 && y <= y2;

export const stopPlace = (s) => ({ kind: 'stop', stopId: s.id, label: s.name, sub: 'Jeepney stop', point: s.coord, icon: s.icon });

// Stops whose name, short name or common alias starts with (or contains) the text.
export function matchStops(route, query, limit = 6) {
  const q = normalize(query);
  if (!q) return route.stops.slice(0, limit).map(stopPlace);
  const scored = [];
  for (const s of route.stops) {
    const names = [normalize(s.name), normalize(s.short), ...(ALIASES[s.id] ?? [])];
    let best = Infinity;
    for (const n of names) {
      if (n.startsWith(q)) best = Math.min(best, 0);
      else if (n.split(' ').some((w) => w.startsWith(q))) best = Math.min(best, 1);
      else if (n.includes(q)) best = Math.min(best, 2);
    }
    if (best < Infinity) scored.push({ s, best });
  }
  return scored.sort((a, b) => a.best - b.best).slice(0, limit).map(({ s }) => stopPlace(s));
}

function photonLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.district || p.locality || p.city || 'Unnamed place';
  const area = [p.name && street !== name ? street : null, p.locality || p.district, p.city]
    .filter((x, i, arr) => x && x !== name && arr.indexOf(x) === i);
  return { label: name, sub: area.join(', ') };
}

function fromFeature(f) {
  const p = f.properties ?? {};
  const { label, sub } = photonLabel(p);
  return {
    kind: 'place',
    id: `${p.osm_type ?? ''}${p.osm_id ?? ''}`,
    label,
    sub,
    point: f.geometry.coordinates.map((n) => +n.toFixed(6)),
    category: p.osm_value ?? null,
  };
}

// Places matching the text, nearest to `near` first. Throws on network errors.
export async function searchPlaces(query, { box, near, limit = 8, signal, headers } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: String(limit + 4) });
  if (near) { params.set('lon', near[0].toFixed(4)); params.set('lat', near[1].toFixed(4)); }
  if (box) params.set('bbox', box.flat().map((n) => n.toFixed(4)).join(','));
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal, headers });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  const seen = new Set();
  return (data.features ?? [])
    .filter((f) => f.geometry?.type === 'Point')
    .map(fromFeature)
    .filter((p) => (!box || inBox(box, p.point)))
    .filter((p) => {
      const key = `${p.label}|${p.point.map((n) => n.toFixed(3)).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

// A short name for a tapped spot ("near Jollibee, Pedro Guevarra Ave"), or null.
export async function nameForPoint(point, { signal } = {}) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lon=${point[0].toFixed(6)}&lat=${point[1].toFixed(6)}&limit=1`, { signal });
    if (!res.ok) return null;
    const f = (await res.json()).features?.[0];
    if (!f) return null;
    const p = f.properties ?? {};
    const far = distanceMeters(point, f.geometry.coordinates) > 60;
    const name = p.name && !far ? p.name : p.street || p.name;
    const area = p.locality || p.district || p.city;
    if (!name) return area ?? null;
    return `${far || !p.name ? 'Near ' : ''}${name}${area && area !== name ? `, ${area}` : ''}`;
  } catch {
    return null;
  }
}

// Debounced search with stale answers ignored. onResult(list | null, error).
export function makeSearcher(delay = 350) {
  let timer = null;
  let ctl = null;
  return (query, opts, onResult) => {
    clearTimeout(timer);
    ctl?.abort();
    if (String(query ?? '').trim().length < 3) { onResult([], null); return; }
    timer = setTimeout(async () => {
      ctl = new AbortController();
      const mine = ctl;
      try {
        const list = await searchPlaces(query, { ...opts, signal: mine.signal });
        if (!mine.signal.aborted) onResult(list, null);
      } catch (e) {
        if (!mine.signal.aborted) onResult(null, e);
      }
    }, delay);
  };
}
