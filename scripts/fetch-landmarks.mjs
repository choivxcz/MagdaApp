// Downloads the named landmarks along the jeepney route from OpenStreetMap
// (churches, plazas, schools, hospitals, malls, markets, terminals,
// restaurants, banks, shops...) into src/data/landmarks.json.
//
// Usage: npm run landmarks   (re-run any time to pick up OpenStreetMap edits)
//
// The app ships the saved file, so phones never have to ask OpenStreetMap
// for landmarks. Data © OpenStreetMap contributors (ODbL).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { prepareRoute, projectOnRoute } from '../src/lib/geo.js';

const CORRIDOR_M = 350; // landmarks this close to the route (either direction)
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const route = prepareRoute(JSON.parse(readFileSync(new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url), 'utf8')));

// What we keep, and how it shows on the map. `rank`: 0 = iconic (see
// ICONIC below, shown even zoomed out), 1 = big landmark, 2 = common
// destination, 3 = everyday spot (shown only when zoomed in).
const KINDS = [
  { cat: 'church', rank: 1, match: (t) => t.amenity === 'place_of_worship' },
  { cat: 'government', rank: 1, match: (t) => ['townhall', 'courthouse'].includes(t.amenity) || t.office === 'government' },
  { cat: 'school', rank: 1, match: (t) => ['school', 'college', 'university'].includes(t.amenity) },
  { cat: 'hospital', rank: 1, match: (t) => t.amenity === 'hospital' },
  { cat: 'mall', rank: 1, match: (t) => t.shop === 'mall' || t.shop === 'department_store' },
  { cat: 'market', rank: 1, match: (t) => t.amenity === 'marketplace' },
  { cat: 'terminal', rank: 1, match: (t) => t.amenity === 'bus_station' || t.public_transport === 'station' },
  { cat: 'park', rank: 1, match: (t) => ['park', 'square'].includes(t.leisure) || t.place === 'square' },
  { cat: 'monument', rank: 3, match: (t) => ['monument', 'memorial', 'church', 'building'].includes(t.historic) },
  { cat: 'health', rank: 2, match: (t) => ['clinic', 'doctors', 'pharmacy'].includes(t.amenity) },
  { cat: 'police', rank: 2, match: (t) => ['police', 'fire_station', 'post_office'].includes(t.amenity) },
  { cat: 'food', rank: 2, match: (t) => ['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream'].includes(t.amenity) },
  { cat: 'shop', rank: 2, match: (t) => ['supermarket', 'convenience', 'hardware', 'bakery', 'electronics', 'mobile_phone'].includes(t.shop) },
  { cat: 'bank', rank: 3, match: (t) => ['bank', 'atm', 'bureau_de_change'].includes(t.amenity) || t.shop === 'pawnbroker' },
  { cat: 'fuel', rank: 3, match: (t) => t.amenity === 'fuel' },
  { cat: 'hotel', rank: 3, match: (t) => ['hotel', 'motel', 'guest_house', 'resort'].includes(t.tourism) },
];

// Chains everyone uses as a meeting point get bumped up.
const WELL_KNOWN = /jollibee|mcdonald|chowking|mang inasal|greenwich|kfc|7-eleven|puregold|savemore|robinsons|mercury drug|watsons|bdo|landbank|metrobank|palawan|cebuana|petron|shell|caltex|town center/i;
// Only the big ones are "everyone knows it" landmarks; smaller offices,
// barangay halls and elementary schools come in when you zoom closer.
const MINOR = /barangay|pambarangay|bulwagang|brgy|elementary|learning center|montessori|montesorri|chapel|kapilya|office|board|division|employment|agrarian|nutrition|lokal ng|gsis|social security/i;
const JUNK = /^(\d+|name not visible|unnamed|n\/a|none)$/i;

// The landmarks everyone along this route knows: shown even when zoomed out.
const ICONIC = /cathedral|maulawin|mary magdalene|simbahan ng magdalena|provincial capitol of laguna|capitol fountain|santa cruz town hall|magdalena municipal hall|public market|dltb|pedro guevara memorial|town center mall|liwasang|circle plaza|immaculate conception parish|pagsanjan - calamba/i;

function rankOf(kind, name) {
  if (ICONIC.test(name)) return 0;
  if (WELL_KNOWN.test(`${name} `)) return Math.min(kind.rank, 2);
  if (kind.rank === 1 && MINOR.test(name)) return 2;
  return kind.rank;
}

// The route's box plus the corridor; places are then filtered by their
// real distance to the route (a box query is much lighter for the server).
function bbox() {
  const [[x1, y1], [x2, y2]] = route.bounds;
  const dLat = CORRIDOR_M / 110570;
  const dLng = CORRIDOR_M / (111320 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180));
  return [y1 - dLat, x1 - dLng, y2 + dLat, x2 + dLng].map((n) => n.toFixed(5)).join(',');
}

const KEYS = ['amenity', 'shop', 'leisure', 'historic', 'tourism', 'office', 'public_transport'];
const query = `[out:json][timeout:90][bbox:${bbox()}];
(
${KEYS.map((k) => `  nwr["name"]["${k}"];`).join('\n')}
  nwr["name"]["place"="square"];
);
out center tags;`;

async function overpass() {
  let lastError;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SakayLaguna-landmarks/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(120000),
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

// The raw answer is kept in node_modules/.cache, so the list can be
// re-sorted without asking OpenStreetMap again: npm run landmarks -- --cached
const CACHE = new URL('../node_modules/.cache/landmarks-raw.json', import.meta.url);
let data;
if (process.argv.includes('--cached') && existsSync(CACHE)) {
  console.log('Using the saved OpenStreetMap answer (--cached).');
  data = JSON.parse(readFileSync(CACHE, 'utf8'));
} else {
  console.log('Asking OpenStreetMap for landmarks along the route…');
  data = await overpass();
  mkdirSync(new URL('.', CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
}

const seen = new Map();
for (const el of data.elements) {
  const t = el.tags ?? {};
  const kind = KINDS.find((k) => k.match(t));
  if (!kind || !t.name || JUNK.test(t.name.trim()) || t.name.trim().length < 3) continue;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) continue;
  const coord = [+lng.toFixed(6), +lat.toFixed(6)];
  const off = Math.min(...Object.values(route.legs).map((leg) => projectOnRoute(leg, coord).offRoute));
  if (off > CORRIDOR_M) continue;
  const rank = rankOf(kind, t.name);
  const item = {
    id: `${el.type[0]}${el.id}`,
    name: t.name.trim().replace(/\bChuch\b/g, 'Church').replace(/\s+/g, ' '),
    cat: kind.cat,
    rank,
    coord,
    ...(t['addr:street'] ? { street: t['addr:street'] } : {}),
    off: Math.round(off),
  };
  // Same name and kind within 80 m (e.g. a building and its entrance): keep one.
  const key = `${item.name.toLowerCase()}|${item.cat}`;
  const dup = (seen.get(key) ?? []).find((o) => Math.hypot((o.coord[0] - coord[0]) * 107000, (o.coord[1] - coord[1]) * 110600) < 80);
  if (dup) continue;
  seen.set(key, [...(seen.get(key) ?? []), item]);
}

const list = [...seen.values()].flat().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
const out = {
  note: 'Named places within 350 m of the jeepney route. Data © OpenStreetMap contributors (ODbL). Refresh with: npm run landmarks',
  updated: new Date().toISOString().slice(0, 10),
  landmarks: list,
};
writeFileSync(new URL('../src/data/landmarks.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/},{/g, '},\n{')}\n`);
const byCat = {};
for (const l of list) byCat[l.cat] = (byCat[l.cat] ?? 0) + 1;
console.log(`Saved ${list.length} landmarks to src/data/landmarks.json`);
console.log(Object.entries(byCat).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
