// Every street & place search, naming a tapped spot, bridges, sharing a
// trip, weather, and the Community helpers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePlaceIndex, encodeLine, decodeLine, tokens } from '../src/lib/placeIndex.js';
import { prepareRoute, projectOnRoute, distanceMeters } from '../src/lib/geo.js';
import { networkFromRoutes, planJourneys, onBridge } from '../src/lib/planner.js';
import { tripLink, parseTripLink } from '../src/lib/share.js';
import { parseWeather, describeWeather } from '../src/lib/weather.js';
import { terminalNear, fareText, targetOf } from '../src/lib/communityPosts.js';

const data = JSON.parse(readFileSync(new URL('../src/data/places.json', import.meta.url), 'utf8'));
const route = prepareRoute(JSON.parse(readFileSync(new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url), 'utf8')));
const places = makePlaceIndex(data);
const MAGDALENA = [121.4295, 14.2005];

describe('the place list on the phone', () => {
  it('stores lines compactly and reads them back to about 1 m', () => {
    const line = [[121.43123, 14.20045], [121.43199, 14.20101], [121.42001, 14.2611]];
    decodeLine(encodeLine(line)).forEach((p, i) => expect(distanceMeters(p, line[i])).toBeLessThan(1.5));
  });

  it('has the barangays, streets and places around the route', () => {
    expect(places.size.barangays).toBeGreaterThan(50);
    expect(places.size.streets).toBeGreaterThan(150);
    expect(places.size.places).toBeGreaterThan(1000);
  });

  it('understands short forms people type', () => {
    expect(tokens('Brgy. Sta. Cruz, Rizal St.')).toEqual(['barangay', 'santa', 'cruz', 'rizal', 'street']);
  });
});

describe('searching any place, even streets', () => {
  it('finds streets by name, with their barangay and town', () => {
    const r = places.search('rizal st', { near: MAGDALENA });
    expect(r.length).toBeGreaterThan(2);
    expect(r[0].placeType).toBe('street');
    expect(r[0].label).toMatch(/rizal/i);
    expect(r[0].sub).toMatch(/Magdalena/);
  });

  it('finds barangays, also when typed with "brgy"', () => {
    const r = places.search('brgy bucal', { near: MAGDALENA });
    expect(r[0]).toMatchObject({ placeType: 'barangay', label: 'Bucal' });
    expect(r[0].sub).toMatch(/Magdalena/);
  });

  it('narrows by town ("jollibee pagsanjan")', () => {
    const r = places.search('jollibee pagsanjan');
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(p.sub).toMatch(/Pagsanjan/);
  });

  it('finds schools by their initials and forgives one wrong letter', () => {
    expect(places.search('lspu').some((p) => /Laguna State Polytechnic University/.test(p.label))).toBe(true);
    expect(places.search('pedro guevara').some((p) => p.label === 'Pedro Guevarra Avenue')).toBe(true);
  });

  it('lists one kind of place nearest first', () => {
    const r = places.browse('school', { near: MAGDALENA, limit: 10 });
    expect(r.length).toBe(10);
    const d = r.map((p) => distanceMeters(MAGDALENA, p.point));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('returns nothing for nonsense', () => {
    expect(places.search('zzqxw')).toEqual([]);
  });
});

describe('naming a spot tapped on the map, without going online', () => {
  it('knows the barangay and town of any spot', () => {
    const r = places.reverse(MAGDALENA);
    expect(r.barangay).toBeTruthy();
    expect(r.town).toBe('Magdalena');
    expect(r.label).toBeTruthy();
  });

  it('names the street when the spot is on one', () => {
    const rizal = data.streets.find((s) => s.n === 'Jose P. Rizal Street');
    // The middle of its longest piece (not a corner, where two streets meet).
    const line = decodeLine(rizal.l[0], data.origin);
    let best = [line[0], line[1]];
    for (let i = 1; i < line.length; i++) if (distanceMeters(line[i - 1], line[i]) > distanceMeters(...best)) best = [line[i - 1], line[i]];
    const mid = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2];
    const r = places.reverse(mid);
    expect(r.street).toBe('Jose P. Rizal Street');
    expect(r.label).toMatch(/Rizal|Near/);
  });

  it('is quiet far outside the area', () => {
    expect(places.reverse([120.9, 14.6])).toBeNull();
  });
});

describe('no getting on or off on a bridge', () => {
  const legs = Object.values(route.legs).filter((l) => l.noStop.length);

  it('knows where the bridges are on the route', () => {
    expect(legs.length).toBeGreaterThan(0);
  });

  it('the planner never puts the sakayan or babaan on one', () => {
    const net = networkFromRoutes([route]);
    for (const leg of legs) {
      for (const [a, b] of leg.noStop) {
        // Start right on the bridge, go 3 km further along.
        const along = (a + b) / 2;
        const start = { point: pointNear(leg, along), label: 'On the bridge' };
        expect(projectOnRoute(leg, start.point).offRoute).toBeLessThan(2);
        const end = { point: pointNear(leg, Math.min(leg.length, along + 3000)), label: 'Later' };
        const { options } = planJourneys(net, start, end);
        for (const o of options) {
          for (const s of o.steps.filter((x) => x.type === 'ride' && x.leg === leg)) {
            expect(onBridge(leg, s.fromAlong, 0)).toBe(false);
            expect(onBridge(leg, s.toAlong, 0)).toBe(false);
          }
        }
      }
    }
  });
});

function pointNear(leg, along) {
  let walked = 0;
  for (let i = 1; i < leg.coordinates.length; i++) {
    const d = distanceMeters(leg.coordinates[i - 1], leg.coordinates[i]);
    if (walked + d >= along) {
      const t = (along - walked) / d;
      const [x1, y1] = leg.coordinates[i - 1]; const [x2, y2] = leg.coordinates[i];
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    walked += d;
  }
  return leg.coordinates.at(-1);
}

describe('sharing a trip', () => {
  const to = { kind: 'place', label: 'Jose P. Rizal Street', point: [121.43, 14.2] };
  const stop = route.stops[0];

  it('makes a link that opens the same trip', () => {
    const link = tripLink({ kind: 'stop', stopId: stop.id, label: stop.name, point: stop.coord }, to);
    const back = parseTripLink(link.slice(link.indexOf('#')), route);
    expect(back.to.label).toBe(to.label);
    expect(distanceMeters(back.to.point, to.point)).toBeLessThan(2);
    expect(back.from.stopId).toBe(stop.id);
  });

  it('never shares the rider’s GPS position', () => {
    const link = tripLink({ kind: 'gps', label: 'My location', point: [121.431, 14.201] }, to);
    expect(link).not.toMatch(/from=|fn=/);
  });

  it('ignores links to places far from the route', () => {
    expect(parseTripLink('#/map?to=120.98,14.60&tn=Manila', route)).toBeNull();
  });
});

describe('weather chip', () => {
  it('reads the forecast and warns about rain', () => {
    const w = parseWeather({ current: { temperature_2m: 29.6, weather_code: 3 }, hourly: { precipitation_probability: [20, 70, 40] } });
    expect(w).toMatchObject({ temp: 30, rainSoon: true });
    expect(describeWeather(3).icon).toBe('cloud');
    expect(describeWeather(61).icon).toBe('rain');
    expect(describeWeather(95).icon).toBe('storm');
    expect(parseWeather({})).toBeNull();
  });
});

describe('Community helpers', () => {
  const list = [
    { id: 'a', kind: 'terminal', name: 'Bucal TODA', vehicles: ['tricycle'], point: [121.43, 14.2], fares: { default: 20, solo: 40, shared: null } },
    { id: 'b', kind: 'terminal', name: 'Van terminal', vehicles: ['van'], point: [121.4301, 14.2001], fares: {} },
    { id: 'c', kind: 'local_route', name: 'Route', vehicles: ['tricycle'], point: [121.43, 14.2], path: [[121.43, 14.2], [121.44, 14.21]], fares: {} },
  ];

  it('finds a tricycle terminal near the tricycle step', () => {
    expect(terminalNear(list, [121.4302, 14.2002])?.id).toBe('a');
    expect(terminalNear(list, [121.47, 14.25])).toBeNull();
  });

  it('writes fares the way people say them', () => {
    expect(fareText({ default: 20, solo: 40, shared: 12.5 })).toBe('₱20 · ₱40 solo · ₱12.50 each if shared');
    expect(fareText({})).toBe('');
  });

  it('reports and comments go to the right place', () => {
    expect(targetOf({ kind: 'tip' })).toBe('tip');
    expect(targetOf({ kind: 'terminal' })).toBe('post');
  });
});
