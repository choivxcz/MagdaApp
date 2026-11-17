// Trip planner: from ANY place to ANY place on the jeepney network.
//
// It answers "how do I actually get there?" by combining walking, jeepney
// rides (one or two, with a transfer), tricycles for places too far to walk
// from the route, or simply walking when that is better. A few good options
// are returned and tagged (Fastest, Least walking, Direct...) so the rider
// can pick what fits them.
//
// Options are compared the way commuters do: minutes matter, but so do long
// walks and money. A ₱20 tricycle that saves two minutes is not "better".
//
// Pure functions only (no React, no browser APIs): the app, the AI server and
// the tests all use the same planner, so they always agree.
//
// A "place" is { point: [lng, lat], label, stopId? }. With a stopId the rider
// boards/alights exactly at that stop on the legs that pass it.
import { distanceMeters, pointAlong, projectOnRoute } from './geo.js';
import { computeFare, tricycleFare } from './fare.js';

export const PLAN = {
  walkMps: 1.3, // ~4.7 km/h
  detour: 1.3, // streets are about 30% longer than a straight line
  jeepMps: 20 / 3.6, // ~20 km/h including stops, same as the map
  trikeMps: 18 / 3.6,
  trikeWaitMin: 3, // finding a tricycle
  transferMin: 5, // waiting for the second jeepney
  onRouteM: 15, // closer than this: you're already on the route
  maxWalkM: 900, // longer walks to or from the route: suggest a tricycle
  maxTrikeM: 6000, // farther than this: outside the area we can plan
  trikeOnlyMaxM: 4000, // offer a tricycle all the way up to this
  walkOnlyMaxM: 2000, // offer "walk there" up to this
  transferMaxM: 250, // two routes this close can be switched between
  minRideM: 250, // shorter jeepney rides aren't worth the fare
  sampleM: 50,
};

// How commuters weigh things, in "minutes": every 250 m walked feels like an
// extra minute, every peso like 0.6 min (most riders are on a budget), and a
// transfer is a hassle.
const PER_WALK_M = 0.004;
const PER_PESO = 0.6;
const PER_TRANSFER = 3;
export const effort = (o) => o.minutes + o.walkM * PER_WALK_M + cost(o) * PER_PESO + Math.max(0, o.rides - 1) * PER_TRANSFER;
const cost = (o) => o.fare.regular + o.fare.tricycle;

// Every direction of every route as one list. Pass several prepared routes
// when more jeepney routes are added; transfers between them just work.
export function networkFromRoutes(routes) {
  const list = [];
  for (const route of [].concat(routes)) {
    for (const [direction, leg] of Object.entries(route.legs)) {
      list.push({ key: `${route.id}:${direction}`, routeId: route.id, routeName: route.name, direction, leg });
    }
  }
  return list;
}

// How a rider covers a straight-line gap: walk, tricycle, or not at all.
function reach(straight, P) {
  if (straight <= P.onRouteM) return { mode: 'none', meters: 0, minutes: 0, walkM: 0, pesos: 0 };
  const meters = straight * P.detour;
  if (meters <= P.maxWalkM) return { mode: 'walk', meters, minutes: meters / P.walkMps / 60, walkM: meters, pesos: 0 };
  if (meters <= P.maxTrikeM) {
    return { mode: 'tricycle', meters, minutes: meters / P.trikeMps / 60 + P.trikeWaitMin, walkM: 0, pesos: tricycleFare(meters).regular };
  }
  return null;
}

// Spots on a leg where the rider could get on (or off), with how they get there.
function candidates(leg, place, P) {
  if (place.stopId) {
    const s = leg.stops.find((x) => x.id === place.stopId);
    if (s) return [{ along: s.along, point: pointAlong(leg, s.along), straight: 0, r: reach(0, P) }];
  }
  const near = projectOnRoute(leg, place.point);
  const maxStraight = P.maxTrikeM / P.detour;
  if (near.offRoute > maxStraight) return [];
  // A spot much farther than the nearest one can't be a better choice.
  const radius = Math.min(maxStraight, near.offRoute * 1.6 + 400);
  const list = [{ along: near.along, point: near.point, straight: near.offRoute }];
  for (let along = 0; along <= leg.length; along += P.sampleM) {
    const point = pointAlong(leg, along);
    const straight = distanceMeters(place.point, point);
    if (straight <= radius) list.push({ along, point, straight });
  }
  return list.map((c) => ({ ...c, r: reach(c.straight, P) })).filter((c) => c.r);
}

// Spots where two legs come close enough to switch jeepneys.
function transferPoints(l1, l2, P) {
  const out = [];
  for (let a1 = 0; a1 <= l1.length; a1 += P.sampleM) {
    const p1 = pointAlong(l1, a1);
    const near = projectOnRoute(l2, p1);
    if (near.offRoute <= P.transferMaxM) out.push({ a1, p1, a2: near.along, p2: near.point, gap: near.offRoute });
  }
  return out;
}

// What the search optimizes: minutes, meters walked, pesos.
const OBJECTIVES = {
  balanced: { t: 1, w: PER_WALK_M, p: PER_PESO },
  time: { t: 1, w: 0.0005, p: 0.01 },
  walk: { t: 1, w: 0.05, p: 0.2 },
};
const score = (o, minutes, walkM, pesos) => minutes * o.t + walkM * o.w + pesos * o.p;
const rideMin = (m, P) => m / P.jeepMps / 60;
const rideFare = (m) => computeFare(m).regular;

function accessStep(role, r, from, to) {
  if (r.mode === 'none') return null;
  return { type: r.mode, role, meters: r.meters, minutes: r.minutes, from, to };
}

function rideStep(net, fromAlong, toAlong, P) {
  const meters = toAlong - fromAlong;
  return {
    type: 'ride',
    key: net.key,
    routeId: net.routeId,
    routeName: net.routeName,
    direction: net.direction,
    leg: net.leg,
    fromAlong,
    toAlong,
    board: pointAlong(net.leg, fromAlong),
    alight: pointAlong(net.leg, toAlong),
    boardNear: nearStop(net.leg, fromAlong),
    alightNear: nearStop(net.leg, toAlong),
    meters,
    minutes: rideMin(meters, P),
    fare: computeFare(meters),
  };
}

// The named stop closest to a spot on a leg (for "near Capitol"), if any.
export function nearStop(leg, along, maxM = 500) {
  let best = null;
  for (const s of leg.stops) {
    const d = Math.abs(s.along - along);
    if (d <= maxM && (!best || d < best.meters)) best = { stop: s, meters: d };
  }
  return best;
}

function directOption(net, from, to, B, A, o, P) {
  let best = null;
  for (const b of B) {
    for (const a of A) {
      const ride = a.along - b.along;
      if (ride < P.minRideM) continue;
      const s = score(o, b.r.minutes + rideMin(ride, P) + a.r.minutes, b.r.walkM + a.r.walkM, b.r.pesos + rideFare(ride) + a.r.pesos);
      if (!best || s < best.s) best = { s, b, a };
    }
  }
  if (!best) return null;
  const { b, a } = best;
  return buildOption([
    accessStep('first', b.r, from.point, b.point),
    rideStep(net, b.along, a.along, P),
    accessStep('last', a.r, a.point, to.point),
  ]);
}

function transferOption(n1, n2, from, to, B, A, T, o, P) {
  let best = null;
  for (const t of T) {
    let bb = null;
    for (const b of B) {
      const ride = t.a1 - b.along;
      if (ride < P.minRideM) continue;
      const s = score(o, b.r.minutes + rideMin(ride, P), b.r.walkM, b.r.pesos + rideFare(ride));
      if (!bb || s < bb.s) bb = { s, b };
    }
    if (!bb) continue;
    let aa = null;
    for (const a of A) {
      const ride = a.along - t.a2;
      if (ride < P.minRideM) continue;
      const s = score(o, rideMin(ride, P) + a.r.minutes, a.r.walkM, rideFare(ride) + a.r.pesos);
      if (!aa || s < aa.s) aa = { s, a };
    }
    if (!aa) continue;
    const gapM = t.gap > P.onRouteM ? t.gap * P.detour : 0;
    const s = bb.s + aa.s + score(o, gapM / P.walkMps / 60 + P.transferMin + PER_TRANSFER, gapM, 0);
    if (!best || s < best.s) best = { s, b: bb.b, a: aa.a, t, gapM };
  }
  if (!best) return null;
  const { b, a, t, gapM } = best;
  return buildOption([
    accessStep('first', b.r, from.point, b.point),
    rideStep(n1, b.along, t.a1, P),
    { type: 'transfer', meters: gapM, minutes: gapM / P.walkMps / 60 + P.transferMin, from: t.p1, to: t.p2 },
    rideStep(n2, t.a2, a.along, P),
    accessStep('last', a.r, a.point, to.point),
  ]);
}

// Totals for an option from its steps.
export function buildOption(rawSteps) {
  const steps = rawSteps.filter(Boolean);
  let minutes = 0, walkM = 0, regular = 0, discounted = 0, trike = 0, trikeDiscounted = 0;
  for (const s of steps) {
    minutes += s.minutes;
    if (s.type === 'walk' || s.type === 'transfer') walkM += s.meters;
    if (s.type === 'ride') { regular += s.fare.regular; discounted += s.fare.discounted; }
    if (s.type === 'tricycle') {
      s.fare = tricycleFare(s.meters);
      trike += s.fare.regular;
      trikeDiscounted += s.fare.discounted;
    }
  }
  const rides = steps.filter((s) => s.type === 'ride');
  return {
    id: rides.length
      ? rides.map((r) => `${r.key}@${Math.round(r.fromAlong / 100)}-${Math.round(r.toAlong / 100)}`).join('|')
      : steps[0]?.type ?? 'none',
    steps,
    rides: rides.length,
    minutes,
    walkM,
    fare: { regular, discounted, tricycle: trike, tricycleDiscounted: trikeDiscounted },
    tags: [],
  };
}

function dominates(a, b) {
  const noWorse = a.minutes <= b.minutes + 0.5 && a.walkM <= b.walkM + 30 && a.rides <= b.rides && cost(a) <= cost(b) + 0.01;
  const better = a.minutes < b.minutes - 0.5 || a.walkM < b.walkM - 30 || a.rides < b.rides || cost(a) < cost(b) - 0.01;
  return noWorse && better;
}

// The rider's options from `from` to `to`, best first.
// Returns { options, reason } where reason explains an empty list:
// 'same' | 'far_from' | 'far_to' | 'none'.
export function planJourneys(network, from, to, overrides = {}) {
  const P = { ...PLAN, ...overrides };
  const nets = Array.isArray(network) ? network : networkFromRoutes(network);
  if (!from?.point || !to?.point) return { options: [], reason: 'none' };
  const straight = distanceMeters(from.point, to.point);
  if ((from.stopId && from.stopId === to.stopId) || straight < 30) return { options: [], reason: 'same' };

  const B = new Map(nets.map((n) => [n.key, candidates(n.leg, from, P)]));
  const A = new Map(nets.map((n) => [n.key, candidates(n.leg, to, P)]));
  const all = [];

  // Sometimes the best jeepney is no jeepney.
  const doorM = straight * P.detour;
  if (doorM <= P.walkOnlyMaxM) {
    all.push(buildOption([{ type: 'walk', role: 'only', meters: doorM, minutes: doorM / P.walkMps / 60, from: from.point, to: to.point }]));
  }
  if (doorM > P.maxWalkM && doorM <= P.trikeOnlyMaxM) {
    all.push(buildOption([{ type: 'tricycle', role: 'only', meters: doorM, minutes: doorM / P.trikeMps / 60 + P.trikeWaitMin, from: from.point, to: to.point }]));
  }

  for (const o of Object.values(OBJECTIVES)) {
    for (const n of nets) {
      const opt = directOption(n, from, to, B.get(n.key), A.get(n.key), o, P);
      if (opt) all.push(opt);
    }
  }

  // Transfers, but only when they actually help compared with riding direct:
  // not every place where two routes touch is a good place to switch.
  const directs = all.filter((x) => x.rides === 1);
  const bestDirect = Math.min(...directs.map(effort));
  for (const n1 of nets) {
    if (!B.get(n1.key).length) continue;
    for (const n2 of nets) {
      if (n1.key === n2.key || !A.get(n2.key).length) continue;
      const T = transferPoints(n1.leg, n2.leg, P);
      if (!T.length) continue;
      for (const o of Object.values(OBJECTIVES)) {
        const opt = transferOption(n1, n2, from, to, B.get(n1.key), A.get(n2.key), T, o, P);
        if (opt && (!Number.isFinite(bestDirect) || effort(opt) < bestDirect - 1)) all.push(opt);
      }
    }
  }

  // Drop duplicates, options another one beats on every count, and options
  // that are clearly a worse deal than the best one.
  const unique = [];
  for (const opt of all) if (!unique.some((u) => u.id === opt.id)) unique.push(opt);
  let kept = unique.filter((opt) => !unique.some((other) => other !== opt && dominates(other, opt)));
  if (!kept.length) {
    const reachable = (M) => [...M.values()].some((l) => l.length);
    return { options: [], reason: !reachable(B) ? 'far_from' : !reachable(A) ? 'far_to' : 'none' };
  }
  // A jeepney that covers less than the walking/tricycle parts isn't worth
  // it when you could go door to door ("ride 250 m, then tricycle 1 km").
  const doorToDoor = kept.some((x) => x.rides === 0);
  const rideM = (x) => x.steps.reduce((m, s) => m + (s.type === 'ride' ? s.meters : 0), 0);
  const otherM = (x) => x.steps.reduce((m, s) => m + (s.type === 'ride' ? 0 : s.meters), 0);
  if (doorToDoor) kept = kept.filter((x) => x.rides === 0 || rideM(x) >= otherM(x));
  kept.sort((a, b) => effort(a) - effort(b));
  const bestEffort = effort(kept[0]);
  kept = kept.filter((x) => effort(x) <= bestEffort * 1.5 + 5);
  // Same jeepneys with only a slightly different walk isn't a real choice.
  const legs = (x) => x.steps.filter((s) => s.type === 'ride').map((s) => s.key).join('|') || x.steps[0].type;
  kept = kept.filter((x, i) => !kept.slice(0, i).some((y) => legs(y) === legs(x) && Math.abs(y.walkM - x.walkM) < 200 && Math.abs(y.minutes - x.minutes) < 5));

  // Tags help the rider choose. The first option is the recommended one.
  if (kept.length > 1) {
    const fastest = kept.reduce((a, b) => (b.minutes < a.minutes - 0.5 ? b : a));
    fastest.tags.push('fastest');
    const leastWalk = kept.reduce((a, b) => (b.walkM < a.walkM - 30 || (Math.abs(b.walkM - a.walkM) <= 30 && effort(b) < effort(a)) ? b : a));
    if (leastWalk.walkM < Math.max(...kept.map((x) => x.walkM)) - 30) leastWalk.tags.push('least_walk');
    if (kept.some((x) => x.rides >= 2)) kept.find((x) => x.rides === 1)?.tags.push('direct');
  }
  for (const x of kept) {
    if (x.rides === 0) x.tags.push(x.steps[0].type === 'walk' ? 'walk_only' : 'tricycle_only');
    if (x.rides >= 2) x.tags.push('transfer');
  }

  return { options: kept.slice(0, 4), reason: null };
}

// The map knows the exact sakayan (shortest REAL walk, from useSakayan).
// Move the first boarding there and recount the option.
export function refineWithSakayan(option, sakayan, P = PLAN) {
  if (!option || !sakayan || sakayan.tooFar) return option;
  const i = option.steps.findIndex((s) => s.type === 'ride');
  if (i < 0 || i > 1) return option;
  const ride = option.steps[i];
  const before = option.steps[0];
  if (i === 1 && before.type !== 'walk') return option; // tricycle to the route: keep the planner's spot
  if (sakayan.direction !== ride.direction || ride.toAlong - sakayan.along < P.minRideM) return option;
  const net = { key: ride.key, routeId: ride.routeId, routeName: ride.routeName, direction: ride.direction, leg: ride.leg };
  const walkMeters = sakayan.walk?.meters ?? (sakayan.straight > P.onRouteM ? sakayan.straight * P.detour : 0);
  const steps = [
    walkMeters > 0
      ? { type: 'walk', role: 'first', meters: walkMeters, minutes: walkMeters / P.walkMps / 60, from: i === 1 ? before.from : sakayan.walk?.coords?.[0] ?? sakayan.point, to: sakayan.point }
      : null,
    rideStep(net, sakayan.along, ride.toAlong, P),
    ...option.steps.slice(i + 1),
  ];
  return { ...buildOption(steps), id: option.id, tags: option.tags };
}

// Swap in measured street distances (from the walking/road services) for
// the planner's estimates. measured(step) returns meters or null.
export function withMeasuredSteps(option, measured, P = PLAN) {
  if (!option) return option;
  let changed = false;
  const steps = option.steps.map((s) => {
    if (s.type !== 'walk' && s.type !== 'tricycle') return s;
    const m = measured(s);
    if (m == null || Math.abs(m - s.meters) < 1) return s;
    changed = true;
    const minutes = s.type === 'walk' ? m / P.walkMps / 60 : m / P.trikeMps / 60 + P.trikeWaitMin;
    return { ...s, meters: m, minutes };
  });
  return changed ? { ...buildOption(steps), id: option.id, tags: option.tags } : option;
}

export const TAG_LABEL = {
  fastest: 'Fastest',
  least_walk: 'Least walking',
  direct: 'Direct',
  transfer: 'With transfer',
  walk_only: 'Walk',
  tricycle_only: 'Tricycle',
};

export const fmtMeters = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtMinutes = (min) => {
  const m = Math.max(1, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// "near Capitol (by Jollibee)": the stop, plus a landmark right at the spot
// when byLandmark(point) knows one. Riders look for buildings, not km marks.
export function spotText(stopNear, point, byLandmark) {
  const stop = stopNear ? stopNear.stop.short ?? stopNear.stop.name : null;
  const lm = byLandmark?.(point);
  // Skip a landmark that is just the stop itself ("DLTB Terminal" / "DLTBCo. Santa Cruz Terminal").
  const words = (x) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length >= 4);
  const sameAsStop = stop && lm && words(stop).some((w) => lm.name.toLowerCase().includes(w));
  const by = lm && !sameAsStop ? lm.name : null;
  if (stop && by) return `near ${stop} (by ${by})`;
  if (stop) return `near ${stop}`;
  return by ? `by ${by}` : 'along the route';
}

// Plain-language steps, for the AI and for sharing.
export function describeOption(option, { fareType = 'regular', dirLabel = (d) => d, toLabel = 'your destination', byLandmark } = {}) {
  return option.steps.map((s) => {
    const dest = s.role === 'first' ? 'the jeepney route' : toLabel;
    if (s.type === 'walk') return `Walk ${fmtMeters(s.meters)} (${fmtMinutes(s.minutes)}) to ${dest}`;
    if (s.type === 'tricycle') return `Tricycle ${fmtMeters(s.meters)} (${fmtMinutes(s.minutes)}, about ₱${Math.round(s.fare[fareType])}) to ${dest}`;
    if (s.type === 'transfer') return `Get off and transfer${s.meters > 0 ? ` (walk ${fmtMeters(s.meters)})` : ''}, then wait for the next jeepney`;
    return `Ride the jeepney ${dirLabel(s.direction)} from ${spotText(s.boardNear, s.board, byLandmark)}, ${fmtMeters(s.meters)} (~${fmtMinutes(s.minutes)}, ₱${s.fare[fareType].toFixed(2)}), get off ${spotText(s.alightNear, s.alight, byLandmark)}`;
  });
}
