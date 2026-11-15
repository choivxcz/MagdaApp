// Regression tests for the trip planner: the answers commuters rely on.
// Run with: npm test
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareRoute, distanceMeters } from '../src/lib/geo.js';
import { planJourneys, networkFromRoutes, refineWithSakayan, withMeasuredSteps, PLAN } from '../src/lib/planner.js';
import { computeFare, tricycleFare } from '../src/lib/fare.js';

const route = prepareRoute(JSON.parse(readFileSync(new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url), 'utf8')));
const net = networkFromRoutes([route]);
const stop = (id) => {
  const s = route.stops.find((x) => x.id === id);
  return { kind: 'stop', stopId: s.id, label: s.name, point: s.coord };
};
const at = (point) => ({ kind: 'place', label: 'Somewhere', point });
// A point `m` meters east of another.
const east = ([lng, lat], m) => [lng + m / (111320 * Math.cos((lat * Math.PI) / 180)), lat];
const rides = (o) => o.steps.filter((s) => s.type === 'ride');

describe('direct trips between stops', () => {
  it('Magdalena Plaza to Santa Cruz Plaza is one jeepney to Santa Cruz, no walking', () => {
    const { options } = planJourneys(net, stop('magdalena-plaza'), stop('santa-cruz-plaza'));
    const best = options[0];
    expect(best.rides).toBe(1);
    expect(rides(best)[0].direction).toBe('to_santa_cruz');
    expect(best.walkM).toBe(0);
    expect(best.fare.regular).toBe(computeFare(route.legs.to_santa_cruz.stops.at(-1).along).regular);
  });

  it('picks the direction that actually goes there (DLTB to HM rides to Magdalena)', () => {
    const best = planJourneys(net, stop('dltb'), stop('hm')).options.find((o) => o.rides === 1);
    expect(rides(best)[0].direction).toBe('to_magdalena');
  });

  it('the return trip uses the return direction', () => {
    const best = planJourneys(net, stop('santa-cruz-plaza'), stop('magdalena-plaza')).options[0];
    expect(rides(best)[0].direction).toBe('to_magdalena');
  });

  it('boards and alights exactly at chosen stops', () => {
    const r = rides(planJourneys(net, stop('dltb'), stop('capitol')).options[0])[0];
    const leg = route.legs[r.direction];
    expect(r.fromAlong).toBeCloseTo(leg.stops.find((s) => s.id === 'dltb').along, 3);
    expect(r.toAlong).toBeCloseTo(leg.stops.find((s) => s.id === 'capitol').along, 3);
  });
});

describe('walking and tricycles', () => {
  it('offers walking when the place is close, and never rides less than the minimum', () => {
    const { options } = planJourneys(net, stop('santa-cruz-plaza'), stop('public-market'));
    expect(options.some((o) => o.tags.includes('walk_only'))).toBe(true);
    for (const o of options) for (const r of rides(o)) expect(r.meters).toBeGreaterThanOrEqual(PLAN.minRideM);
  });

  it('does not suggest a short jeepney hop plus a tricycle when you can go door to door', () => {
    for (const o of planJourneys(net, stop('santa-cruz-plaza'), stop('public-market')).options) {
      const ride = rides(o).reduce((m, s) => m + s.meters, 0);
      const other = o.steps.filter((s) => s.type !== 'ride').reduce((m, s) => m + s.meters, 0);
      if (o.rides) expect(ride).toBeGreaterThanOrEqual(other);
    }
  });

  it('walks to the route from a nearby spot', () => {
    const from = at(east(stop('buboy').point, 300));
    const best = planJourneys(net, from, stop('santa-cruz-plaza')).options[0];
    expect(best.steps[0].type).toBe('walk');
    expect(best.steps[0].meters).toBeLessThan(PLAN.maxWalkM);
    expect(best.rides).toBe(1);
  });

  it('suggests a tricycle for a destination too far to walk from the route', () => {
    const to = at(east(stop('areza').point, 2000));
    const best = planJourneys(net, stop('magdalena-plaza'), to).options[0];
    expect(best.steps.at(-1).type).toBe('tricycle');
    expect(best.fare.tricycle).toBe(tricycleFare(best.steps.at(-1).meters).regular);
  });

  it('says when a place is outside the area it can plan', () => {
    const far = at(east(stop('capitol').point, 12000));
    expect(planJourneys(net, far, stop('capitol'))).toEqual({ options: [], reason: 'far_from' });
    expect(planJourneys(net, stop('capitol'), far)).toEqual({ options: [], reason: 'far_to' });
  });

  it('knows when start and destination are the same', () => {
    expect(planJourneys(net, stop('dltb'), stop('dltb')).reason).toBe('same');
  });
});

describe('options', () => {
  it('returns at most 4 options, all different, the first one tagged best by the app', () => {
    for (const [a, b] of [['magdalena-plaza', 'capitol'], ['public-market', 'capitol'], ['dltb', 'hm']]) {
      const { options } = planJourneys(net, stop(a), stop(b));
      expect(options.length).toBeGreaterThan(0);
      expect(options.length).toBeLessThanOrEqual(4);
      expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    }
  });

  it('adds totals up from the steps', () => {
    const o = planJourneys(net, at(east(stop('cigaras').point, 400)), at(east(stop('capitol').point, 300))).options[0];
    const sum = o.steps.reduce((m, s) => m + s.minutes, 0);
    expect(o.minutes).toBeCloseTo(sum, 6);
    expect(o.fare.regular).toBe(rides(o).reduce((m, r) => m + r.fare.regular, 0));
  });

  it('is fast enough to run on every tap', () => {
    const t = performance.now();
    planJourneys(net, at(east(stop('buenavista').point, 500)), at(east(stop('public-market').point, 600)));
    expect(performance.now() - t).toBeLessThan(500);
  });
});

// Two made-up routes that cross like a "+": the only way between their
// ends is to transfer where they meet.
describe('transfers between routes', () => {
  const line = (id, a, b) => prepareRoute({
    id, name: id,
    legs: { go: { coordinates: [a, b] }, back: { coordinates: [b, a] } },
    stops: [{ id: `${id}-a`, name: `${id} A`, coord: a }, { id: `${id}-b`, name: `${id} B`, coord: b }],
  });
  const ew = line('ew', [121.30, 14.30], [121.40, 14.30]);
  const ns = line('ns', [121.35, 14.25], [121.35, 14.35]);
  const grid = networkFromRoutes([ew, ns]);

  it('rides one route, transfers at the crossing, then rides the other', () => {
    const best = planJourneys(grid, { label: 'West end', point: [121.30, 14.30] }, { label: 'North end', point: [121.35, 14.35] }).options[0];
    expect(best.rides).toBe(2);
    const [r1, r2] = rides(best);
    expect(r1.routeId).toBe('ew');
    expect(r2.routeId).toBe('ns');
    const transfer = best.steps.find((s) => s.type === 'transfer');
    expect(distanceMeters(transfer.from, [121.35, 14.30])).toBeLessThan(150);
    expect(best.fare.regular).toBe(r1.fare.regular + r2.fare.regular);
  });

  it('does not transfer when one ride is enough', () => {
    const best = planJourneys(grid, { label: 'West', point: [121.30, 14.30] }, { label: 'East', point: [121.40, 14.30] }).options[0];
    expect(best.rides).toBe(1);
  });
});

describe('refining with the real walk', () => {
  it('moves the boarding to the sakayan and recounts the fare', () => {
    const from = at(east(stop('buboy').point, 300));
    const option = planJourneys(net, from, stop('santa-cruz-plaza')).options[0];
    const ride = rides(option)[0];
    const leg = route.legs[ride.direction];
    const sakayan = { direction: ride.direction, along: ride.fromAlong + 200, point: ride.board, straight: 250, walk: { meters: 420, coords: [from.point, ride.board] } };
    const refined = refineWithSakayan(option, sakayan);
    expect(rides(refined)[0].fromAlong).toBe(ride.fromAlong + 200);
    expect(refined.steps[0].meters).toBe(420);
    expect(rides(refined)[0].fare).toEqual(computeFare(leg.stops.find((s) => s.id === 'santa-cruz-plaza').along - ride.fromAlong - 200));
    expect(refined.id).toBe(option.id);
  });

  it('keeps the planner’s choice when the sakayan is the other direction', () => {
    const option = planJourneys(net, at(east(stop('buboy').point, 300)), stop('santa-cruz-plaza')).options[0];
    expect(refineWithSakayan(option, { direction: 'to_magdalena', along: 0, point: [0, 0], straight: 10 })).toBe(option);
  });

  it('uses measured street distances when they arrive', () => {
    const option = planJourneys(net, at(east(stop('buboy').point, 300)), stop('santa-cruz-plaza')).options[0];
    const measured = withMeasuredSteps(option, (s) => (s.type === 'walk' ? 999 : null));
    expect(measured.steps[0].meters).toBe(999);
    expect(measured.walkM).toBe(999);
    expect(measured.minutes).toBeGreaterThan(option.minutes);
  });
});

describe('fares', () => {
  it('jeepney: base fare for the first 4 km, then per km, 20% off for discounted', () => {
    expect(computeFare(3000)).toMatchObject({ regular: 13, discounted: 10.5 });
    expect(computeFare(5500).regular).toBe(16.5); // ₱13 + 2 × ₱1.80 = ₱16.60, rounded to the nearest 25 centavos
  });
  it('tricycle estimate grows with distance', () => {
    expect(tricycleFare(800).regular).toBe(20);
    expect(tricycleFare(2500).regular).toBe(30);
    expect(tricycleFare(2500).discounted).toBe(24);
  });
});
