// Makes an existing account an admin (can approve drivers and see reports).
// The person must sign up in the app first.
// Usage: npm run admin:add -- --email you@gmail.com        (add)
//        npm run admin:add -- --email you@gmail.com --remove
//        npm run admin:add -- --list
import { parseArgs } from 'node:util';
import pg from 'pg';
import { need } from './env.mjs';

const { SUPABASE_DB_URL } = need('SUPABASE_DB_URL');
const { values: a } = parseArgs({ options: { email: { type: 'string' }, remove: { type: 'boolean' }, list: { type: 'boolean' } } });

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  if (a.list || !a.email) {
    const { rows } = await db.query('select u.email from public.app_admins a join auth.users u on u.id = a.user_id order by a.created_at');
    console.log(rows.length ? `Admins:\n${rows.map((r) => `  ${r.email}`).join('\n')}` : 'No admins yet.');
    if (!a.email && !a.list) console.log('\nUsage: npm run admin:add -- --email you@gmail.com');
  } else {
    const { rows } = await db.query('select id from auth.users where lower(email) = lower($1)', [a.email]);
    if (!rows.length) throw new Error(`No account with ${a.email}. Sign up in the app first.`);
    if (a.remove) {
      await db.query('delete from public.app_admins where user_id = $1', [rows[0].id]);
      console.log(`✓ ${a.email} is no longer an admin.`);
    } else {
      await db.query('insert into public.app_admins (user_id) values ($1) on conflict do nothing', [rows[0].id]);
      console.log(`✓ ${a.email} is now an admin. In the app: More → Admin tools.`);
    }
  }
} catch (e) {
  console.error('Failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
