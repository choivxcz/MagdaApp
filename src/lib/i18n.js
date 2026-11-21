// Languages (like DavaoGo): English, Tagalog and Bisaya.
//
// t('Where are you?') returns the text in the chosen language; English is
// the key, so anything not translated yet simply shows in English. Values
// can be filled in: t('{d} left', { d: '300 m' }).
//
// Only the chosen language's words are downloaded (a few KB), once.
import { useSyncExternalStore } from 'react';
import { getPrefs } from './prefs.js';

export const LANGUAGES = {
  en: { name: 'English', native: 'English' },
  tl: { name: 'Tagalog', native: 'Tagalog' },
  ceb: { name: 'Bisaya', native: 'Bisaya (Cebuano)' },
};

const LOADERS = {
  tl: () => import('./i18n/tl.js'),
  ceb: () => import('./i18n/ceb.js'),
};

let state = { lang: 'en', dict: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function setLanguage(lang) {
  const code = LANGUAGES[lang] ? lang : 'en';
  if (code === 'en') { state = { lang: 'en', dict: null }; emit(); return Promise.resolve(); }
  if (state.lang === code && state.dict) return Promise.resolve();
  return LOADERS[code]().then((m) => {
    if ((getPrefs().lang ?? 'en') !== code) return; // changed again meanwhile
    state = { lang: code, dict: m.default };
    if (typeof document !== 'undefined') document.documentElement.lang = code === 'tl' ? 'fil' : code;
    emit();
  }).catch(() => {});
}

// For tests and the AI server: use a dictionary directly.
export function useDictionary(lang, dict) {
  state = { lang, dict };
  emit();
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);

export function t(text, vars) {
  const s = state.dict?.[text];
  return fill(typeof s === 'string' && s ? s : text, vars);
}

export const currentLanguage = () => state.lang;

// "Street · Poblacion, Magdalena" -> each known part translated, names kept.
export const tParts = (text) => (text ? String(text).split(' · ').map((p) => t(p)).join(' · ') : text);

// Re-render when the language (or its words) change.
export function useLanguage() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state.lang + (state.dict ? '+' : ''), () => 'en');
}
