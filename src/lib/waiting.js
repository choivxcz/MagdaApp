// "I'm waiting here": a passenger tells on-duty drivers where they're waiting
// and how many they are. Signals end by themselves after 20 minutes.
import { supabase } from './supabase.js';

function must({ data, error }) {
  if (error) throw error;
  return data;
}

// My current signal, or null.
export async function getMyWaiting() {
  const rows = must(
    await supabase
      .from('waiting_signals')
      .select('direction, lat, lng, people, created_at, expires_at')
      .gt('expires_at', new Date().toISOString())
      .limit(1),
  );
  const r = rows?.[0];
  return r ? { direction: r.direction, point: [r.lng, r.lat], people: r.people, expiresAt: new Date(r.expires_at) } : null;
}

export async function startWaiting({ routeId, direction, point, people }) {
  const expires = must(await supabase.rpc('wait_here', {
    p_route_id: routeId, p_direction: direction, p_lat: point[1], p_lng: point[0], p_people: people,
  }));
  return { direction, point, people, expiresAt: new Date(expires) };
}

export async function stopWaiting() {
  must(await supabase.rpc('stop_waiting'));
}

// For approved drivers: everyone waiting on this route (no names).
export async function fetchWaitingForDrivers(routeId) {
  const rows = must(await supabase.rpc('waiting_for_drivers', { p_route_id: routeId }));
  return (rows ?? []).map((r) => ({
    direction: r.direction, point: [r.lng, r.lat], people: r.people, minutesWaiting: r.minutes_waiting,
  }));
}
