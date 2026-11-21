// Sakayan / babaan follow the REAL road: get on where the tricycle or walk
// first reaches the jeepney route, get off where the path leaves it.
import { describe, expect, it } from 'vitest';
import { prepareRoute, pointAlong, distanceMeters } from '../src/lib/geo.js';
import { networkFromRoutes, buildOption, alignWithPaths, PLAN } from '../src/lib/planner.js';

// A straight north-south road, 6 km long.
const route = prepareRoute({
  id: 'line', name: 'Line',
  legs: { north: { coordinates: [[121.4, 14.2], [121.4, 14.254]] }, south: { coordinates: [[121.4, 14.254], [121.4, 14.2]] } },
  stops: [],
});
const [net] = networkFromRoutes([route]);
const at = (m) => pointAlong(net.leg, m);
const east = ([lng, lat], m) => [lng + m / 107900, lat];

function ride(fromAlong, toAlong) {
  // Same shape the planner makes (via buildOption).
  const opt = buildOption([{ type: 'walk', role: 'first', meters: 1, minutes: 1, from: [0, 0], to: [0, 0] }, {
    type: 'ride', key: net.key, routeId: net.routeId, routeName: net.routeName, direction: net.direction, leg: net.leg,
    fromAlong, toAlong, board: at(fromAlong), alight: at(toAlong), meters: toAlong - fromAlong, minutes: 1, fare: { regular: 13, discounted: 10.5 },
  }]);
  return opt.steps[1];
}

describe('getting on where the real road reaches the route', () => {
  const home = east(at(3000), 1500);
  // The road from home goes south-west and joins the route at 1 km, then
  // follows the route north to the planned sakayan at 3 km.
  const road = [home, east(at(1000), 1500), east(at(1000), 700), at(1000), at(1500), at(2000), at(2500), at(3000)];

  it('moves the sakayan back to where the tricycle joins the route', () => {
    const r = ride(3000, 5500);
    const option = buildOption([{ type: 'tricycle', role: 'first', meters: 2000, minutes: 9, from: home, to: at(3000) }, r]);
    const fixed = alignWithPaths(option, (s) => (s.type === 'tricycle' ? { coords: road } : null));
    const trip = fixed.steps.find((s) => s.type === 'ride');
    expect(trip.fromAlong).toBeCloseTo(1000, -1);
    expect(distanceMeters(trip.board, at(1000))).toBeLessThan(5);
    // The tricycle now stops at the route (3.5 km of road) instead of
    // also driving 2 km along it (5.5 km).
    expect(fixed.steps[0].meters).toBeCloseTo(3500, -2);
    expect(fixed.steps[0].coords.at(-1)).toEqual(trip.board);
    expect(fixed.id).toBe(option.id);
  });

  it('changes nothing when the path reaches the route at the sakayan', () => {
    const r = ride(3000, 5500);
    const direct = [home, east(at(3000), 800), at(3000)];
    const option = buildOption([{ type: 'tricycle', role: 'first', meters: 2000, minutes: 9, from: home, to: at(3000) }, r]);
    expect(alignWithPaths(option, () => ({ coords: direct }))).toBe(option);
  });

  it('never moves the sakayan so close to the babaan that the ride is pointless', () => {
    const r = ride(3000, 1000 + PLAN.minRideM - 10);
    const option = buildOption([{ type: 'tricycle', role: 'first', meters: 2000, minutes: 9, from: home, to: at(3000) }, r]);
    expect(alignWithPaths(option, () => ({ coords: road })).steps[1].fromAlong).toBe(3000);
  });
});

describe('getting off where the real path leaves the route', () => {
  it('moves the babaan to where the walk turns off the route', () => {
    const dest = east(at(4000), 400);
    // Walk from the planned babaan (3 km) north along the route, then east.
    const walk = [at(3000), at(3500), at(4000), east(at(4000), 200), dest];
    const r = ride(500, 3000);
    const option = buildOption([r, { type: 'walk', role: 'last', meters: 1600, minutes: 20, from: at(3000), to: dest }]);
    const fixed = alignWithPaths(option, (s) => (s.type === 'walk' ? { coords: walk } : null));
    const trip = fixed.steps.find((s) => s.type === 'ride');
    expect(trip.toAlong).toBeCloseTo(4000, -1);
    expect(fixed.steps.at(-1).meters).toBeLessThan(500);
    expect(fixed.walkM).toBeLessThan(option.walkM);
  });
});
