// Community tips: things local commuters know that maps don't, such as
// route changes, where people actually wait, fare practices, tricycle
// terminals and road work. Anyone can read them; signed-in riders can post
// and mark tips as helpful; admins can hide wrong or abusive ones.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase.js';
import { distanceMeters } from './geo.js';
import { isDataSaver } from './prefs.js';

export const TIP_CATEGORIES = {
  route_change: { label: 'Route change', icon: 'routes', hint: 'The jeepney now uses a different street' },
  boarding: { label: 'Where to wait', icon: 'waiting', hint: 'Where people actually get on or off' },
  fare: { label: 'Fare', icon: 'fare', hint: 'What drivers charge, discounts, change' },
  terminal: { label: 'Terminal & tricycles', icon: 'terminal', hint: 'Terminals, tricycle stands, last trips' },
  road: { label: 'Road & traffic', icon: 'warning', hint: 'Road work, floods, heavy traffic' },
  other: { label: 'Other tip', icon: 'chat', hint: '' },
};

function must({ data, error }) {
  if (error) throw error;
  return data;
}

const toTip = (r) => ({
  id: r.id,
  category: TIP_CATEGORIES[r.category] ? r.category : 'other',
  body: r.body,
  stopId: r.stop_id,
  point: r.lat != null && r.lng != null ? [r.lng, r.lat] : null,
  helpful: r.helpful,
  createdAt: new Date(r.created_at),
  author: r.author || 'Commuter',
  mine: !!r.mine,
  voted: !!r.voted,
  status: r.status,
});

export async function fetchTips(routeId, { includeHidden = false } = {}) {
  if (!supabase) return [];
  const res = await supabase.rpc('list_tips', { p_route_id: routeId, p_include_hidden: includeHidden });
  if (res.error && /could not find the function/i.test(res.error.message)) {
    throw new Error('Community tips aren’t switched on yet. (Admin: run npm run setup:db.)');
  }
  return (must(res) ?? []).map(toTip);
}

export async function postTip({ routeId, category, body, stopId, point }) {
  return must(await supabase.rpc('post_tip', {
    p_route_id: routeId,
    p_category: category,
    p_body: body,
    p_stop_id: stopId || null,
    p_lat: point ? +point[1].toFixed(4) : null, // ~10 m, not your exact spot
    p_lng: point ? +point[0].toFixed(4) : null,
  }));
}

export async function deleteTip(id) {
  must(await supabase.rpc('delete_tip', { p_id: id }));
}

export async function toggleHelpful(id) {
  const rows = must(await supabase.rpc('toggle_tip_vote', { p_id: id }));
  return rows?.[0] ?? null; // { helpful, voted }
}

export async function adminSetTipStatus(id, status) {
  must(await supabase.rpc('admin_set_tip_status', { p_id: id, p_status: status }));
}

// Tips that matter for a trip: at its stops, or within `radius` of its spots.
export function tipsNear(tips, { stopIds = [], points = [] }, radius = 400) {
  return tips.filter((t) => (t.stopId && stopIds.includes(t.stopId))
    || (t.point && points.some((p) => p && distanceMeters(p, t.point) <= radius)));
}

export const tipAge = (d) => {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : d.toLocaleDateString();
};

// Shared, lightly cached list (refreshed every 5 minutes while in use).
// Tips change slowly: every 10 minutes (30 with Data saver) is plenty.
const refreshMs = () => (isDataSaver() ? 30 : 10) * 60 * 1000;
let state = { routeId: null, tips: [], loadedAt: 0, error: '' };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

async function load(routeId) {
  try {
    const tips = await fetchTips(routeId);
    set({ routeId, tips, loadedAt: Date.now(), error: '' });
  } catch (e) {
    set({ routeId, loadedAt: Date.now(), error: e.message });
  }
}

// userKey: reload when someone signs in or out (to know "mine" and "voted").
export function useTips(routeId, userKey = null) {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  useEffect(() => {
    if (!supabase) return undefined;
    if (state.routeId !== routeId || Date.now() - state.loadedAt > refreshMs()) load(routeId);
    const t = setInterval(() => { if (!document.hidden) load(routeId); }, refreshMs());
    return () => clearInterval(t);
  }, [routeId]);
  useEffect(() => { if (supabase && state.loadedAt) load(routeId); }, [userKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => load(routeId), [routeId]);
  const patchTip = useCallback((id, patch) => set({ tips: state.tips.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), []);
  const removeTip = useCallback((id) => set({ tips: state.tips.filter((t) => t.id !== id) }), []);
  return { tips: snap.routeId === routeId ? snap.tips : [], loaded: snap.routeId === routeId && snap.loadedAt > 0, error: snap.error, reload, patchTip, removeTip };
}
