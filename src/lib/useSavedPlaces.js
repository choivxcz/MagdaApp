// The signed-in rider's saved places, shared by the map search and the Saved tab.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { listSavedPlaces } from './account.js';

let state = { userId: null, places: [], loaded: false, error: '' };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

async function load(userId) {
  try {
    const places = await listSavedPlaces();
    if (state.userId === userId) set({ places, loaded: true, error: '' });
  } catch (e) {
    if (state.userId === userId) set({ loaded: true, error: e.message });
  }
}

export function useSavedPlaces(user) {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (state.userId === userId && (state.loaded || !userId)) return;
    set({ userId, places: [], loaded: !userId, error: '' });
    if (userId) load(userId);
  }, [userId]);
  const reload = useCallback(() => (userId ? load(userId) : Promise.resolve()), [userId]);
  return { ...(snap.userId === userId ? snap : { places: [], loaded: !userId, error: '' }), reload };
}
