// A driver's day, counted on the phone while trips run: km driven, time on
// trips and one-way trips finished. Feeds the earnings log. Kept for 31
// days on this phone only.
import { useSyncExternalStore } from 'react';

const KEY = 'sakay:driver-days:v1';
const KEEP_DAYS = 31;

// Today's date in the Philippines, as YYYY-MM-DD.
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

let state = load(); // { [userId]: { [date]: { km, seconds, trips } } }
const listeners = new Set();
let saveTimer = null;

function save() {
  // Many small updates while driving: write at most every few seconds.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  }, 3000);
  listeners.forEach((l) => l());
}

function bump(userId, patch) {
  const date = today();
  const days = { ...(state[userId] ?? {}) };
  const day = days[date] ?? { km: 0, seconds: 0, trips: 0 };
  days[date] = { km: day.km + (patch.km ?? 0), seconds: day.seconds + (patch.seconds ?? 0), trips: day.trips + (patch.trips ?? 0) };
  for (const d of Object.keys(days).sort().slice(0, -KEEP_DAYS)) delete days[d];
  state = { ...state, [userId]: days };
  save();
}

export const addDriving = (userId, meters, seconds) => bump(userId, { km: meters / 1000, seconds });
export const addTrip = (userId) => bump(userId, { trips: 1 });

export function useDriverDays(userId) {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  return s[userId] ?? {};
}

export const dayStats = (days, date = today()) => days[date] ?? { km: 0, seconds: 0, trips: 0 };
