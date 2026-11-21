// Counts the mobile data the app's own requests use (live jeepneys, search,
// walking directions, AI, account), per day, so riders and drivers can see
// it. Map pictures are downloaded by the map itself and saved on the phone
// after the first time, so they aren't counted here.
//
// Imported first in main.jsx: it wraps fetch before anything else saves a
// copy of it. The count is an estimate (headers are guessed, not measured).
import { useSyncExternalStore } from 'react';

const KEY = 'sakay:data-meter:v1';
const HEADER_BYTES = 350; // rough size of request + response headers (compressed)
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

let state = load(); // { 'YYYY-MM-DD': bytes }
const listeners = new Set();
let saveTimer = null;

function add(bytes) {
  if (!(bytes > 0)) return;
  const d = day();
  const next = { ...state, [d]: (state[d] ?? 0) + bytes };
  for (const k of Object.keys(next).sort().slice(0, -31)) delete next[k];
  state = next;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  }, 5000);
  listeners.forEach((l) => l());
}

const bodySize = (body) => {
  if (!body) return 0;
  if (typeof body === 'string') return body.length;
  if (body instanceof Blob) return body.size;
  if (body.byteLength != null) return body.byteLength;
  return 0;
};

// Only requests that always go over the internet: live jeepneys and accounts
// (Supabase), place search, walking directions and the AI. Map files are
// left out: after the first time they come from the phone, not the network.
const LIVE = /supabase\.co|photon\.komoot\.io|routing\.openstreetmap\.de|router\.project-osrm\.org|valhalla1\.openstreetmap\.de|api\.open-meteo\.com|\/api\//;

if (typeof window !== 'undefined' && window.fetch && !window.fetch.__metered) {
  const original = window.fetch.bind(window);
  const metered = async (input, init) => {
    const res = await original(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (!LIVE.test(url)) return res;
      const sent = bodySize(init?.body) + HEADER_BYTES;
      const length = Number(res.headers.get('content-length'));
      if (length > 0) add(sent + length);
      else if (res.status !== 204 && res.body) res.clone().blob().then((b) => add(sent + b.size), () => add(sent));
      else add(sent);
    } catch {
      // Counting must never break a request.
    }
    return res;
  };
  metered.__metered = true;
  window.fetch = metered;
}

export function useDataUsed() {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  const today = s[day()] ?? 0;
  const month = day().slice(0, 7);
  const thisMonth = Object.entries(s).filter(([d]) => d.startsWith(month)).reduce((n, [, b]) => n + b, 0);
  return { today, thisMonth };
}

export function resetDataUsed() {
  state = {};
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export const fmtBytes = (b) => (b < 1024 * 1024 ? `${Math.max(0, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
