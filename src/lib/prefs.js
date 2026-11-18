// Small settings store kept on the phone (works for guests too).
import { useSyncExternalStore } from 'react';

const KEY = 'sakay:prefs:v1';
const DEFAULTS = {
  onboarded: false,
  guest: false,
  fareType: 'regular',
  theme: 'system',
  showLandmarks: true,
  dataSaver: 'auto', // 'auto' (follow the phone) | 'on' | 'off'
  haptics: true,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set();

export function setPrefs(patch) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: settings last until the app closes.
  }
  listeners.forEach((l) => l());
}

export const getPrefs = () => state;

export function usePrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

// ---- Data saver ----------------------------------------------------------
// "Auto" turns it on when the phone's own Data Saver is on, or the
// connection is very slow (2G).
const connection = () => (typeof navigator !== 'undefined' ? navigator.connection : null);
export const phoneWantsSavings = () => {
  const c = connection();
  return !!c && (c.saveData === true || ['slow-2g', '2g'].includes(c.effectiveType));
};
export const isDataSaver = (p = state) => p.dataSaver === 'on' || (p.dataSaver === 'auto' && phoneWantsSavings());
export const useDataSaver = () => isDataSaver(usePrefs());
