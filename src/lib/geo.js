// Distance and "how far along the route" helpers.
// Coordinates are [lng, lat], the same order MapLibre and GeoJSON use.

const R = 6371000; // Earth radius in meters
const toRad = (d) => (d * Math.PI) / 180;

export function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Precomputes cumulative distance at every point of one line.
function prepareLine(line) {
  const coords = line.coordinates;
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceMeters(coords[i - 1], coords[i]));
  }
  return { ...line, cumulative, length: cumulative[cumulative.length - 1] };
}

const STOP_MAX_OFF_ROUTE_M = 250;

// A route has two legs (one per direction). Each leg gets its distances
// and the stops it passes, in riding order.
export function prepareRoute(route) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const legs = {};
  for (const [direction, raw] of Object.entries(route.legs)) {
    const leg = prepareLine({ ...raw, direction });
    leg.stops = route.stops
      .map((s) => ({ ...s, ...projectOnRoute(leg, s.coord) }))
      .filter((s) => s.offRoute <= STOP_MAX_OFF_ROUTE_M)
      .sort((a, b) => a.along - b.along);
    for (const [x, y] of leg.coordinates) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    legs[direction] = leg;
  }
  return { ...route, legs, bounds: [[minX, minY], [maxX, maxY]] };
}

// Snaps a point to the nearest spot on a leg.
// Returns how far along the leg that spot is (meters from its start)
// and how far the point is from the line.
export function projectOnRoute(route, point) {
  const coords = route.coordinates;
  // Flat approximation is accurate enough over a few kilometers.
  const kx = Math.cos(toRad(point[1])) * 111320;
  const ky = 110540;
  let best = { along: 0, offRoute: Infinity, point: coords[0] };

  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const dx = (bx - ax) * kx, dy = (by - ay) * ky;
    const px = (point[0] - ax) * kx, py = (point[1] - ay) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const ex = px - t * dx, ey = py - t * dy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best.offRoute) {
      const segLen = route.cumulative[i] - route.cumulative[i - 1];
      best = {
        along: route.cumulative[i - 1] + t * segLen,
        offRoute: d,
        point: [ax + (bx - ax) * t, ay + (by - ay) * t],
      };
    }
  }
  return best;
}

// The point that is `along` meters from the start of the route.
export function pointAlong(route, along) {
  const { coordinates: c, cumulative: cum } = route;
  const d = Math.max(0, Math.min(route.length, along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / seg;
  return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
}
