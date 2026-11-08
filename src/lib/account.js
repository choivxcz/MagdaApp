// Commuter account data: profile, saved trips, ride reports.
import { supabase } from './supabase.js';

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

export async function saveTrip({ name, direction, pickupStopId, dropoffStopId }) {
  return must(
    await supabase
      .from('saved_trips')
      .insert({ name, direction, pickup_stop_id: pickupStopId, dropoff_stop_id: dropoffStopId })
      .select()
      .single(),
  );
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

export async function deleteMyAccount() {
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
