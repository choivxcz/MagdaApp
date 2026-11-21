// Every phrase the app shows has Tagalog and Bisaya words (except the long
// privacy/about text, which stays English, and lines already in Tagalog).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectKeys } from '../scripts/i18n-keys.mjs';
import tl from '../src/lib/i18n/tl.js';
import ceb from '../src/lib/i18n/ceb.js';
import phrases from '../src/lib/i18n/phrases.js';

// Lines in the driver lock screen that are already Tagalog (they pick a language themselves).
const ALREADY_TAGALOG = new Set(['Huling biyahe', 'Iba pa', 'Jeep sa likod', 'Jeep sa unahan', 'Konduktor? I-unlock', 'Naghihintay sa unahan',
  'Nagmamaneho', 'Bakanteng upuan', 'Naka-lock habang umaandar. Babalik ang mga button pag huminto.', 'Puno', 'Wala pa', 'Itanong mo dito… / Ask here…']);

const more = readFileSync(new URL('../src/screens/MoreScreen.jsx', import.meta.url), 'utf8');
const body = (name) => {
  const a = more.indexOf(`function ${name}(`);
  const b = more.indexOf('\nfunction ', a + 10);
  return more.slice(a, b > 0 ? b : undefined);
};
const englishOnlyText = body('Privacy') + body('About');
const rest = more.replace(body('Privacy'), '').replace(body('About'), '');
const usedIn = (key, text) => text.includes(JSON.stringify(key)) || text.includes(`'${key}'`);

describe('translations', () => {
  const keys = collectKeys();
  const needed = keys.filter((k) => !ALREADY_TAGALOG.has(k) && !(usedIn(k, englishOnlyText) && !usedIn(k, rest)));

  it('finds the app’s phrases', () => {
    expect(keys.length).toBeGreaterThan(600);
  });

  it('has Tagalog for every phrase on screen', () => {
    expect(needed.filter((k) => !tl[k])).toEqual([]);
  });

  it('has Bisaya for every phrase on screen', () => {
    expect(needed.filter((k) => !ceb[k])).toEqual([]);
  });

  it('keeps the {placeholders} in every translation', () => {
    for (const [en, ...tr] of phrases) {
      const want = (en.match(/\{\w+\}/g) ?? []).sort().join();
      for (const x of tr.filter(Boolean)) expect((x.match(/\{\w+\}/g) ?? []).sort().join(), `${en} -> ${x}`).toBe(want);
    }
  });

  it('has no phrase listed twice with different words', () => {
    const seen = new Map();
    for (const [en, a, b] of phrases) {
      if (seen.has(en)) expect(seen.get(en), en).toEqual([a, b]);
      seen.set(en, [a, b]);
    }
  });
});
