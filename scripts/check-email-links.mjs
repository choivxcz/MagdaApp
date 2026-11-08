// Checks where Supabase sends people after they tap an email link.
// It creates a temporary account, makes a sign-up link for it, follows the
// link one step, and reports the redirect address. Then it deletes the account.
// Usage: npm run check:links
import { createClient } from '@supabase/supabase-js';
import { need } from './env.mjs';

const env = need('VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const targets = {
  'Phone app': 'ph.sakaylaguna.app://auth/callback',
  'Website (iPhone & computers)': 'https://sakay-laguna.vercel.app/',
  'Website on this computer': 'http://localhost:5173/',
};

let ok = true;
for (const [label, redirectTo] of Object.entries(targets)) {
  const email = `linkcheck-${Date.now()}@sakaylaguna.test`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup', email, password: `Lc-${Math.random().toString(36).slice(2)}!`, options: { redirectTo },
  });
  if (error) { console.log(`✗ ${label}: ${error.message}`); ok = false; continue; }

  const res = await fetch(data.properties.action_link, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const landed = location.split('#')[0].split('?')[0];
  const good = location.startsWith(redirectTo) && /access_token=/.test(location);
  console.log(`${good ? '✓' : '✗'} ${label}: link goes to ${landed || '(nowhere)'}${good ? '' : `  (expected ${redirectTo})`}`);
  if (!good) ok = false;
  await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
}

if (!ok) {
  console.log('\nFix: Supabase -> Authentication -> URL Configuration -> Redirect URLs -> Add URL:');
  for (const t of Object.values(targets)) console.log(`   ${t}`);
}
process.exitCode = ok ? 0 : 1;
