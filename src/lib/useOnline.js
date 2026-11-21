// Is the phone online? (Updates when the connection drops or comes back.)
import { useSyncExternalStore } from 'react';

const subscribe = (cb) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true);
