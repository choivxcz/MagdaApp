// Reading and writing jeepney positions and seats.
// Riders POLL this table every few seconds instead of holding a live
// connection, so the free plan's 200-connection limit does not apply.
import { supabase } from './supabase.js';
import { demoJeepneys } from './demo.js';

const STALE_AFTER_MS = 2 * 60 * 1000; // hide jeepneys silent for 2+ minutes

export async function fetchActiveJeepneys(route) {
  if (!supabase) return demoJeepneys(route);

  const since = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await supabase
    .from('jeepney_locations')
    .select('driver_id, plate, direction, lat, lng, seats_total, seats_taken, updated_at')
    .eq('route_id', route.id)
    .eq('is_active', true)
    .gte('updated_at', since);
  if (error) throw error;

  return data.map((r) => ({
    id: r.driver_id,
    plate: r.plate,
    direction: r.direction,
    lat: r.lat,
    lng: r.lng,
    seatsTotal: r.seats_total,
    seatsTaken: r.seats_taken,
    updatedAt: new Date(r.updated_at),
  }));
}

// Plate number, route and seat capacity are filled in by the database
// from the driver's approved record, so a driver cannot fake them.
export async function sendLocation({ userId, direction, coords, seatsTaken }) {
  const { error } = await supabase.from('jeepney_locations').upsert(
    {
      driver_id: userId,
      direction,
      lat: coords.latitude,
      lng: coords.longitude,
      heading: Number.isFinite(coords.heading) ? coords.heading : null,
      speed: Number.isFinite(coords.speed) ? coords.speed : null,
      accuracy: coords.accuracy ?? null,
      seats_taken: seatsTaken,
      is_active: true,
    },
    { onConflict: 'driver_id' },
  );
  if (error) throw error;
}

export async function endTrip(userId) {
  const { error } = await supabase
    .from('jeepney_locations')
    .update({ is_active: false, seats_taken: 0 })
    .eq('driver_id', userId);
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
