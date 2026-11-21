// Settings the admin sets in the app (schema section 16): the usual first
// and last trip times of each direction, and contact / support details.
// Kept on the phone for 12 hours, so they cost almost no load.
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase.js';

const KEY = 'sakay:settings:v1';
const MAX_AGE = 12 * 60 * 60 * 1000;

let state = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') ?? { value: {}, at: 0 }; } catch { return { value: {}, at: 0 }; }
})();
const listeners = new Set();
let loading = null;

export async function refreshSettings() {
  if (!supabase) return;
  loading ??= (async () => {
    try {
      const { data, error } = await supabase.rpc('get_app_settings');
      if (error) throw error;
      state = { value: data ?? {}, at: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage off */ }
      listeners.forEach((l) => l());
    } catch { /* keep what we have (or nothing before setup:db) */ }
    loading = null;
  })();
  return loading;
}

export function useAppSettings() {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  useEffect(() => { if (Date.now() - state.at > MAX_AGE) refreshSettings(); }, []);
  return snap.value;
}

export async function adminSetSetting(key, value) {
  const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value });
  if (error) throw error;
  await refreshSettings();
}

// "20:00" -> "8:00 PM"
export function fmtTime(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm ?? '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
// Minutes since midnight in the Philippines (whatever the phone's time zone).
export function manilaMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

// Is the jeepney running now in this direction?
// { state: 'unknown' | 'before_first' | 'running' | 'last_soon' | 'after_last', first, last, minutesLeft }
export function serviceStatus(hours, direction, date = new Date()) {
  const h = hours?.[direction];
  if (!h?.first || !h?.last) return { state: 'unknown' };
  const now = manilaMinutes(date);
  const first = minutesOf(h.first);
  const last = minutesOf(h.last);
  const base = { first: fmtTime(h.first), last: fmtTime(h.last) };
  if (now < first) return { ...base, state: 'before_first', minutesLeft: first - now };
  if (now > last) return { ...base, state: 'after_last' };
  if (last - now <= 60) return { ...base, state: 'last_soon', minutesLeft: last - now };
  return { ...base, state: 'running' };
}
