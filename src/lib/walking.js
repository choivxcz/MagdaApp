// Walking directions to the sakayan, always along real streets and paths.
// Two free OpenStreetMap walking services are asked at the same time and the
// first good answer wins (one of them is sometimes slow); a road router is
// the last resort. If none answers, we return null: the app then shows no
// line at all rather than a straight shortcut across fields and houses.

const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot';
const VALHALLA = 'https://valhalla1.openstreetmap.de';
const OSRM_ROAD = 'https://router.project-osrm.org';
const WALK_MPS = 1.3; // ~4.7 km/h
const TIMEOUT_MS = 12000;
const cache = new Map();

export const walkMinutes = (meters) => Math.max(1, Math.round(meters / WALK_MPS / 60));

const ll = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const vLoc = (p) => ({ lon: +p[0].toFixed(6), lat: +p[1].toFixed(6) });

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Valhalla sends the path as an "encoded polyline" with 6 decimals.
function decodePolyline6(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}

async function osrmRoute(base, profile, from, to, signal) {
  const data = await getJson(`${base}/route/v1/${profile}/${ll(from)};${ll(to)}?overview=full&geometries=geojson&steps=false&alternatives=false`, signal);
  const r = data?.routes?.[0];
  if (data.code !== 'Ok' || !r) throw new Error('no route');
  return { coords: r.geometry.coordinates, meters: r.distance };
}

async function valhallaRoute(from, to, signal) {
  const q = { locations: [vLoc(from), vLoc(to)], costing: 'pedestrian', directions_type: 'none' };
  const data = await getJson(`${VALHALLA}/route?json=${encodeURIComponent(JSON.stringify(q))}`, signal);
  const leg = data?.trip?.legs?.[0];
  if (!leg?.shape) throw new Error('no route');
  return { coords: decodePolyline6(leg.shape), meters: data.trip.summary.length * 1000 };
}

// First answer that succeeds; null if all fail or time runs out.
async function firstOk(tasks) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await Promise.any(tasks.map((t) => t(ctl.signal)));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ctl.abort(); // stop the slower request
  }
}

// Returns { coords, meters } following streets, or null if no service answered.
export async function walkingPath(from, to) {
  const key = ll(from) + ';' + ll(to);
  if (cache.has(key)) return cache.get(key);

  let r = await firstOk([
    (s) => osrmRoute(OSRM_FOOT, 'foot', from, to, s),
    (s) => valhallaRoute(from, to, s),
  ]);
  // Both walking services down: follow the road network instead.
  if (!r) r = await firstOk([(s) => osrmRoute(OSRM_ROAD, 'driving', from, to, s)]);
  if (!r) return null;

  // The services start and end on the nearest street; add the few steps from
  // the exact spot to that street, and from it to the sakayan.
  const result = { coords: [from, ...r.coords, to], meters: r.meters };
  if (cache.size > 50) cache.clear();
  cache.set(key, result);
  return result;
}

// Which of several spots is the shortest walk from `from` (one request per
// service, same race). Returns its index, or null if no service answered.
export async function fastestOf(from, points) {
  const pick = (dists) => {
    let best = null;
    dists.forEach((d, j) => { if (d != null && (best == null || d < dists[best])) best = j; });
    if (best == null) throw new Error('no distances');
    return best;
  };
  return firstOk([
    async (s) => {
      const data = await getJson(`${OSRM_FOOT}/table/v1/foot/${[from, ...points].map(ll).join(';')}?sources=0&annotations=distance`, s);
      if (data.code !== 'Ok') throw new Error('no table');
      return pick(data.distances[0].slice(1));
    },
    async (s) => {
      const q = { sources: [vLoc(from)], targets: points.map(vLoc), costing: 'pedestrian' };
      const data = await getJson(`${VALHALLA}/sources_to_targets?json=${encodeURIComponent(JSON.stringify(q))}`, s);
      return pick(data.sources_to_targets[0].map((c) => c.distance));
    },
  ]);
}
