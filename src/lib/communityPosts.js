// Community (like DavaoGo): tricycle / e-trike routes and terminals that
// commuters add, plus the tips from community.js, in one feed. People vote,
// confirm ("I've ridden this"), comment, report and block. New routes and
// terminals wait for an admin before everyone sees them.
//
// Names are first names only (or "Anonymous commuter"); the app never gets
// account ids of other people. Reporting and blocking work through the post.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase.js';
import { distanceMeters } from './geo.js';
import { isDataSaver } from './prefs.js';
import { t } from './i18n.js';

export const VEHICLES = {
  tricycle: { get label() { return t('Tricycle'); }, icon: 'tricycle' },
  etrike: { get label() { return t('E-trike'); }, icon: 'tricycle' },
  pedicab: { get label() { return t('Pedicab / sidecar'); }, icon: 'tricycle' },
  jeepney: { get label() { return t('Jeepney'); }, icon: 'bus' },
  van: { get label() { return t('Van / UV Express'); }, icon: 'bus' },
  bus: { get label() { return t('Bus'); }, icon: 'bus' },
  habal: { get label() { return t('Habal-habal'); }, icon: 'drive' },
};

export const POST_KINDS = {
  local_route: { get label() { return t('Local route'); }, icon: 'routes', get confirm() { return t('I’ve ridden this'); }, get what() { return t('Add a route'); }, get hint() { return t('A tricycle, e-trike or other ride that isn’t on the map'); } },
  terminal: { get label() { return t('Terminal'); }, icon: 'terminal', get confirm() { return t('I’ve been here'); }, get what() { return t('Mark a terminal'); }, get hint() { return t('A terminal, paradahan, TODA or loading area'); } },
  tip: { get label() { return t('Tip'); }, icon: 'chat', confirm: null, get what() { return t('Share a tip'); }, get hint() { return t('Where people wait, fares, route changes, road work'); } },
};

export const REPORT_REASONS = {
  get false_info() { return t('Wrong or fake information'); },
  get spam() { return t('Spam or ads'); },
  get harassment() { return t('Harassment or hate'); },
  get inappropriate() { return t('Sexual or inappropriate'); },
  get other() { return t('Something else'); },
};

const TOO_OLD = /could not find the function|schema cache/i;
function must({ data, error }) {
  if (error) {
    if (TOO_OLD.test(error.message)) throw new Error('Community isn’t switched on yet. (Admin: run npm run setup:db.)');
    throw error;
  }
  return data;
}
const num = (v) => (v == null ? null : Number(v));

const toPost = (r) => ({
  kind: r.kind,
  id: r.id,
  category: r.category,
  name: r.name,
  body: r.body,
  vehicles: r.vehicles ?? [],
  fares: { default: num(r.fare_default), solo: num(r.fare_solo), shared: num(r.fare_shared) },
  hours: r.hours,
  point: r.lat != null && r.lng != null ? [r.lng, r.lat] : null,
  path: Array.isArray(r.path) ? r.path : null,
  stopId: r.stop_id,
  status: r.status,
  reviewNote: r.review_note,
  up: r.up ?? 0,
  down: r.down ?? 0,
  confirms: r.confirms ?? 0,
  comments: r.comments ?? 0,
  author: r.author || 'Commuter',
  authorDriver: !!r.author_driver,
  mine: !!r.mine,
  myVote: r.my_vote ?? 0,
  myConfirm: !!r.my_confirm,
  createdAt: new Date(r.created_at),
});

// The kind of target for comments / reports / blocking.
export const targetOf = (post) => (post.kind === 'tip' ? 'tip' : 'post');

export async function fetchFeed(routeId) {
  if (!supabase) return [];
  const rows = must(await supabase.rpc('community_feed', { p_route_id: routeId })) ?? [];
  return rows.map(toPost).sort((a, b) => b.createdAt - a.createdAt);
}

export async function createPost(p) {
  return must(await supabase.rpc('create_post', {
    p_route_id: p.routeId,
    p_kind: p.kind,
    p_name: p.name,
    p_note: p.note || null,
    p_vehicles: p.vehicles,
    p_fare_default: p.fares?.default ?? null,
    p_fare_solo: p.fares?.solo ?? null,
    p_fare_shared: p.fares?.shared ?? null,
    p_hours: p.hours || null,
    p_lat: +p.point[1].toFixed(6),
    p_lng: +p.point[0].toFixed(6),
    p_path: p.kind === 'local_route' ? p.path.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) : null,
    p_anonymous: !!p.anonymous,
  }));
}

export const deletePost = async (id) => must(await supabase.rpc('delete_post', { p_id: id }));
export const votePost = async (id, value) => must(await supabase.rpc('vote_post', { p_id: id, p_value: value }))?.[0] ?? null;
export const confirmPost = async (id) => must(await supabase.rpc('confirm_post', { p_id: id }))?.[0] ?? null;

export async function listComments(kind, id) {
  const rows = must(await supabase.rpc('list_comments', { p_kind: kind, p_id: id })) ?? [];
  return rows.map((r) => ({ id: r.id, body: r.body, author: r.author, authorDriver: !!r.author_driver, mine: !!r.mine, createdAt: new Date(r.created_at) }));
}
export const addComment = async (kind, id, body) => must(await supabase.rpc('add_comment', { p_kind: kind, p_id: id, p_body: body }));
export const deleteComment = async (id) => must(await supabase.rpc('delete_comment', { p_id: id }));

export const reportContent = async (kind, id, reason, note) => must(await supabase.rpc('report_content', { p_kind: kind, p_id: String(id), p_reason: reason, p_note: note || null }));
export const blockAuthor = async (kind, id) => must(await supabase.rpc('block_author', { p_kind: kind, p_id: String(id) }));
export const listBlocked = async () => (must(await supabase.rpc('list_blocked')) ?? []).map((r) => ({ id: r.blocked, name: r.name, since: new Date(r.created_at) }));
export const unblockUser = async (id) => must(await supabase.rpc('unblock_user', { p_user_id: id }));

export async function contributorCard(kind, id) {
  const r = must(await supabase.rpc('contributor_card', { p_kind: kind, p_id: String(id) }))?.[0];
  return r ? { name: r.name, isDriver: r.is_driver, joined: r.joined ? new Date(r.joined) : null, routes: r.routes, terminals: r.terminals, tips: r.tips, comments: r.comments, avatarV: r.avatar_v, anonymous: r.anonymous } : null;
}

// ----- the shared feed (lightly cached; tips refresh slowly) -----
const refreshMs = () => (isDataSaver() ? 30 : 10) * 60 * 1000;
let state = { routeId: null, posts: [], loadedAt: 0, error: '' };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

async function load(routeId) {
  try {
    set({ routeId, posts: await fetchFeed(routeId), loadedAt: Date.now(), error: '' });
  } catch (e) {
    set({ routeId, loadedAt: Date.now(), error: e.message });
  }
}

export function useFeed(routeId, userKey = null, enabled = true) {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  useEffect(() => {
    if (!supabase || !enabled) return undefined;
    if (state.routeId !== routeId || Date.now() - state.loadedAt > refreshMs()) load(routeId);
    const t = setInterval(() => { if (!document.hidden) load(routeId); }, refreshMs());
    return () => clearInterval(t);
  }, [routeId, enabled]);
  useEffect(() => { if (supabase && enabled && state.loadedAt) load(routeId); }, [userKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => load(routeId), [routeId]);
  const patch = useCallback((id, p) => set({ posts: state.posts.map((x) => (x.id === id ? { ...x, ...p } : x)) }), []);
  const remove = useCallback((id) => set({ posts: state.posts.filter((x) => x.id !== id) }), []);
  return { posts: snap.routeId === routeId ? snap.posts : [], loaded: snap.routeId === routeId && snap.loadedAt > 0, error: snap.error, reload, patch, remove };
}

// ----- approved routes and terminals for the map and the trip planner -----
// Kept on the phone for 6 hours, so opening the app doesn't download them again.
const PLACES_KEY = 'sakay:community-places:v1';
const PLACES_MAX_AGE = 6 * 60 * 60 * 1000;
let placesState = (() => {
  try { return JSON.parse(localStorage.getItem(PLACES_KEY) || 'null') ?? { routeId: null, list: [], at: 0 }; } catch { return { routeId: null, list: [], at: 0 }; }
})();
const placesListeners = new Set();

const toPlace = (r) => ({
  id: r.id, kind: r.kind, name: r.name, vehicles: r.vehicles ?? [],
  fares: { default: num(r.fare_default), solo: num(r.fare_solo), shared: num(r.fare_shared) },
  hours: r.hours, point: [r.lng, r.lat], path: Array.isArray(r.path) ? r.path : null, confirms: r.confirms ?? 0,
});

export async function refreshCommunityPlaces(routeId) {
  if (!supabase) return;
  try {
    const rows = must(await supabase.rpc('community_places', { p_route_id: routeId })) ?? [];
    placesState = { routeId, list: rows.map(toPlace), at: Date.now() };
    try { localStorage.setItem(PLACES_KEY, JSON.stringify(placesState)); } catch { /* full or blocked */ }
    placesListeners.forEach((l) => l());
  } catch { /* keep what we have */ }
}

export function useCommunityPlaces(routeId) {
  const snap = useSyncExternalStore((cb) => { placesListeners.add(cb); return () => placesListeners.delete(cb); }, () => placesState);
  useEffect(() => {
    if (placesState.routeId !== routeId || Date.now() - placesState.at > PLACES_MAX_AGE) refreshCommunityPlaces(routeId);
  }, [routeId]);
  return snap.routeId === routeId ? snap.list : [];
}

// A tricycle terminal near a spot (for "Ride a tricycle at Bucal TODA").
export function terminalNear(places, point, maxM = 350) {
  let best = null;
  for (const p of places) {
    if (p.kind !== 'terminal' || !p.vehicles.some((v) => ['tricycle', 'etrike', 'pedicab', 'habal'].includes(v))) continue;
    const d = distanceMeters(point, p.point);
    if (d <= maxM && (!best || d < best.meters)) best = { ...p, meters: d };
  }
  return best;
}

export function fareText(fares) {
  const parts = [];
  if (fares.default != null) parts.push(`₱${fares.default % 1 ? fares.default.toFixed(2) : fares.default}`);
  if (fares.solo != null) parts.push(`₱${fares.solo % 1 ? fares.solo.toFixed(2) : fares.solo} solo`);
  if (fares.shared != null) parts.push(`₱${fares.shared % 1 ? fares.shared.toFixed(2) : fares.shared} each if shared`);
  return parts.join(' · ');
}

// Admin
export const adminReviewQueue = async () => (must(await supabase.rpc('admin_review_queue')) ?? []).map((r) => ({ ...toPost({ ...r, body: r.note, status: 'review' }), authorFull: r.author }));
export const adminListPosts = async (status) => (must(await supabase.rpc('admin_list_posts', { p_status: status })) ?? []).map((r) => ({ ...toPost({ ...r, body: r.note }), authorFull: r.author }));
export const adminUpdatePost = async (id, p) => must(await supabase.rpc('admin_update_post', {
  p_id: id, p_name: p.name, p_note: p.note || null, p_vehicles: p.vehicles,
  p_fare_default: p.fares.default, p_fare_solo: p.fares.solo, p_fare_shared: p.fares.shared, p_hours: p.hours || null,
}));
export const adminSetPostStatus = async (id, status, note) => must(await supabase.rpc('admin_set_post_status', { p_id: id, p_status: status, p_note: note || null }));
export const adminContentReports = async () => (must(await supabase.rpc('admin_content_reports')) ?? []).map((r) => ({
  kind: r.target_kind, id: r.target_id, snippet: r.snippet, author: r.author, authorId: r.author_id, authorBanned: r.author_banned,
  status: r.target_status, count: Number(r.reports), reasons: r.reasons ?? [], notes: r.notes ?? [], lastAt: new Date(r.last_at),
}));
export const adminResolveContent = async (kind, id, action) => must(await supabase.rpc('admin_resolve_content', { p_kind: kind, p_id: String(id), p_action: action }));
export const adminBanUser = async (userId, banned) => must(await supabase.rpc('admin_ban_user', { p_user_id: userId, p_banned: banned }));
export const adminListBanned = async () => (must(await supabase.rpc('admin_list_banned')) ?? []).map((r) => ({ id: r.user_id, name: r.name, since: new Date(r.banned_at) }));
