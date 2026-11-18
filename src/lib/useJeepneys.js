import { useEffect, useRef, useState } from 'react';
import { fetchActiveJeepneys, fetchJeepneyUpdates, STALE_MS } from './locations.js';
import { isDemo } from './supabase.js';

const FULL_EVERY_MS = 5 * 60 * 1000; // start fresh now and then, just in case
const OVERLAP_MS = 2000; // ask a little before the last check, so nothing slips through

// Applies one check's answer to the jeepneys we know: a full answer replaces
// everything; otherwise changed ones are updated, ended trips removed, and
// jeepneys silent for 2 minutes (phone off, no signal) dropped.
export function mergeUpdate(known, update) {
  const next = update.full ? new Map() : new Map(known);
  for (const j of update.rows) {
    if (j.active) next.set(j.id, j);
    else next.delete(j.id);
  }
  const cutoff = update.now - STALE_MS;
  for (const [id, j] of next) if (j.updatedAt.getTime() < cutoff) next.delete(id);
  return next;
}

// Re-checks jeepney positions every `intervalMs` while `enabled`.
// Downloads only the jeepneys that changed since the last check (a few
// hundred bytes), keeps the rest, and forgets the ones that went quiet.
// Pauses while the app is in the background to save mobile data.
export function useJeepneys(route, enabled = true, intervalMs = 5000) {
  const [jeepneys, setJeepneys] = useState([]);
  const [error, setError] = useState(null);
  const known = useRef(new Map()); // id -> jeepney
  const since = useRef(null); // server time of the last check
  const lastFull = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let busy = false;

    async function load() {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const fresh = !since.current || Date.now() - lastFull.current > FULL_EVERY_MS;
        const update = isDemo ? null : await fetchJeepneyUpdates(route, fresh ? null : since.current - OVERLAP_MS);
        if (cancelled) return;
        if (!update) {
          // Demo mode, or the database isn't updated yet: the full list.
          const list = await fetchActiveJeepneys(route);
          if (!cancelled) { setJeepneys(list); setError(null); }
          return;
        }
        if (update.full) lastFull.current = Date.now();
        known.current = mergeUpdate(known.current, update);
        since.current = update.now;
        setJeepneys([...known.current.values()]);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        busy = false;
      }
    }

    load();
    const timer = setInterval(load, isDemo ? 2000 : intervalMs);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [route, enabled, intervalMs]);

  return { jeepneys, error };
}
