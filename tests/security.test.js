// Security rules that must not quietly loosen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { originAllowed, rateLimited, handleAssistant } from '../api/_agent.js';
import { passwordProblem } from '../src/lib/account.js';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

describe('AI server: who may call it', () => {
  it('allows the real website and the phone apps', () => {
    for (const o of ['https://sakay-laguna.vercel.app', 'https://localhost', 'capacitor://localhost', undefined]) {
      expect(originAllowed(o)).toBe(true);
    }
  });

  it('blocks look-alike Vercel projects and local pages in production', () => {
    for (const o of ['https://sakay-laguna-evil.vercel.app', 'https://sakay-laguna.vercel.app.evil.com', 'http://192.168.1.5:5173', 'http://localhost:3000', 'null']) {
      expect(originAllowed(o)).toBe(false);
    }
  });

  it('allows local pages only on the dev server, and extra sites only when listed', () => {
    expect(originAllowed('http://192.168.1.5:5173', {}, true)).toBe(true);
    expect(originAllowed('https://preview.example', { ALLOWED_ORIGINS: 'https://preview.example' })).toBe(true);
  });

  it('refuses a blocked origin before doing any work', async () => {
    const r = await handleAssistant({ method: 'POST', origin: 'https://sakay-laguna-evil.vercel.app', ip: '1', body: {}, env: { GEMINI_API_KEY: 'x' } });
    expect(r.status).toBe(403);
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('limits each address to 12 questions a minute', () => {
    const t = Date.parse('2026-11-18T01:00:00Z');
    const ip = `test-${Math.random()}`;
    for (let i = 0; i < 12; i++) expect(rateLimited(ip, t + i)).toBe(false);
    expect(rateLimited(ip, t + 20)).toBe(true);
    expect(rateLimited(ip, t + 61_000)).toBe(false); // a minute later
  });
});

describe('passwords for new accounts', () => {
  it('needs 8+ characters and not a common or obvious one', () => {
    expect(passwordProblem('abc123')).toMatch(/8 characters/);
    expect(passwordProblem('password')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaa')).toMatch(/repeat/);
    expect(passwordProblem('juandelacruz99', 'juandelacruz@gmail.com')).toMatch(/email/);
    expect(passwordProblem('sakay sa umaga 7')).toBe('');
  });
});

describe('database rules (supabase/schema.sql)', () => {
  it('every table has row level security turned on', () => {
    const tables = [...schema.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
    for (const t of new Set(tables)) {
      expect(schema, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it('every privileged function fixes its search path', () => {
    const fns = schema.split(/create (?:or replace )?function /).slice(1);
    for (const f of fns) {
      const body = f.split('$$;')[0];
      if (/security definer/.test(body)) expect(body, f.slice(0, 40)).toMatch(/set search_path = ''/);
    }
  });

  it('only jeepneys on a trip are public, and admins need 2-step verification', () => {
    const last = (re) => [...schema.matchAll(re)].at(-1)?.[0] ?? '';
    expect(last(/create policy "anyone reads live locations"[\s\S]*?;/g)).toMatch(/is_active and updated_at > now\(\)/);
    expect(schema.lastIndexOf('drop policy if exists "anyone reads locations"')).toBeGreaterThan(schema.lastIndexOf('create policy "anyone reads locations"'));
    expect(last(/create or replace function public\.is_admin\(\)[\s\S]*?\$\$;/g)).toMatch(/aal2/);
    expect(last(/create or replace function public\.live_jeeps[\s\S]*?\$\$;/g)).toMatch(/now\(\) - interval '5 minutes'/);
  });
});

describe('website security headers (vercel.json)', () => {
  const all = vercel.headers.find((h) => h.source === '/(.*)').headers;
  const get = (k) => all.find((h) => h.key === k)?.value ?? '';
  it('blocks injected scripts and framing', () => {
    expect(get('Content-Security-Policy')).toMatch(/script-src 'self'(;|$)/);
    expect(get('Content-Security-Policy')).toMatch(/frame-ancestors 'none'/);
    expect(get('X-Frame-Options')).toBe('DENY');
    expect(get('X-Content-Type-Options')).toBe('nosniff');
  });
});
