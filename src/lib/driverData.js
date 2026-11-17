// Driver data stored online: the private earnings log and SOS alerts.
import { supabase } from './supabase.js';

function must({ data, error }) {
  if (error) {
    if (/driver_earnings|sos_alerts|admin_list_sos|admin_resolve_sos/.test(error.message) && /schema cache|does not exist|could not find/i.test(error.message)) {
      throw new Error('This feature isn’t switched on yet. (Admin: run npm run setup:db.)');
    }
    throw error;
  }
  return data;
}

const num = (v) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);

// ---- Earnings (boundary system) ----

export async function listEarnings(days = 31) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = must(await supabase.from('driver_earnings').select('*').gte('day', since).order('day', { ascending: false }));
  return rows.map((r) => ({
    day: r.day,
    gross: +r.gross,
    fuel: +r.fuel,
    boundary: +r.boundary,
    other: +r.other,
    trips: r.trips,
    km: +r.km,
    minutes: r.minutes,
    note: r.note ?? '',
  }));
}

export async function saveEarnings({ day, gross, fuel, boundary, other, trips, km, minutes, note }) {
  return must(await supabase.from('driver_earnings').upsert({
    day,
    gross: num(gross),
    fuel: num(fuel),
    boundary: num(boundary),
    other: num(other),
    trips: Math.min(200, Math.max(0, Math.round(trips || 0))),
    km: Math.min(2000, Math.max(0, Math.round((km || 0) * 10) / 10)),
    minutes: Math.min(1440, Math.max(0, Math.round(minutes || 0))),
    note: note?.trim().slice(0, 200) || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,day' }));
}

export async function deleteEarnings(day) {
  return must(await supabase.from('driver_earnings').delete().eq('day', day));
}

export const net = (e) => e.gross - e.fuel - e.boundary - e.other;

// ---- SOS ----

export async function sendSos(point) {
  return must(await supabase.from('sos_alerts').insert({
    lat: point ? +point[1].toFixed(6) : null,
    lng: point ? +point[0].toFixed(6) : null,
  }));
}

export async function adminListSos() {
  return must(await supabase.rpc('admin_list_sos'));
}

export async function adminResolveSos(id, status = 'resolved') {
  return must(await supabase.rpc('admin_resolve_sos', { p_id: id, p_status: status }));
}

export const mapsLink = (point) => (point ? `https://maps.google.com/?q=${point[1].toFixed(6)},${point[0].toFixed(6)}` : '');
