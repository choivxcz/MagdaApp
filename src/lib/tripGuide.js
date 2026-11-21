// Trip mode for riders (like DavaoGo's Start): follows the rider's GPS
// through the steps of a planned trip, warns before the babaan ("Get
// ready", then "Get off here!"), and notices when they went another way so
// the app can plan again from where they are.
//
// Pure functions (no browser APIs) so it can be tested without a phone.
import { distanceMeters, projectOnRoute, sliceAlong } from './geo.js';

export const GUIDE = {
  stepDoneM: 35, // this close to a step's end: go to the next step
  arriveM: 40, // this close to the destination: arrived
  prepareM: 500, // "Get ready to get off" this far before the babaan
  getOffM: 150, // "Get off here!"
  offPathM: 120, // walking / tricycle: this far from the path = went another way
  offRouteRideM: 150, // riding: this far from the jeepney's road = another road
  missedM: 250, // riding this far past the babaan = missed it
  boardedM: 60, // moved this far along the route from the sakayan = on the jeepney
};

// The line of each step: real street paths when we have them.
export function stepLines(option, pathFor = () => null) {
  return option.steps.map((s) => {
    if (s.type === 'ride') return sliceAlong(s.leg, s.fromAlong, s.toAlong);
    const p = s.coords ?? pathFor(s)?.coords;
    return p?.length > 1 ? p : [s.from, s.to];
  });
}

function distanceToLine(point, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const k = Math.cos((point[1] * Math.PI) / 180) * 111320;
    const ax = (a[0] - point[0]) * k, ay = (a[1] - point[1]) * 110574;
    const bx = (b[0] - point[0]) * k, by = (b[1] - point[1]) * 110574;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return line.length === 1 ? distanceMeters(point, line[0]) : best;
}

// Where the rider is in the trip.
// prev: the last result (or null at the start). Returns:
// { index, phase, remainingM, alert, offPath, done, alerts }
//   phase: 'walk' | 'tricycle' | 'transfer' | 'wait' | 'ride' | 'arrived'
//   alert: null | 'prepare' | 'getoff' | 'arrived' | 'missed' (only once each)
export function followTrip(option, lines, point, prev = null, dest = null, P = GUIDE) {
  const steps = option.steps;
  const alerts = new Set(prev?.alerts ?? []);
  let index = Math.min(prev?.index ?? 0, steps.length);
  let boarded = prev?.boarded ?? false;
  const once = (key) => {
    if (alerts.has(key)) return false;
    alerts.add(key);
    return true;
  };
  const end = dest ?? steps.at(-1)?.to;

  // Arrived (from any step: maybe they took a shortcut).
  if (end && distanceMeters(point, end) <= P.arriveM) {
    return { index: steps.length, phase: 'arrived', remainingM: 0, alert: once('arrived') ? 'arrived' : null, offPath: false, done: true, alerts: [...alerts], boarded };
  }

  // Skip steps the rider has finished.
  for (let guard = 0; guard < steps.length && index < steps.length; guard++) {
    const s = steps[index];
    if (s.type === 'ride') {
      // Off the jeepney: at the babaan, or walked off the road near it.
      // (Still on the road far past it = missed it, handled below.)
      const at = projectOnRoute(s.leg, point);
      const atBabaan = distanceMeters(point, s.alight) <= P.stepDoneM;
      const steppedOff = at.offRoute > 40 && at.along >= s.toAlong - 60 && at.along <= s.toAlong + P.missedM;
      if (boarded && (atBabaan || steppedOff)) { index++; boarded = false; continue; }
      break;
    }
    if (distanceMeters(point, s.to) <= P.stepDoneM) { index++; boarded = false; continue; }
    break;
  }
  if (index >= steps.length) {
    return { index, phase: 'arrived', remainingM: end ? distanceMeters(point, end) : 0, alert: null, offPath: false, done: false, alerts: [...alerts], boarded };
  }

  const s = steps[index];
  if (s.type === 'ride') {
    const at = projectOnRoute(s.leg, point);
    if (!boarded && at.offRoute <= 40 && at.along >= s.fromAlong + P.boardedM) boarded = true;
    const remainingM = Math.max(0, s.toAlong - at.along);
    if (!boarded) {
      // Still at (or walking to) the sakayan.
      const toBoard = distanceMeters(point, s.board);
      return { index, phase: 'wait', remainingM: toBoard, alert: null, offPath: toBoard > P.offPathM * 2 && at.offRoute > P.offPathM, done: false, alerts: [...alerts], boarded };
    }
    if (at.offRoute > P.offRouteRideM) {
      return { index, phase: 'ride', remainingM, alert: null, offPath: true, done: false, alerts: [...alerts], boarded };
    }
    if (at.along > s.toAlong + P.missedM) {
      return { index, phase: 'ride', remainingM: 0, alert: once(`${index}:missed`) ? 'missed' : null, offPath: true, done: false, alerts: [...alerts], boarded };
    }
    let alert = null;
    if (remainingM <= P.getOffM) alert = once(`${index}:getoff`) ? 'getoff' : null;
    else if (remainingM <= P.prepareM) alert = once(`${index}:prepare`) ? 'prepare' : null;
    // A short ride can skip "prepare"; never say it after "get off".
    if (alert === 'getoff') alerts.add(`${index}:prepare`);
    return { index, phase: 'ride', remainingM, alert, offPath: false, done: false, alerts: [...alerts], boarded };
  }

  const off = distanceToLine(point, lines[index] ?? [s.from, s.to]);
  return {
    index,
    phase: s.type === 'tricycle' ? 'tricycle' : s.type === 'transfer' ? 'transfer' : 'walk',
    remainingM: distanceMeters(point, s.to),
    alert: null,
    offPath: off > P.offPathM,
    done: false,
    alerts: [...alerts],
    boarded,
  };
}
