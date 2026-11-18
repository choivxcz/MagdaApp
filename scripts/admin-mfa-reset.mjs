// Removes an admin's 2-step verification (authenticator app), for when they
// lost their phone. They set it up again in More → Admin tools.
// Only run this after confirming it's really them (call them, meet them).
// Usage: npm run admin:mfa-reset -- --email admin@example.com
import { parseArgs } from 'node:util';
import pg from 'pg';
import { need, dbSsl } from './env.mjs';

const { SUPABASE_DB_URL } = need('SUPABASE_DB_URL');
const { values: a } = parseArgs({ options: { email: { type: 'string' } } });
if (!a.email) {
  console.log('Usage: npm run admin:mfa-reset -- --email admin@example.com');
  process.exit(1);
}

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: dbSsl() });
await db.connect();
try {
  const { rows } = await db.query('select id from auth.users where lower(email) = lower($1)', [a.email]);
  if (!rows.length) throw new Error(`No account with ${a.email}.`);
  const { rowCount } = await db.query('delete from auth.mfa_factors where user_id = $1', [rows[0].id]);
  console.log(rowCount
    ? `✓ Removed ${rowCount} authenticator(s) for ${a.email}. They can set up a new one in More → Admin tools.`
    : `${a.email} had no authenticator set up.`);
} catch (e) {
  console.error('Failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
