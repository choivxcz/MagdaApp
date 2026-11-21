// Trip mode: following the rider through walk -> wait -> ride -> walk,
// warning before the babaan, and noticing a wrong turn. Also: first / last
// trip times and the language helper.
import { describe, expect, it } from 'vitest';
import { prepareRoute, pointAlong } from '../src/lib/geo.js';
import { networkFromRoutes, buildOption } from '../src/lib/planner.js';
import { followTrip, stepLines } from '../src/lib/tripGuide.js';
import { serviceStatus, fmtTime } from '../src/lib/settings.js';
import { t, useDictionary } from '../src/lib/i18n.js';

// A straight north-south road, 6 km long.
const route = prepareRoute({
  id: 'line', name: 'Line',
  legs: { north: { coordinates: [[121.4, 14.2], [121.4, 14.254]] }, south: { coordinates: [[121.4, 14.254], [121.4, 14.2]] } },
  stops: [],
});
const [net] = networkFromRoutes([route]);
const at = (m) => pointAlong(net.leg, m);
const east = ([lng, lat], m) => [lng + m / 107900, lat];

const home = east(at(1000), 300);
const dest = east(at(4000), 200);
const option = buildOption([
  { type: 'walk', role: 'first', meters: 300, minutes: 4, from: home, to: at(1000) },
  {
    type: 'ride', key: net.key, routeId: net.routeId, routeName: net.routeName, direction: 'north', leg: net.leg,
    fromAlong: 1000, toAlong: 4000, board: at(1000), alight: at(4000), meters: 3000, minutes: 9, fare: { regular: 13, discounted: 10.5 },
  },
  { type: 'walk', role: 'last', meters: 200, minutes: 3, from: at(4000), to: dest },
]);
const lines = stepLines(option);

function run(points) {
  let s = null;
  const out = [];
  for (const p of points) {
    s = followTrip(option, lines, p, s, dest);
    out.push(s);
  }
  return out;
}

describe('following a trip', () => {
  it('goes walk -> wait -> ride -> walk -> arrived, with alerts once each', () => {
    const r = run([
      home, east(at(1000), 150), at(1000), // walk to the sakayan
      at(1010), // waiting at the sakayan
      at(1200), at(2500), at(3550), at(3560), at(3900), // riding
      east(at(4000), 100), dest, // walk to the destination
    ]);
    expect(r.map((x) => x.phase)).toEqual(['walk', 'walk', 'wait', 'wait', 'ride', 'ride', 'ride', 'ride', 'ride', 'walk', 'arrived']);
    expect(r.map((x) => x.alert).filter(Boolean)).toEqual(['prepare', 'getoff', 'arrived']);
    expect(r.at(-1).done).toBe(true);
    expect(r[6].remainingM).toBeCloseTo(450, -1);
  });

  it('notices a wrong turn while walking', () => {
    const r = run([home, east(at(1600), 600)]);
    expect(r[1].offPath).toBe(true);
  });

  it('notices a missed babaan', () => {
    const r = run([at(1000), at(1300), at(3900), at(4400)]);
    expect(r.at(-1).alert).toBe('missed');
    expect(r.at(-1).offPath).toBe(true);
  });

  it('notices riding the wrong road', () => {
    const r = run([at(1000), at(1300), east(at(2000), 400)]);
    expect(r.at(-1).offPath).toBe(true);
  });
});

describe('first and last trips', () => {
  const hours = { north: { first: '05:00', last: '20:00' } };
  const manila = (hh, mm) => new Date(Date.UTC(2026, 10, 21, hh - 8, mm)); // Manila = UTC+8

  it('knows whether jeepneys are running now', () => {
    expect(serviceStatus(hours, 'north', manila(4, 30))).toMatchObject({ state: 'before_first', minutesLeft: 30, first: '5:00 AM' });
    expect(serviceStatus(hours, 'north', manila(12, 0)).state).toBe('running');
    expect(serviceStatus(hours, 'north', manila(19, 20))).toMatchObject({ state: 'last_soon', minutesLeft: 40, last: '8:00 PM' });
    expect(serviceStatus(hours, 'north', manila(21, 0)).state).toBe('after_last');
    expect(serviceStatus({}, 'north').state).toBe('unknown');
  });

  it('writes times the Filipino way', () => {
    expect(fmtTime('00:15')).toBe('12:15 AM');
    expect(fmtTime('13:05')).toBe('1:05 PM');
    expect(fmtTime('bad')).toBe('');
  });
});

describe('languages', () => {
  it('translates, fills in values, and falls back to English', () => {
    useDictionary('tl', { 'Get off here!': 'Bumaba na dito!', '{d} left': '{d} pa' });
    expect(t('Get off here!')).toBe('Bumaba na dito!');
    expect(t('{d} left', { d: '300 m' })).toBe('300 m pa');
    expect(t('Not translated yet')).toBe('Not translated yet');
    useDictionary('en', null);
    expect(t('Get off here!')).toBe('Get off here!');
  });
});
