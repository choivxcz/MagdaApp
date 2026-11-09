// Creates the tables, security rules and triggers in your Supabase project.
// Usage: npm run setup:db   (safe to run again)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { need } from './env.mjs';

const { SUPABASE_DB_URL } = need('SUPABASE_DB_URL');
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

const client = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Connected to the database. Applying supabase/schema.sql…');
  await client.query(sql);
  // Tell the API to pick up the new tables right away.
  await client.query("notify pgrst, 'reload schema'");

  const { rows } = await client.query(`
    select c.relname as table, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('drivers', 'jeepney_locations')
     order by 1`);
  for (const r of rows) console.log(`  ✓ ${r.table} (row level security: ${r.rls ? 'on' : 'OFF'})`);
  const bucket = await client.query("select public from storage.buckets where id = 'photos'");
  console.log(bucket.rows.length ? '  ✓ photos storage (profile and jeepney pictures)' : '  ✗ photos storage is missing');
  console.log('Database is ready.');
} catch (e) {
  console.error('\nSetup failed:', e.message);
  if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(e.message)) {
    console.error('Tip: use the "Session pooler" connection string from Supabase -> Connect, not the "Direct" one.');
  }
  if (/password/i.test(e.message)) {
    console.error('Tip: check the database password in SUPABASE_DB_URL (Project Settings -> Database -> Reset password).');
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
