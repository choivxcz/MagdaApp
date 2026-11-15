// Commuter account data: profile, saved trips and places, ride reports.
import { supabase } from './supabase.js';
import { removeAllMyPhotos } from './photos.js';

function must({ data, error }) {
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId) {
  return must(await supabase.from('profiles').select('full_name, fare_type').eq('id', userId).maybeSingle());
}

export async function updateProfile(userId, patch) {
  return must(await supabase.from('profiles').update(patch).eq('id', userId));
}

export async function listSavedTrips() {
  return must(await supabase.from('saved_trips').select('*').order('created_at', { ascending: false }));
}

// A trip between any two places. Stops are saved by id (so they follow
// route edits); other places by their label and coordinates.
// direction is only filled in for simple stop-to-stop rides (older app versions read it).
export async function saveTrip({ name, from, to, direction = null }) {
  const pt = (p) => (p.stopId ? [null, null] : [+p.point[1].toFixed(6), +p.point[0].toFixed(6)]);
  const [fromLat, fromLng] = pt(from);
  const [toLat, toLng] = pt(to);
  return must(
    await supabase
      .from('saved_trips')
      .insert({
        name: name.slice(0, 60),
        direction,
        pickup_stop_id: from.stopId ?? null,
        dropoff_stop_id: to.stopId ?? null,
        from_label: from.stopId ? null : from.label.slice(0, 80),
        from_lat: fromLat,
        from_lng: fromLng,
        to_label: to.stopId ? null : to.label.slice(0, 80),
        to_lat: toLat,
        to_lng: toLng,
      })
      .select()
      .single(),
  );
}

// Turns a saved_trips row back into { from, to } places (null if a stop is gone).
export function tripPlaces(row, route) {
  const place = (stopId, label, lat, lng) => {
    if (stopId) {
      const s = route.stops.find((x) => x.id === stopId);
      return s ? { kind: 'stop', stopId: s.id, label: s.name, point: s.coord, icon: s.icon } : null;
    }
    return lat != null && lng != null ? { kind: 'place', label: label || 'Saved place', point: [lng, lat] } : null;
  };
  return {
    from: place(row.pickup_stop_id, row.from_label, row.from_lat, row.from_lng),
    to: place(row.dropoff_stop_id, row.to_label, row.to_lat, row.to_lng),
  };
}

// ---- Saved places (Home, School, Work...) ----

export const PLACE_KINDS = {
  home: { label: 'Home', icon: 'home' },
  school: { label: 'School', icon: 'school' },
  work: { label: 'Work', icon: 'work' },
  other: { label: 'Place', icon: 'star' },
};

export async function listSavedPlaces() {
  const rows = must(await supabase.from('saved_places').select('*').order('created_at', { ascending: true }));
  return rows.map((r) => ({
    id: r.id,
    kind: 'saved',
    placeKind: r.kind,
    label: r.label,
    sub: PLACE_KINDS[r.kind]?.label ?? 'Saved place',
    point: [r.lng, r.lat],
    stopId: r.stop_id ?? null,
    icon: PLACE_KINDS[r.kind]?.icon ?? 'star',
  }));
}

// Home, School and Work are one each: saving a new Home replaces the old one.
export async function savePlace({ placeKind, label, point, stopId }) {
  if (placeKind !== 'other') must(await supabase.from('saved_places').delete().eq('kind', placeKind));
  return must(await supabase.from('saved_places').insert({
    kind: placeKind,
    label: label.slice(0, 60),
    lat: +point[1].toFixed(6),
    lng: +point[0].toFixed(6),
    stop_id: stopId ?? null,
  }));
}

export async function deleteSavedPlace(id) {
  return must(await supabase.from('saved_places').delete().eq('id', id));
}

export async function deleteSavedTrip(id) {
  return must(await supabase.from('saved_trips').delete().eq('id', id));
}

export async function fileReport({ plate, category, details }) {
  return must(await supabase.from('ride_reports').insert({ plate: plate || null, category, details: details || null }));
}

export async function listMyReports() {
  return must(await supabase.from('ride_reports').select('*').order('created_at', { ascending: false }).limit(20));
}

export async function deleteMyAccount(userId) {
  // Photos are files, not table rows, so remove them first.
  await removeAllMyPhotos(userId).catch(() => {});
  must(await supabase.rpc('delete_my_account'));
  // The account is gone on the server, so only clear this phone's session.
  await supabase.auth.signOut({ scope: 'local' });
}

// Turns Supabase sign-in errors into plain language.
export function friendlyAuthError(e) {
  const m = e?.message || String(e);
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox (and spam folder).';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Try signing in.';
  if (/email rate limit/i.test(m)) {
    return 'We can’t send more emails right now (hourly email limit reached). Please try again in an hour.';
  }
  if (/error sending/i.test(m)) {
    return 'We couldn’t send the email. The app’s email settings have a problem; please tell the admin.';
  }
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/password should be at least/i.test(m)) return 'Password must be at least 6 characters.';
  if (/failed to fetch|network/i.test(m)) return 'No internet connection. Please try again.';
  return m;
}

// ---- Driver applications ----

export async function applyAsDriver({ fullName, plate, seats, phone, licenseNo, franchiseNo }) {
  return must(await supabase.rpc('apply_as_driver', {
    p_full_name: fullName,
    p_plate: plate,
    p_seat_capacity: seats,
    p_phone: phone || null,
    p_license_no: licenseNo || null,
    p_franchise_no: franchiseNo || null,
  }));
}

// ---- Admin ----

export async function fetchIsAdmin(userId) {
  const data = must(await supabase.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle());
  return !!data;
}

export async function adminListDrivers() {
  return must(await supabase.rpc('admin_list_drivers'));
}

export async function adminReviewDriver(userId, status, note) {
  return must(await supabase.rpc('admin_review_driver', { p_user_id: userId, p_status: status, p_note: note ?? null }));
}

export async function adminListReports() {
  return must(await supabase.from('ride_reports').select('*').order('created_at', { ascending: false }).limit(100));
}

export async function adminSetReportStatus(id, status) {
  return must(await supabase.rpc('admin_set_report_status', { p_id: id, p_status: status }));
}
