// Finds the passenger's sakayan: the spot on a street the jeepneys pass that
// is the SHORTEST WALK away (not just the closest as the crow flies), plus
// the walking path to it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { distanceMeters, pointAlong, projectOnRoute } from './geo.js';
import { walkingPath, fastestOf } from './walking.js';

export const MAX_WALK_SEARCH_M = 1500; // farther than this from the route: pick a stop instead
const ON_ROUTE_M = 15; // closer than this, you're already at the sakayan
const SAMPLE_EVERY_M = 50;
const MAX_CANDIDATES = 40;

// Spots along the route worth checking, closest (straight line) first.
function candidates(route, from, direction, maxAlong) {
  const legs = Object.entries(route.legs).filter(([d]) => !direction || d === direction);
  let nearestOff = Infinity;
  for (const [, leg] of legs) nearestOff = Math.min(nearestOff, projectOnRoute(leg, from).offRoute);
  if (nearestOff > MAX_WALK_SEARCH_M) return { tooFar: true, off: nearestOff };

  // A spot farther than this in a straight line can't be a shorter walk in practice.
  const radius = Math.min(MAX_WALK_SEARCH_M, nearestOff * 1.6 + 250);
  const list = [];
  for (const [d, leg] of legs) {
    const end = Math.min(leg.length, maxAlong ?? leg.length);
    const near = projectOnRoute(leg, from);
    if (near.along <= end) list.push({ direction: d, along: near.along, point: near.point, straight: near.offRoute });
    for (let along = 0; along <= end; along += SAMPLE_EVERY_M) {
      const point = pointAlong(leg, along);
      const straight = distanceMeters(from, point);
      if (straight <= radius) list.push({ direction: d, along, point, straight });
    }
  }
  list.sort((a, b) => a.straight - b.straight);
  if (list.length <= MAX_CANDIDATES) return { list };
  // Keep the closest few, then an even spread of the rest.
  const keep = list.slice(0, 10);
  const rest = list.slice(10);
  const step = rest.length / (MAX_CANDIDATES - keep.length);
  for (let i = 0; i < MAX_CANDIDATES - keep.length; i++) keep.push(rest[Math.floor(i * step)]);
  return { list: keep };
}

// direction / maxAlong limit the search once a destination is chosen
// (board the right direction, before the babaan).
// Returns null (not asked), { tooFar, off }, or
// { point, along, direction, directions, straight, loading, walk, walkFailed, retry }.
// walk is null while loading or if no directions service answered: we never
// draw a straight shortcut instead of the real streets.
export function useSakayan(route, from, { direction = null, maxAlong = null } = {}) {
  const [attempt, setAttempt] = useState(0);
  const key = from ? `${from.join(',')}|${direction ?? '*'}|${maxAlong == null ? '' : Math.round(maxAlong)}|${attempt}` : '';
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const found = candidates(route, from, direction, maxAlong);
    if (found.tooFar || !found.list.length) {
      setState({ key, tooFar: true, off: found.off ?? Infinity });
      return undefined;
    }
    const withDirections = (c) => ({
      ...c,
      // Which directions stop here (both, where the two routes share a street).
      directions: Object.entries(route.legs).filter(([, leg]) => projectOnRoute(leg, c.point).offRoute < 30).map(([d]) => d),
    });
    const first = found.list[0];
    // Pin the nearest spot right away (no line yet), then find the real shortest walk.
    setState({ key, ...withDirections(first), loading: first.straight > ON_ROUTE_M, walk: null });
    if (first.straight <= ON_ROUTE_M) return undefined;

    (async () => {
      const i = await fastestOf(from, found.list.map((c) => c.point));
      const best = found.list[i ?? 0];
      const walk = best.straight > ON_ROUTE_M ? await walkingPath(from, best.point) : null;
      if (!cancelled) setState({ key, ...withDirections(best), loading: false, walk, walkFailed: !walk && best.straight > ON_ROUTE_M });
    })();
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => (state?.key === key ? { ...state, retry } : null), [state, key, retry]);
}
