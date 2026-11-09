// Facts the assistant can look up: stops, trips, fares and live jeepneys.
// Used by the AI (on the server) and by the offline answerer (on the phone),
// so both always give the same fares and times as the map.
// Keep this file free of browser-only code: the server imports it too.
import { projectOnRoute } from '../geo.js';
import { computeFare, FARE_RULES, peso } from '../fare.js';
import { DIRECTIONS, seatStatus } from '../directions.js';

export const AVG_SPEED_MPS = 20 / 3.6; // ~20 km/h with stops, same as the map
const MIN_RIDE_M = 100;
const STALE_MS = 2 * 60 * 1000;

// Extra names people use for each stop (English, Tagalog, short forms).
const ALIASES = {
  'magdalena-plaza': ['magdalena plaza', 'magdalena terminal', 'bayan ng magdalena', 'magdalena', 'magda'],
  buenavista: ['buenavista', 'buena vista'],
  cigaras: ['cigaras'],
  buboy: ['buboy'],
  cabanbanan: ['cabanbanan'],
  sabang: ['sabang'],
  areza: ['areza'],
  binan: ['binan'],
  lli: ['lli bus terminal', 'lli terminal', 'lli'],
  hm: ['hm transport', 'hm terminal', 'hm'],
  dltb: ['dltb terminal', 'dltb'],
  capitol: ['provincial capitol', 'kapitolyo', 'capitolyo', 'kapitol', 'capitol'],
  pgmnhs: ['pedro guevara memorial', 'pedro guevarra memorial', 'pgmnhs', 'pedro guevara nhs', 'pedro guevara school', 'pgm'],
  'public-market': ['santa cruz public market', 'public market', 'palengke', 'pamilihan', 'merkado', 'market'],
  'santa-cruz-plaza': ['santa cruz plaza', 'sta cruz plaza', 'santa cruz', 'sta cruz', 'stacruz', 'sta cruz bayan'],
};

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // ñ -> n, é -> e
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function aliasTable(route) {
  const rows = [];
  for (const s of route.stops) {
    const names = new Set([...(ALIASES[s.id] ?? []), normalize(s.name), normalize(s.short), normalize(s.id)]);
    for (const n of names) if (n) rows.push({ alias: n, stop: s });
  }
  return rows.sort((a, b) => b.alias.length - a.alias.length); // longest first
}

// Every stop mentioned in the text, in the order they appear.
export function findStopsInText(route, text) {
  let hay = ` ${normalize(text)} `;
  const found = [];
  for (const { alias, stop } of aliasTable(route)) {
    const needle = ` ${alias} `;
    let i = hay.indexOf(needle);
    while (i !== -1) {
      found.push({ stop, index: i });
      // Blank out the match so a shorter alias ("santa cruz") can't match inside it.
      hay = hay.slice(0, i + 1) + '#'.repeat(alias.length) + hay.slice(i + 1 + alias.length);
      i = hay.indexOf(needle);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// One stop from a name, id or loose description ("sta cruz", "palengke").
export function findStop(route, name) {
  if (!name) return null;
  const byId = route.stops.find((s) => s.id === name);
  if (byId) return byId;
  return findStopsInText(route, name)[0]?.stop ?? null;
}

const minutesFor = (meters) => Math.max(1, Math.round(meters / AVG_SPEED_MPS / 60));

// Which direction connects two stops, how far, how long and how much.
export function planTrip(route, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return null;
  let best = null;
  for (const [direction, leg] of Object.entries(route.legs)) {
    const from = leg.stops.find((s) => s.id === fromId);
    const to = leg.stops.find((s) => s.id === toId);
    if (!from || !to) continue;
    const dist = to.along - from.along;
    if (dist < MIN_RIDE_M) continue;
    if (!best || dist < best.dist) best = { direction, leg, from, to, dist };
  }
  if (!best) return null;
  const fare = computeFare(best.dist);
  return {
    direction: best.direction,
    directionLabel: DIRECTIONS[best.direction].label,
    from: best.from,
    to: best.to,
    km: Math.round(fare.km * 10) / 10,
    rideMinutes: minutesFor(best.dist),
    fareRegular: fare.regular,
    fareDiscounted: fare.discounted,
    along: best.from.along,
    leg: best.leg,
  };
}

// Live jeepneys with their direction, free seats and the stop they last passed.
export function describeJeepneys(route, jeepneys, now = Date.now()) {
  return (jeepneys ?? [])
    .filter((j) => DIRECTIONS[j.direction] && Number.isFinite(j.lat) && Number.isFinite(j.lng))
    .filter((j) => !j.updatedAt || now - new Date(j.updatedAt).getTime() < STALE_MS)
    .map((j) => {
      const leg = route.legs[j.direction];
      const along = projectOnRoute(leg, [j.lng, j.lat]).along;
      const passed = [...leg.stops].reverse().find((s) => s.along <= along + 50);
      const coming = leg.stops.find((s) => s.along > along + 50);
      const seats = seatStatus(j);
      return {
        plate: j.plate,
        direction: j.direction,
        directionLabel: DIRECTIONS[j.direction].label,
        along,
        near: passed?.short ?? passed?.name ?? leg.from,
        nextStop: coming?.short ?? coming?.name ?? null,
        seatsFree: seats.level === 'unknown' ? null : seats.free,
        full: seats.level === 'full',
        seatsText: seats.text,
      };
    });
}

// Jeepneys still coming to a pickup point on one leg, nearest first.
export function jeepsComingTo(route, jeepneys, direction, along, now) {
  return describeJeepneys(route, jeepneys, now)
    .filter((j) => j.direction === direction)
    .map((j) => ({ ...j, gapM: along - j.along }))
    .filter((j) => j.gapM >= -50)
    .sort((a, b) => a.gapM - b.gapM)
    .map((j) => ({ ...j, etaMinutes: j.gapM <= 100 ? 0 : minutesFor(j.gapM) }));
}

export function stopsText(route) {
  return Object.entries(route.legs)
    .map(([d, leg]) => `${DIRECTIONS[d].label} (via ${leg.via}): ${leg.stops.map((s) => `${s.name} [${(s.along / 1000).toFixed(1)} km]`).join(' → ')}`)
    .join('\n');
}

export function fareRulesText() {
  const r = FARE_RULES;
  return `${peso(r.base)} for the first ${r.baseKm} km, plus ${peso(r.perKm)} per km after that. Students, seniors and PWD get ${Math.round(r.discount * 100)}% off. (${r.source})`;
}

export { peso, FARE_RULES, DIRECTIONS };
