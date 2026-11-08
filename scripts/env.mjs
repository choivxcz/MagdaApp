// Loads .env.local and checks the values the scripts need.
import { existsSync } from 'node:fs';

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
