// Loads .env.local and checks the values the scripts need.
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export function need(...names) {
  const missing = names.filter((n) => !process.env[n] || process.env[n].includes('YOUR-') || process.env[n].endsWith('...'));
  if (missing.length) {
    console.error(`\nMissing in .env.local: ${missing.join(', ')}`);
    console.error('Copy .env.local.example to .env.local and fill it in (see README.md).\n');
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n].trim()]));
}

// Encrypted connection to the database. With SUPABASE_DB_CA set to the
// Supabase certificate file (Dashboard → Project Settings → Database →
// SSL Configuration → Download certificate), the server's identity is also
// checked, so nobody on the same Wi-Fi can pretend to be the database.
// Without it the connection is still encrypted, but not verified.
export function dbSsl() {
  const ca = process.env.SUPABASE_DB_CA?.trim();
  if (ca && existsSync(ca)) return { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true };
  if (!dbSsl.warned) {
    dbSsl.warned = true;
    console.warn('(Tip: set SUPABASE_DB_CA in .env.local to verify the database certificate. See SECURITY.md.)');
  }
  return { rejectUnauthorized: false };
}
