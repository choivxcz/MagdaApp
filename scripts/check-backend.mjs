// End-to-end check of the live backend, using a temporary test driver.
// It proves the security rules work, then deletes the test account.
// Usage: npm run check
import { createClient } from '@supabase/supabase-js';
import { need } from './env.mjs';

const env = need('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, opts);

const email = `selftest-${Date.now()}@sakay-laguna.test`;
const password = `T3st-${Math.random().toString(36).slice(2)}!`;
let userId = null;
let failures = 0;

function check(ok, label, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const location = (extra = {}) => ({
  direction: 'to_santa_cruz', lat: 14.2725, lng: 121.4199, seats_taken: 5, is_active: true, ...extra,
});

try {
  console.log('Backend check:', env.VITE_SUPABASE_URL);

  // Riders (not signed in) can read positions.
  let r = await anon.from('jeepney_locations').select('driver_id').limit(1);
  check(!r.error, 'Riders can read jeepney positions', r.error?.message);

  // Riders cannot write.
  r = await anon.from('jeepney_locations').insert({ driver_id: crypto.randomUUID(), route_id: 'x', plate: 'x', ...location() });
  check(!!r.error, 'Riders cannot post fake jeepneys');

  // Riders cannot see the drivers list.
  r = await anon.from('drivers').select('user_id');
  check(!r.error && r.data.length === 0, 'Driver records are private', r.error?.message);

  // Make a test account that is NOT approved yet.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  r = await admin.from('drivers').insert({ user_id: userId, full_name: 'Self Test', plate: 'TEST 001', seat_capacity: 16, approved: false });
  if (r.error) throw r.error;

  const driver = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, opts);
  const signIn = await driver.auth.signInWithPassword({ email, password });
  check(!signIn.error, 'Driver can sign in', signIn.error?.message);

  r = await driver.from('jeepney_locations').upsert({ driver_id: userId, ...location() }, { onConflict: 'driver_id' });
  check(!!r.error, 'Unapproved driver cannot share location');

  // Photos: each user may only upload their own avatar.jpg / jeepney.jpg.
  const photo = () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const up = (path) => driver.storage.from('photos').upload(path, photo(), { upsert: true, contentType: 'image/jpeg' });
  r = await up(`${userId}/avatar.jpg`);
  check(!r.error, 'User can upload a profile picture', r.error?.message);
  r = await up(`${userId}/avatar.jpg`);
  check(!r.error, 'User can replace their profile picture', r.error?.message);
  r = await up(`${userId}/jeepney.jpg`);
  check(!r.error, 'Driver can upload a jeepney photo', r.error?.message);
  r = await up(`${crypto.randomUUID()}/avatar.jpg`);
  check(!!r.error, "User cannot upload someone else's photo");
  r = await up(`${userId}/other.jpg`);
  check(!!r.error, 'Only the two photo names are allowed');
  r = await anon.rpc('driver_card', { p_driver_id: userId }).maybeSingle();
  check(!r.error && !r.data, 'Unapproved drivers have no public card', r.error?.message ?? JSON.stringify(r.data));

  // Approve, then share a position with a fake plate and too many seats.
  await admin.from('drivers').update({ approved: true }).eq('user_id', userId);
  r = await driver.from('jeepney_locations').upsert(
    { driver_id: userId, plate: 'FAKE 999', route_id: 'fake', ...location({ seats_taken: 999 }) },
    { onConflict: 'driver_id' },
  );
  check(!r.error, 'Approved driver can share location', r.error?.message);

  r = await anon.from('jeepney_locations').select('*').eq('driver_id', userId).single();
  check(!r.error, 'Riders see the shared jeepney', r.error?.message);
  if (r.data) {
    check(r.data.plate === 'TEST 001', 'Plate comes from the driver record, not the phone', `got ${r.data.plate}`);
    check(r.data.route_id === 'magdalena-santa-cruz', 'Route comes from the driver record', `got ${r.data.route_id}`);
    check(r.data.seats_total === 16 && r.data.seats_taken === 16, 'Seats are capped at capacity', `got ${r.data.seats_taken}/${r.data.seats_total}`);
    check(Math.abs(Date.parse(r.data.updated_at) - Date.now()) < 60000, 'Server sets the update time');
  }

  // Riders (not signed in) see the driver's card and photos.
  r = await anon.rpc('driver_card', { p_driver_id: userId }).maybeSingle();
  check(!r.error && r.data?.plate === 'TEST 001' && r.data.avatar_v > 0 && r.data.jeepney_v > 0,
    'Riders see the driver card with both photos', r.error?.message ?? JSON.stringify(r.data));
  check(r.data && !('phone' in r.data) && !('license_no' in r.data), 'Driver card hides phone and license');
  const res = await fetch(anon.storage.from('photos').getPublicUrl(`${userId}/jeepney.jpg`).data.publicUrl);
  check(res.ok, 'Photos load from their public link', `HTTP ${res.status}`);

  // "I'm waiting here": signed-in passengers only; approved drivers see spots without names.
  const spot = { p_route_id: 'magdalena-santa-cruz', p_direction: 'to_santa_cruz', p_lat: 14.23456, p_lng: 121.43219, p_people: 3 };
  const isTestSpot = (w) => Math.abs(w.lat - 14.2346) < 1e-6 && Math.abs(w.lng - 121.4322) < 1e-6;
  r = await anon.rpc('wait_here', spot);
  check(!!r.error, 'Guests cannot send a waiting signal');
  r = await driver.rpc('wait_here', spot);
  check(!r.error, 'Signed-in passenger can say "I\'m waiting here"', r.error?.message);
  r = await anon.rpc('waiting_for_drivers', { p_route_id: 'magdalena-santa-cruz' });
  check(!!r.error || !(r.data ?? []).length, 'Guests cannot see who is waiting');
  r = await driver.rpc('waiting_for_drivers', { p_route_id: 'magdalena-santa-cruz' });
  const seen = (r.data ?? []).find(isTestSpot);
  check(!r.error && seen?.people === 3, 'Drivers see the waiting spot and group size', r.error?.message ?? JSON.stringify(r.data));
  check(seen && !('user_id' in seen), 'Drivers do not see who is waiting');
  r = await driver.rpc('stop_waiting');
  r = await driver.rpc('waiting_for_drivers', { p_route_id: 'magdalena-santa-cruz' });
  check(!r.error && !(r.data ?? []).some(isTestSpot), 'Passenger can cancel the waiting signal', r.error?.message);

  // A driver cannot move someone else's jeepney.
  r = await driver.from('jeepney_locations').upsert({ driver_id: crypto.randomUUID(), ...location() }, { onConflict: 'driver_id' });
  check(!!r.error, "Driver cannot post as another jeepney");

  // End trip.
  r = await driver.from('jeepney_locations').update({ is_active: false, seats_taken: 0 }).eq('driver_id', userId);
  check(!r.error, 'Driver can end the trip', r.error?.message);
} catch (e) {
  failures++;
  console.error('\nCheck stopped:', e.message);
  if (/schema cache|does not exist/i.test(e.message)) console.error('Run "npm run setup:db" first.');
} finally {
  if (userId) {
    await admin.storage.from('photos').remove([`${userId}/avatar.jpg`, `${userId}/jeepney.jpg`]).catch(() => {});
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed. The backend is working.');
  process.exitCode = failures ? 1 : 0;
}
