// Reading and writing jeepney positions and seats.
// Riders POLL this table every few seconds instead of holding a live
// connection, so the free plan's 200-connection limit does not apply.
import { supabase } from './supabase.js';
import { demoJeepneys } from './demo.js';

const STALE_AFTER_MS = 2 * 60 * 1000; // hide jeepneys silent for 2+ minutes
const BASE_COLUMNS = 'driver_id, plate, direction, lat, lng, seats_total, seats_taken, updated_at';
const STATUS_COLUMNS = 'trip_status, last_trip';

// Until `npm run setup:db` adds the trip status columns, read and write
// without them so the map keeps working.
let hasStatusColumns = true;
const missingColumn = (error) => /trip_status|last_trip/.test(error?.message ?? '') && /column|schema cache/i.test(error.message);

export async function fetchActiveJeepneys(route) {
  if (!supabase) return demoJeepneys(route);

  const since = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const query = (columns) => supabase
    .from('jeepney_locations')
    .select(columns)
    .eq('route_id', route.id)
    .eq('is_active', true)
    .gte('updated_at', since);
  let { data, error } = await query(hasStatusColumns ? `${BASE_COLUMNS}, ${STATUS_COLUMNS}` : BASE_COLUMNS);
  if (error && hasStatusColumns && missingColumn(error)) {
    hasStatusColumns = false;
    ({ data, error } = await query(BASE_COLUMNS));
  }
  if (error) throw error;

  return data.map((r) => ({
    id: r.driver_id,
    plate: r.plate,
    direction: r.direction,
    lat: r.lat,
    lng: r.lng,
    seatsTotal: r.seats_total,
    seatsTaken: r.seats_taken,
    tripStatus: r.trip_status ?? 'on_trip',
    lastTrip: !!r.last_trip,
    updatedAt: new Date(r.updated_at),
  }));
}

// Plate number, route and seat capacity are filled in by the database
// from the driver's approved record, so a driver cannot fake them.
export async function sendLocation({ userId, direction, coords, seatsTaken, tripStatus = 'on_trip', lastTrip = false }) {
  const row = {
    driver_id: userId,
    direction,
    lat: coords.latitude,
    lng: coords.longitude,
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
    speed: Number.isFinite(coords.speed) ? coords.speed : null,
    accuracy: coords.accuracy ?? null,
    seats_taken: seatsTaken,
    is_active: true,
  };
  const upsert = (r) => supabase.from('jeepney_locations').upsert(r, { onConflict: 'driver_id' });
  let { error } = await upsert(hasStatusColumns ? { ...row, trip_status: tripStatus, last_trip: lastTrip } : row);
  if (error && hasStatusColumns && missingColumn(error)) {
    hasStatusColumns = false;
    ({ error } = await upsert(row));
  }
  if (error) throw error;
}

export async function endTrip(userId) {
  const reset = { is_active: false, seats_taken: 0 };
  const update = (r) => supabase.from('jeepney_locations').update(r).eq('driver_id', userId);
  let { error } = await update(hasStatusColumns ? { ...reset, trip_status: 'on_trip', last_trip: false } : reset);
  if (error && hasStatusColumns && missingColumn(error)) {
    hasStatusColumns = false;
    ({ error } = await update(reset));
  }
  if (error) throw error;
}

export async function fetchDriverProfile(userId) {
  const { data, error } = await supabase
    .from('drivers')
    .select('full_name, plate, route_id, seat_capacity, approved, status, review_note, phone, license_no, franchise_no')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
