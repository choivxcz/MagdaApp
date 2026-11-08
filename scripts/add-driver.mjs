// Creates (or updates) an approved driver account.
// Usage:
//   npm run driver:add -- --email juan@example.com --password "secret123" \
//     --name "Juan Dela Cruz" --plate "DXY 123" --seats 20
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { need } from './env.mjs';

const { VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = need('VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

const { values: a } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    plate: { type: 'string' },
    seats: { type: 'string', default: '20' },
    disable: { type: 'boolean', default: false },
  },
});

if (!a.email || (!a.disable && (!a.password || !a.name || !a.plate))) {
  console.log('Usage: npm run driver:add -- --email E --password P --name "Full Name" --plate "ABC 123" [--seats 20]');
  console.log('       npm run driver:add -- --email E --disable     (removes approval)');
  process.exit(1);
}

const admin = createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit || data.users.length < 200) return hit ?? null;
  }
  return null;
}

try {
  let user = await findUserByEmail(a.email);

  if (a.disable) {
    if (!user) throw new Error('No account with that email.');
    const { error } = await admin.from('drivers').update({ approved: false }).eq('user_id', user.id);
    if (error) throw error;
    await admin.from('jeepney_locations').update({ is_active: false }).eq('driver_id', user.id);
    console.log(`✓ ${a.email} can no longer share location.`);
    process.exit(0);
  }

  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: a.password, email_confirm: true });
    if (error) throw error;
    console.log(`Account exists; password updated for ${a.email}.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true });
    if (error) throw error;
    user = data.user;
    console.log(`Created account ${a.email}.`);
  }

  const seats = Number(a.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 40) throw new Error('--seats must be a whole number from 1 to 40.');

  const { error } = await admin.from('drivers').upsert({
    user_id: user.id,
    full_name: a.name,
    plate: a.plate.toUpperCase(),
    seat_capacity: seats,
    approved: true,
  });
  if (error) throw error;

  console.log(`✓ Approved driver: ${a.name}, plate ${a.plate.toUpperCase()}, ${seats} seats.`);
  console.log('  They can now open the app, tap "Driver", and sign in with that email and password.');
} catch (e) {
  console.error('\nFailed:', e.message);
  if (/relation .* does not exist|schema cache/i.test(e.message)) console.error('Run "npm run setup:db" first.');
  process.exitCode = 1;
}
