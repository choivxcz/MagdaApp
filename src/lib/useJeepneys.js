import { useEffect, useState } from 'react';
import { fetchActiveJeepneys } from './locations.js';
import { isDemo } from './supabase.js';

const POLL_MS = isDemo ? 2000 : 5000;

// Re-checks jeepney positions every few seconds while `enabled`.
// Pauses while the app is in the background to save mobile data.
export function useJeepneys(route, enabled = true) {
  const [jeepneys, setJeepneys] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        const list = await fetchActiveJeepneys(route);
        if (!cancelled) { setJeepneys(list); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [route, enabled]);

  return { jeepneys, error };
}
