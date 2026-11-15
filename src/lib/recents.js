// Places the rider searched for recently, kept on this phone only.
import { useSyncExternalStore } from 'react';

const KEY = 'sakay:recent-places:v1';
const MAX = 6;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => Array.isArray(p?.point) && p.label) : [];
  } catch {
    return [];
  }
}

let state = load();
const listeners = new Set();

const same = (a, b) => (a.stopId && a.stopId === b.stopId) || (a.label === b.label && Math.abs(a.point[0] - b.point[0]) < 1e-4 && Math.abs(a.point[1] - b.point[1]) < 1e-4);

function save(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: keep in memory */ }
  listeners.forEach((l) => l());
}

export function addRecent(place) {
  if (!place?.point || !place.label || place.kind === 'gps') return;
  const p = { kind: place.kind, label: place.label, sub: place.sub ?? '', point: place.point, stopId: place.stopId ?? null, icon: place.icon ?? null };
  save([p, ...state.filter((x) => !same(x, p))].slice(0, MAX));
}

export function clearRecents() {
  save([]);
}

export function useRecents() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
