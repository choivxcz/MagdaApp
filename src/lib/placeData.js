// The app's copy of every street and place (see placeIndex.js). It's a
// separate download (~75 KB, once; then it comes from the phone) so the
// first screen opens fast. Searching and naming spots then use no load.
import { useEffect, useState } from 'react';
import { makePlaceIndex } from './placeIndex.js';

let index = null;
let loading = null;

export function loadPlaces() {
  if (index) return Promise.resolve(index);
  loading ??= import('../data/places.json')
    .then((m) => { index = makePlaceIndex(m.default ?? m); return index; })
    .catch((e) => { loading = null; throw e; });
  return loading;
}

export const placesNow = () => index;

// The index once it has loaded (null until then). `enabled` = start loading now.
export function usePlaces(enabled = true) {
  const [idx, setIdx] = useState(index);
  useEffect(() => {
    if (idx || !enabled) return undefined;
    let alive = true;
    loadPlaces().then((i) => { if (alive) setIdx(i); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled, idx]);
  return idx;
}
