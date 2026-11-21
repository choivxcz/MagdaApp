// Downloads EVERY named place around the jeepney route from OpenStreetMap
// into src/data/places.json, so riders can search any street, barangay,
// sitio, subdivision, store or office (not only big landmarks) and the app
// can name any spot tapped on the map ("Rizal St, Poblacion, Magdalena")
// without going online.
//
// It also finds the bridges the jeepney crosses and saves them in the route
// file, so the planner never says "get off" in the middle of a bridge.
//
// Usage: npm run places            (re-run to pick up OpenStreetMap edits)
//        npm run places -- --cached (re-build from the last download)
//
// Data © OpenStreetMap contributors (ODbL).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { prepareRoute, projectOnRoute, pointAlong } from '../src/lib/geo.js';
import { serviceBox } from '../src/lib/places.js';
import { ORIGIN, encodeLine } from '../src/lib/placeIndex.js';

const ROUTE_FILE = new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url);
const OUT = new URL('../src/data/places.json', import.meta.url);
const CACHE = new URL('../node_modules/.cache/places-raw.json', import.meta.url);
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const routeJson = JSON.parse(readFileSync(ROUTE_FILE, 'utf8'));
const route = prepareRoute({ ...routeJson, bridges: [] });
const [[minLng, minLat], [maxLng, maxLat]] = serviceBox(route);
const inArea = ([x, y]) => x >= minLng && x <= maxLng && y >= minLat && y <= maxLat;

const query = `[out:json][timeout:120][bbox:${[minLat, minLng, maxLat, maxLng].map((n) => n.toFixed(3)).join(',')}];
(
  way["highway"]["name"];
  nwr["place"]["name"];
  relation["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"];
  nwr["name"]["amenity"];
  nwr["name"]["shop"];
  nwr["name"]["tourism"];
  nwr["name"]["leisure"];
  nwr["name"]["office"];
  nwr["name"]["healthcare"];
  nwr["name"]["craft"];
  nwr["name"]["building"];
  nwr["name"]["landuse"="residential"];
  nwr["name"]["historic"];
  nwr["name"]["man_made"];
  nwr["name"]["natural"];
  way["bridge"="yes"]["highway"];
);
out geom;`;

async function overpass() {
  let lastError;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SakayLaguna-places/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      console.warn('  ', e.message, '- trying the next server…');
    }
  }
  throw lastError;
}

let data;
if (process.argv.includes('--cached') && existsSync(CACHE)) {
  console.log('Using the saved OpenStreetMap answer (--cached).');
  data = JSON.parse(readFileSync(CACHE, 'utf8'));
} else {
  console.log('Asking OpenStreetMap for every named place around the route (takes a minute)…');
  data = await overpass();
  mkdirSync(new URL('.', CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
}

// ---------- geometry helpers ----------
const M_LAT = 110574;
const M_LNG = 111320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const toXY = ([lng, lat]) => [lng * M_LNG, lat * M_LAT];
const geomOf = (g) => (g ?? []).map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]);

function segDist(p, a, b) {
  const [px, py] = toXY(p); const [ax, ay] = toXY(a); const [bx, by] = toXY(b);
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Douglas-Peucker in meters.
function simplify(line, tol) {
  if (line.length <= 2) return line;
  let worst = 0, at = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const d = segDist(line[i], line[0], line.at(-1));
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [line[0], line.at(-1)];
  return [...simplify(line.slice(0, at + 1), tol).slice(0, -1), ...simplify(line.slice(at), tol)];
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (p, rings) => rings.some((r) => inRing(p, r));

// Outer ways of a boundary relation joined into closed rings.
function ringsOf(rel) {
  const parts = (rel.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length).map((m) => geomOf(m.geometry));
  const same = (a, b) => Math.abs(a[0] - b[0]) < 2e-5 && Math.abs(a[1] - b[1]) < 2e-5;
  const rings = [];
  while (parts.length) {
    let ring = parts.shift();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (same(ring.at(-1), p[0])) ring = ring.concat(p.slice(1));
        else if (same(ring.at(-1), p.at(-1))) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const round5 = ([x, y]) => [+x.toFixed(5), +y.toFixed(5)];
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const JUNK = /^(\d+|name not visible|unnamed|n\/a|none|no name|-)$/i;
const keyName = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- towns and barangays ----------
const rels = data.elements.filter((e) => e.type === 'relation' && e.tags?.boundary === 'administrative');
const towns = rels.filter((r) => r.tags.admin_level === '6').map((r) => ({ name: clean(r.tags.name), rings: ringsOf(r) })).filter((t) => t.rings.length);
const townAt = (p) => towns.findIndex((t) => inPolygon(p, t.rings));

const placeNodes = data.elements.filter((e) => e.tags?.place && e.tags.name);
const barangays = [];
for (const r of rels.filter((x) => x.tags.admin_level === '10')) {
  const rings = ringsOf(r);
  if (!rings.length) continue;
  const name = clean(r.tags.name);
  // Label point: the barangay's place node if it has one, else the middle.
  const node = placeNodes.find((n) => keyName(n.tags.name) === keyName(name) && n.lat != null && inPolygon([n.lon, n.lat], rings));
  let label = node ? [node.lon, node.lat] : centroid(rings[0]);
  if (!inPolygon(label, rings)) label = rings[0][Math.floor(rings[0].length / 2)];
  const town = townAt(label);
  const simple = rings.map((ring) => simplify(ring, 12)).filter((ring) => ring.length >= 4);
  const box = simple.flat().reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
  if (box[2] < minLng || box[0] > maxLng || box[3] < minLat || box[1] > maxLat) continue;
  barangays.push({ name, town, label: round5(label), rings: simple, raw: rings });
}
const brgyAt = (p) => barangays.findIndex((b) => inPolygon(p, b.raw));
const usedTowns = new Map(); // town index in `towns` -> index in output
const townRef = (i) => {
  if (i < 0) return -1;
  if (!usedTowns.has(i)) usedTowns.set(i, usedTowns.size);
  return usedTowns.get(i);
};
for (const b of barangays) b.t = townRef(b.town);

// ---------- streets ----------
const ROAD_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'track', 'road', 'footway', 'path', 'steps', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const streetGroups = new Map();
for (const w of data.elements.filter((e) => e.type === 'way' && e.tags?.highway && e.tags.name)) {
  if (!ROAD_KINDS.has(w.tags.highway)) continue;
  const name = clean(w.tags.name);
  if (JUNK.test(name) || name.length < 3) continue;
  const line = geomOf(w.geometry);
  if (line.length < 2) continue;
  const mid = line[Math.floor(line.length / 2)];
  if (!line.some(inArea)) continue;
  const town = townAt(mid);
  const key = `${keyName(name)}|${town}`;
  const g = streetGroups.get(key) ?? { name, town, lines: [], brgys: new Map(), major: false };
  g.lines.push(line);
  g.major ||= ['trunk', 'primary', 'secondary'].includes(w.tags.highway);
  for (const p of [line[0], mid, line.at(-1)]) {
    const b = brgyAt(p);
    if (b >= 0) g.brgys.set(b, (g.brgys.get(b) ?? 0) + 1);
  }
  streetGroups.set(key, g);
}
const streets = [];
for (const g of streetGroups.values()) {
  const all = g.lines.flat();
  const c = centroid(all);
  // The street's own point nearest its middle (a point ON the street).
  const point = all.reduce((best, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best), all[0]);
  streets.push({
    n: g.name,
    t: townRef(g.town),
    b: [...g.brgys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i),
    p: round5(point),
    l: g.lines.map((l) => encodeLine(simplify(l, 6))),
    ...(g.major ? { m: 1 } : {}),
  });
}

// ---------- places: sitios, subdivisions, stores, offices... ----------
const SITIO = new Set(['hamlet', 'neighbourhood', 'isolated_dwelling', 'locality', 'city_block', 'quarter', 'suburb', 'village', 'allotments', 'farm', 'plot']);
const NICE = {
  place_of_worship: 'Church', fast_food: 'Fast food', restaurant: 'Restaurant', cafe: 'Café', school: 'School', college: 'College',
  university: 'University', kindergarten: 'Day care / kinder', hospital: 'Hospital', clinic: 'Clinic', doctors: 'Doctor', dentist: 'Dentist',
  pharmacy: 'Pharmacy', bank: 'Bank', atm: 'ATM', bureau_de_change: 'Money changer / remittance', pawnbroker: 'Pawnshop', fuel: 'Gas station',
  marketplace: 'Market', townhall: 'Town / barangay hall', courthouse: 'Court', police: 'Police', fire_station: 'Fire station',
  post_office: 'Post office', bus_station: 'Terminal', taxi: 'Tricycle / taxi stand', parking: 'Parking', community_centre: 'Covered court / hall',
  library: 'Library', social_facility: 'Social services', water_point: 'Water refilling', drinking_water: 'Drinking water',
  convenience: 'Convenience / sari-sari store', supermarket: 'Supermarket', mall: 'Mall', department_store: 'Department store',
  hardware: 'Hardware', bakery: 'Bakery', mobile_phone: 'Cellphone shop', electronics: 'Electronics', hairdresser: 'Barber / salon',
  beauty: 'Beauty salon', car_repair: 'Auto repair', motorcycle: 'Motorcycle shop', motorcycle_repair: 'Motorcycle repair', tyres: 'Vulcanizing / tires',
  clothes: 'Clothing store', general: 'General store', variety_store: 'Variety store', laundry: 'Laundry', butcher: 'Meat shop',
  hotel: 'Hotel', motel: 'Motel', guest_house: 'Guest house', resort: 'Resort', attraction: 'Tourist spot', viewpoint: 'Viewpoint',
  museum: 'Museum', park: 'Park', playground: 'Playground', pitch: 'Court / field', sports_centre: 'Sports center', stadium: 'Stadium',
  swimming_pool: 'Swimming pool', waterfall: 'Waterfall', peak: 'Mountain', spring: 'Spring', cemetery: 'Cemetery', grave_yard: 'Cemetery',
  government: 'Government office', company: 'Office', insurance: 'Insurance', lawyer: 'Law office', ngo: 'NGO', telecommunication: 'Telecom office',
  monument: 'Monument', memorial: 'Memorial', water_tower: 'Water tower', tower: 'Tower', bridge: 'Bridge', church: 'Church', chapel: 'Chapel',
  commercial: 'Commercial building', retail: 'Store', public: 'Public building', civic: 'Public building', apartments: 'Apartments', house: 'House',
  dormitory: 'Dormitory', warehouse: 'Warehouse', industrial: 'Factory', funeral_hall: 'Funeral home', funeral_directors: 'Funeral home',
  internet_cafe: 'Internet café', car_wash: 'Car wash', bar: 'Bar', pub: 'Bar', food_court: 'Food court', ice_cream: 'Ice cream',
};
const TYPE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'healthcare', 'office', 'craft', 'historic', 'man_made', 'natural', 'building'];
function typeOf(t) {
  for (const k of TYPE_KEYS) {
    const v = t[k];
    if (!v || v === 'yes') continue;
    if (NICE[v]) return NICE[v];
    const words = v.replace(/_/g, ' ');
    return `${words[0].toUpperCase()}${words.slice(1)}${k === 'shop' ? ' shop' : ''}`;
  }
  return t.building ? 'Building' : 'Place';
}

// Browse categories (same keys as the landmark layer, plus tourist spots).
function catOf(t, name) {
  if (/\b(toda|terminal|paradahan|tricycle stand)\b/i.test(name) || t.amenity === 'bus_station' || t.amenity === 'taxi' || t.public_transport === 'station') return 'terminal';
  if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'chapel') return 'church';
  if (['townhall', 'courthouse'].includes(t.amenity) || t.office === 'government') return 'government';
  if (['school', 'college', 'university', 'kindergarten'].includes(t.amenity)) return 'school';
  if (t.amenity === 'hospital') return 'hospital';
  if (['clinic', 'doctors', 'pharmacy', 'dentist'].includes(t.amenity) || t.healthcare) return 'health';
  if (t.shop === 'mall' || t.shop === 'department_store') return 'mall';
  if (t.amenity === 'marketplace') return 'market';
  if (['police', 'fire_station', 'post_office'].includes(t.amenity)) return 'police';
  if (['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream', 'bar', 'pub'].includes(t.amenity)) return 'food';
  if (['bank', 'atm', 'bureau_de_change'].includes(t.amenity) || t.shop === 'pawnbroker' || t.shop === 'money_lender') return 'bank';
  if (t.amenity === 'fuel') return 'fuel';
  if (['hotel', 'motel', 'guest_house', 'resort', 'hostel'].includes(t.tourism) || t.leisure === 'resort') return 'hotel';
  if (['attraction', 'viewpoint', 'museum', 'theme_park', 'zoo'].includes(t.tourism) || ['waterfall', 'peak', 'spring', 'cave_entrance'].includes(t.natural) || t.historic) return 'tourist';
  if (['park', 'square', 'playground', 'sports_centre', 'stadium', 'pitch'].includes(t.leisure)) return 'park';
  if (t.shop) return 'shop';
  return null;
}

const landmarkIds = new Set(JSON.parse(readFileSync(new URL('../src/data/landmarks.json', import.meta.url), 'utf8')).landmarks.filter((l) => l.rank <= 1).map((l) => l.id));
const brgyKeys = new Set(barangays.map((b) => keyName(b.name)));
const types = [];
const typeRef = (s) => { let i = types.indexOf(s); if (i < 0) { types.push(s); i = types.length - 1; } return i; };
const places = [];
const seen = new Map();
for (const e of data.elements) {
  const t = e.tags ?? {};
  if (!t.name || t.boundary === 'administrative' || (e.type === 'way' && t.highway)) continue;
  if (t.bridge === 'yes' && t.highway) continue;
  const name = clean(t.name);
  if (JUNK.test(name) || name.length < 3) continue;
  let point;
  if (e.lat != null) point = [e.lon, e.lat];
  else if (e.geometry?.length) point = centroid(geomOf(e.geometry));
  else if (e.bounds) point = [(e.bounds.minlon + e.bounds.maxlon) / 2, (e.bounds.minlat + e.bounds.maxlat) / 2];
  if (!point || !inArea(point)) continue;
  point = round5(point);
  let kind, cat = null, type = null;
  if (t.place) {
    if (t.place === 'town' || t.place === 'city' || t.place === 'municipality') kind = 'town';
    else if (SITIO.has(t.place)) {
      // Barangays come from their boundaries; their place nodes are only labels.
      if (brgyKeys.has(keyName(name)) && ['village', 'quarter', 'suburb'].includes(t.place)) continue;
      kind = /subd|village|homes|heights|ville|subdivision|compound|estate/i.test(name) ? 'subd' : 'sitio';
    } else continue;
  } else if (t.landuse === 'residential') {
    kind = 'subd';
  } else {
    kind = 'poi';
    cat = catOf(t, name);
    type = typeOf(t);
  }
  const id = `${e.type[0]}${e.id}`;
  // Same name within 120 m (a building and the shop inside it): keep one.
  const nk = keyName(name);
  const dup = (seen.get(nk) ?? []).find((o) => Math.hypot((o.p[0] - point[0]) * M_LNG, (o.p[1] - point[1]) * M_LAT) < 120);
  if (dup) { if (!dup.c && cat) dup.c = cat; continue; }
  const item = { i: id, n: name, k: kind, p: point, b: brgyAt(point), ...(cat ? { c: cat } : {}), ...(type ? { y: typeRef(type) } : {}), ...(landmarkIds.has(id) ? { r: 1 } : {}) };
  if (kind === 'town') item.t = townRef(townAt(point));
  seen.set(nk, [...(seen.get(nk) ?? []), item]);
  places.push(item);
}

// ---------- bridges the jeepney crosses ----------
const bridgeWays = data.elements.filter((e) => e.type === 'way' && e.tags?.bridge === 'yes' && e.tags.highway).map((w) => ({ name: clean(w.tags.name || ''), line: geomOf(w.geometry) }));
const bridges = [];
for (const leg of Object.values(route.legs)) {
  let start = null, name = '';
  for (let along = 0; along <= leg.length + 5; along += 5) {
    const p = pointAlong(leg, Math.min(along, leg.length));
    const hit = bridgeWays.find((b) => b.line.some((q, i) => i > 0 && segDist(p, b.line[i - 1], q) < 7));
    if (hit && start == null) { start = along; name = hit.name; }
    if ((!hit || along >= leg.length) && start != null) {
      if (along - start >= 10) {
        const ends = [round5(pointAlong(leg, start)), round5(pointAlong(leg, Math.min(along, leg.length)))];
        const dupe = bridges.some((b) => b.ends.some((x) => ends.some((y) => Math.hypot((x[0] - y[0]) * M_LNG, (x[1] - y[1]) * M_LAT) < 25)));
        if (!dupe) bridges.push({ name: name || 'Bridge', ends });
      }
      start = null;
    }
  }
}
writeFileSync(ROUTE_FILE, JSON.stringify({ ...routeJson, bridges }));

// ---------- write ----------
const townNames = [...usedTowns.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => towns[i].name);
const out = {
  note: 'Every named street, barangay, sitio and place around the jeepney route. Data © OpenStreetMap contributors (ODbL). Refresh with: npm run places',
  updated: new Date().toISOString().slice(0, 10),
  origin: ORIGIN,
  towns: townNames,
  types,
  barangays: barangays.map((b) => ({ n: b.name, t: b.t, p: b.label, r: b.rings.map(encodeLine) })),
  streets: streets.sort((a, b) => a.n.localeCompare(b.n)),
  places: places.sort((a, b) => a.n.localeCompare(b.n)),
};
const json = JSON.stringify(out);
writeFileSync(OUT, `${json}\n`);
const kinds = {};
for (const p of places) kinds[p.k] = (kinds[p.k] ?? 0) + 1;
console.log(`Saved ${barangays.length} barangays in ${townNames.length} towns, ${streets.length} streets and ${places.length} places (${JSON.stringify(kinds)}) to src/data/places.json (${(json.length / 1024).toFixed(0)} KB).`);
console.log(`Found ${bridges.length} bridge(s) on the jeepney route: ${bridges.map((b) => b.name).join(', ') || 'none'}.`);
