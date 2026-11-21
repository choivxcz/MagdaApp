// Every street, barangay, sitio, subdivision and named place around the
// jeepney route (src/data/places.json, made by `npm run places`).
//
// - search("rizal st") finds streets, barangays, stores, offices... offline
//   and instantly, with no load used.
// - browse('school') lists one kind of place, nearest first.
// - reverse(point) names any spot ("Rizal St, Poblacion, Magdalena").
//
// Pure functions, no browser APIs: the app, the AI server and the tests use
// the same code. The data is passed in so each side loads it its own way.
import { distanceMeters } from './geo.js';

// Lines are stored as whole numbers (1e-5 degrees, about 1 m) relative to
// this corner, each point as the change from the one before: much smaller.
export const ORIGIN = [12130000, 1410000];

export function encodeLine(coords) {
  const out = [];
  let px = 0, py = 0;
  coords.forEach(([lng, lat], i) => {
    const x = Math.round(lng * 1e5) - ORIGIN[0];
    const y = Math.round(lat * 1e5) - ORIGIN[1];
    out.push(i ? x - px : x, i ? y - py : y);
    px = x; py = y;
  });
  return out;
}

export function decodeLine(flat, origin = ORIGIN) {
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x = i ? x + flat[i] : flat[i];
    y = i ? y + flat[i + 1] : flat[i + 1];
    out.push([(x + origin[0]) / 1e5, (y + origin[1]) / 1e5]);
  }
  return out;
}

// Words people shorten when they type.
const ABBR = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road', hwy: 'highway', natl: 'national', nat: 'national',
  brgy: 'barangay', bgy: 'barangay', bo: 'barrio', sto: 'santo', sta: 'santa', gen: 'general', subd: 'subdivision',
  ext: 'extension', hosp: 'hospital', elem: 'elementary', mun: 'municipal', mt: 'mount', cor: 'corner', pob: 'poblacion',
  ctr: 'center', centre: 'center', bldg: 'building', jr: 'junior', sr: 'senior', dr: 'doctor', prov: 'provincial', ofc: 'office',
};
const SKIP = new Set(['the', 'of', 'sa', 'ng', 'in', 'at']);

export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w);
}

// One letter wrong, missing or extra ("guevara" for "guevarra").
function nearlySame(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// How well one typed word matches a name's words: 0 best, null = no match.
function wordScore(q, words) {
  let best = null;
  words.forEach((w, i) => {
    let s = null;
    if (w === q) s = i === 0 ? 0 : 0.3;
    else if (w.startsWith(q)) s = i === 0 ? 0.2 : 0.5;
    else if (q.length >= 5 && (nearlySame(q, w) || nearlySame(q, w.slice(0, q.length)))) s = 1.2;
    if (s != null && (best == null || s < best)) best = s;
  });
  return best;
}

export const KIND_LABEL = { street: 'Street', barangay: 'Barangay', town: 'Town', sitio: 'Sitio / purok', subd: 'Subdivision / village', poi: 'Place' };
const KIND_ICON = { street: 'road', barangay: 'area', town: 'capitol', sitio: 'house', subd: 'house', poi: 'pin' };
const KIND_WEIGHT = { town: 0, barangay: 0.25, street: 0.6, subd: 0.6, sitio: 0.6, poi: 0.9 };

// The browse buttons, and which icon each kind of place gets.
export const BROWSE = {
  mall: { label: 'Malls & stores', short: 'Malls', icon: 'shop', cats: ['mall', 'shop'] },
  school: { label: 'Schools', icon: 'school', cats: ['school'] },
  market: { label: 'Markets', icon: 'market', cats: ['market'] },
  hospital: { label: 'Hospitals & clinics', short: 'Hospitals', icon: 'hospital', cats: ['hospital', 'health'] },
  terminal: { label: 'Terminals', icon: 'terminal', cats: ['terminal'] },
  government: { label: 'Government', icon: 'capitol', cats: ['government', 'police'] },
  church: { label: 'Churches', icon: 'church', cats: ['church'] },
  food: { label: 'Food', icon: 'food', cats: ['food'] },
  bank: { label: 'Banks & remittance', short: 'Banks', icon: 'bank', cats: ['bank'] },
  tourist: { label: 'Tourist spots & resorts', short: 'Tourist spots', icon: 'tree', cats: ['tourist', 'hotel', 'park'] },
  fuel: { label: 'Gas stations', short: 'Gas', icon: 'fuel', cats: ['fuel'] },
};
// Shown on the map unless the rider picks others (More → Preferences).
export const DEFAULT_SHORTCUTS = ['mall', 'school', 'hospital', 'market'];

const CAT_ICON = {
  church: 'church', government: 'capitol', school: 'school', hospital: 'hospital', health: 'hospital', mall: 'shop', market: 'market',
  terminal: 'terminal', park: 'tree', monument: 'monument', food: 'food', shop: 'shop', bank: 'bank', police: 'shield', fuel: 'fuel',
  hotel: 'bed', tourist: 'tree',
};

// Words that say what KIND of place it is ("brgy bucal", "purok 5").
const KIND_WORDS = {
  barangay: ['barangay', 'barrio'], street: ['street', 'road', 'kalye', 'daan'], sitio: ['sitio', 'purok', 'zone'],
  subd: ['subdivision', 'village', 'homes'], town: ['town', 'bayan', 'municipality'], poi: [],
};
// "Laguna State Polytechnic University" -> "lspu".
function initials(name) {
  const w = String(name).split(/[\s-]+/).filter((x) => /^[A-Z]/.test(x) && !/^(Of|And|The|Ng|Sa)$/i.test(x));
  return w.length >= 3 ? [w.map((x) => x[0]).join('').toLowerCase()] : [];
}

const brgyName = (n) => (/^(barangay|brgy|poblacion)\b/i.test(n) ? n : `Brgy. ${n}`);

export function makePlaceIndex(data) {
  const origin = data?.origin ?? ORIGIN;
  const towns = data?.towns ?? [];
  const types = data?.types ?? [];
  const barangays = (data?.barangays ?? []).map((b, i) => ({ ...b, i }));
  const townOf = (t) => towns[t] ?? '';
  const areaText = (bIdx, extra = []) => {
    const bs = [].concat(bIdx).filter((i) => i != null && i >= 0).map((i) => barangays[i]).filter(Boolean);
    if (!bs.length) return '';
    const town = townOf(bs[0].t);
    return [bs.slice(0, 2).map((b) => b.n).join(' / '), ...extra, town].filter(Boolean).join(', ');
  };

  // Everything searchable, with its words worked out once.
  const entries = [];
  barangays.forEach((b) => entries.push({
    kind: 'barangay', id: `brgy:${b.i}`, name: b.n, point: b.p,
    words: tokens(b.n), context: [...tokens(townOf(b.t)), ...KIND_WORDS.barangay], sub: `${KIND_LABEL.barangay} · ${townOf(b.t)}`, weight: KIND_WEIGHT.barangay,
  }));
  (data?.streets ?? []).forEach((s, i) => entries.push({
    kind: 'street', id: `street:${i}`, name: s.n, point: s.p, street: s,
    words: tokens(s.n), context: [...s.b.flatMap((b) => tokens(barangays[b]?.n)), ...tokens(townOf(s.t)), ...KIND_WORDS.street],
    sub: [KIND_LABEL.street, areaText(s.b) || townOf(s.t)].filter(Boolean).join(' · '), weight: KIND_WEIGHT.street - (s.m ? 0.2 : 0),
  }));
  (data?.places ?? []).forEach((p) => {
    const type = p.y != null ? types[p.y] : null;
    const area = p.k === 'town' ? 'Laguna' : areaText(p.b);
    entries.push({
      kind: p.k, id: p.i, name: p.n, point: p.p, cat: p.c ?? null, type,
      words: [...tokens(p.n), ...initials(p.n)], context: [...(KIND_WORDS[p.k] ?? []), ...(type ? tokens(type) : []), ...(p.b >= 0 ? tokens(barangays[p.b]?.n) : []), ...(p.b >= 0 ? tokens(townOf(barangays[p.b]?.t)) : [])],
      sub: [p.k === 'poi' ? type ?? KIND_LABEL.poi : KIND_LABEL[p.k], area].filter(Boolean).join(' · '),
      weight: (KIND_WEIGHT[p.k] ?? 1) - (p.r ? 0.5 : 0) - (p.c ? 0.1 : 0),
    });
  });

  const toPlace = (e, near) => ({
    kind: 'place',
    placeType: e.kind,
    id: e.id,
    label: e.name,
    sub: near ? `${e.sub} · ${fmtKm(distanceMeters(near, e.point))}` : e.sub,
    point: e.point,
    icon: e.cat ? CAT_ICON[e.cat] ?? 'pin' : KIND_ICON[e.kind] ?? 'pin',
    cat: e.cat ?? null,
  });

  function search(query, { near = null, limit = 8 } = {}) {
    const q = tokens(query).filter((w) => !SKIP.has(w));
    if (!q.length || q.join('').length < 2) return [];
    const whole = q.join(' ');
    const scored = [];
    for (const e of entries) {
      let total = 0;
      let ok = true;
      let inName = 0;
      for (const w of q) {
        const s = wordScore(w, e.words);
        if (s != null) { total += s; inName++; continue; }
        const c = wordScore(w, e.context); // "rizal magdalena", "jollibee pagsanjan"
        if (c != null) { total += c + 0.8; continue; }
        ok = false;
        break;
      }
      if (!ok || !inName) continue;
      if (e.words.join(' ').startsWith(whole)) total -= 0.6;
      const km = near ? distanceMeters(near, e.point) / 1000 : 0;
      scored.push({ e, s: total + e.weight + Math.min(1.5, km * 0.12) });
    }
    scored.sort((a, b) => a.s - b.s);
    const out = [];
    const seen = new Set();
    for (const { e } of scored) {
      const k = `${e.name.toLowerCase()}|${e.sub}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(toPlace(e, null));
      if (out.length >= limit) break;
    }
    return out;
  }

  // Places of one browse group, nearest first.
  function browse(group, { near = null, limit = 40 } = {}) {
    const cats = BROWSE[group]?.cats ?? [group];
    const list = entries.filter((e) => e.cat && cats.includes(e.cat));
    if (near) list.sort((a, b) => distanceMeters(near, a.point) - distanceMeters(near, b.point));
    else list.sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));
    return list.slice(0, limit).map((e) => toPlace(e, near));
  }

  // ----- naming a spot -----
  let decoded = null;
  function shapes() {
    if (decoded) return decoded;
    const box = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
    decoded = {
      barangays: barangays.map((b) => {
        const rings = b.r.map((r) => decodeLine(r, origin));
        return { b, rings, box: box(rings.flat()) };
      }),
      streets: (data?.streets ?? []).map((s) => {
        const lines = s.l.map((l) => decodeLine(l, origin));
        return { s, lines, box: box(lines.flat()) };
      }),
      pois: entries.filter((e) => e.kind === 'poi'),
    };
    return decoded;
  }

  function barangayAt(point) {
    const [x, y] = point;
    for (const { b, rings, box } of shapes().barangays) {
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
      if (rings.some((r) => inRing(point, r))) return { name: b.n, town: townOf(b.t), label: brgyName(b.n) };
    }
    return null;
  }

  function nearestStreet(point, maxM = 40) {
    const pad = maxM / 100000;
    let best = null;
    for (const { s, lines, box } of shapes().streets) {
      if (point[0] < box[0] - pad || point[0] > box[2] + pad || point[1] < box[1] - pad || point[1] > box[3] + pad) continue;
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const d = segmentMeters(point, line[i - 1], line[i]);
          if (d <= maxM && (!best || d < best.meters)) best = { name: s.n, meters: d };
        }
      }
    }
    return best;
  }

  function nearestPlace(point, maxM = 35) {
    let best = null;
    for (const e of shapes().pois) {
      if (Math.abs(e.point[1] - point[1]) > 0.001 || Math.abs(e.point[0] - point[0]) > 0.001) continue;
      const d = distanceMeters(point, e.point) + e.weight * 10; // a well-known place a bit farther wins
      if (d <= maxM + 10 && (!best || d < best.score)) best = { name: e.name, meters: distanceMeters(point, e.point), score: d };
    }
    return best;
  }

  // { label, street, place, barangay, town } or null when we know nothing there.
  function reverse(point) {
    const brgy = barangayAt(point);
    const street = nearestStreet(point);
    const place = nearestPlace(point);
    const area = brgy ? `${brgy.name}${brgy.town ? `, ${brgy.town}` : ''}` : '';
    let label = null;
    if (place && place.meters <= 30) label = `Near ${place.name}${street ? `, ${street.name}` : brgy ? `, ${brgy.name}` : ''}`;
    else if (street) label = `${street.name}${area ? `, ${area}` : ''}`;
    else if (brgy) label = `${brgy.label}${brgy.town ? `, ${brgy.town}` : ''}`;
    return label ? { label, street: street?.name ?? null, place: place?.name ?? null, barangay: brgy?.name ?? null, town: brgy?.town ?? null } : null;
  }

  return {
    search, browse, reverse, barangayAt, nearestStreet,
    size: { barangays: barangays.length, streets: data?.streets?.length ?? 0, places: data?.places?.length ?? 0 },
  };
}

export const fmtKm = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentMeters(p, a, b) {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * 110574;
  const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * 110574;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
