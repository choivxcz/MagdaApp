// Landmarks along the route (from OpenStreetMap, saved by `npm run landmarks`):
// churches, plazas, schools, the capitol, markets, terminals, restaurants,
// shops... Riders use them to find places ("sa tapat ng Jollibee") and the
// app uses them to describe where to get on and off.
//
// No browser-only code: the AI server and the tests use this too. The data
// is passed in (makeLandmarks) so each side can load the JSON its own way.
import { distanceMeters, projectOnRoute } from './geo.js';
import { normalize } from './assistant/knowledge.js';
import { t } from './i18n.js';

// How each kind shows on the map. Colors are on the light map tiles.
export const LANDMARK_CATS = {
  church: { get label() { return t('Church'); }, icon: 'church', color: '#92400e' },
  government: { get label() { return t('Government'); }, icon: 'capitol', color: '#1d3557' },
  school: { get label() { return t('School'); }, icon: 'school', color: '#1e40af' },
  hospital: { get label() { return t('Hospital'); }, icon: 'hospital', color: '#dc2626' },
  health: { get label() { return t('Clinic / pharmacy'); }, icon: 'hospital', color: '#e11d48' },
  mall: { get label() { return t('Mall'); }, icon: 'shop', color: '#be185d' },
  market: { get label() { return t('Market'); }, icon: 'market', color: '#c2410c' },
  terminal: { get label() { return t('Terminal'); }, icon: 'terminal', color: '#374151' },
  park: { get label() { return t('Plaza / park'); }, icon: 'tree', color: '#15803d' },
  monument: { get label() { return t('Monument'); }, icon: 'monument', color: '#57534e' },
  food: { get label() { return t('Food'); }, icon: 'food', color: '#ea580c' },
  shop: { get label() { return t('Store'); }, icon: 'shop', color: '#0e7490' },
  bank: { get label() { return t('Bank / remittance'); }, icon: 'bank', color: '#4d7c0f' },
  police: { get label() { return t('Police / fire / post'); }, icon: 'shield', color: '#1e3a8a' },
  fuel: { get label() { return t('Gas station'); }, icon: 'fuel', color: '#6b7280' },
  hotel: { get label() { return t('Hotel'); }, icon: 'bed', color: '#7e22ce' },
};

export const RANK_LABEL = ['Landmark', 'Well-known place', 'Place', 'Place'];

export function makeLandmarks(data, route) {
  const list = (data?.landmarks ?? []).filter((l) => LANDMARK_CATS[l.cat]);
  const index = list.map((l) => ({ l, names: [normalize(l.name), normalize(l.street ?? '')] }));

  // Search: name starts with / has a word starting with / contains the text.
  function match(query, limit = 6) {
    const q = normalize(query);
    if (q.length < 2) return [];
    const scored = [];
    for (const { l, names } of index) {
      const [name, street] = names;
      const s = name.startsWith(q) ? 0 : name.split(' ').some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : street.includes(q) ? 4 : -1;
      if (s >= 0) scored.push({ l, s: s + l.rank * 0.5 });
    }
    return scored.sort((a, b) => a.s - b.s).slice(0, limit).map(({ l }) => place(l));
  }

  // The best-known landmark within `maxM` of a spot (for "by Jollibee").
  function near(point, { maxM = 80, maxRank = 2 } = {}) {
    let best = null;
    for (const l of list) {
      if (l.rank > maxRank) continue;
      const d = distanceMeters(point, l.coord);
      if (d > maxM) continue;
      const score = d + l.rank * 40; // a famous place a bit farther beats a small one next door
      if (!best || score < best.score) best = { l, d, score };
    }
    return best ? { ...best.l, meters: best.d } : null;
  }

  // As a place for the trip planner and search.
  function place(l) {
    const cat = LANDMARK_CATS[l.cat];
    const stop = route ? nearestStopName(route, l.coord) : null;
    return {
      kind: 'landmark',
      id: l.id,
      label: l.name,
      sub: [cat.label, l.street, stop ? `near ${stop}` : null].filter(Boolean).join(' · '),
      point: l.coord,
      icon: cat.icon,
      cat: l.cat,
      rank: l.rank,
    };
  }

  return { list, match, near, place };
}

function nearestStopName(route, point) {
  let best = null;
  for (const s of route.stops) {
    const d = distanceMeters(point, s.coord);
    if (d < 700 && (!best || d < best.d)) best = { s, d };
  }
  return best ? best.s.short ?? best.s.name : null;
}

// How far a landmark is from the jeepney route (meters), for its card.
export function offRoute(route, point) {
  return Math.min(...Object.values(route.legs).map((leg) => projectOnRoute(leg, point).offRoute));
}

// GeoJSON for the map layer.
export function landmarksGeoJSON(list) {
  return {
    type: 'FeatureCollection',
    features: list.map((l) => ({
      type: 'Feature',
      properties: { id: l.id, name: l.name, cat: l.cat, rank: l.rank, img: `lm-${l.cat}` },
      geometry: { type: 'Point', coordinates: l.coord },
    })),
  };
}
