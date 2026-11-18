// A tiny vibration on important taps, so riders and drivers feel that the
// app reacted (Android; iPhones ignore it). Can be turned off in Preferences.
import { getPrefs } from './prefs.js';

const can = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && getPrefs().haptics !== false;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const haptic = {
  tap: () => { if (can() && !reduced()) navigator.vibrate(8); }, // selection, small change
  success: () => { if (can()) navigator.vibrate([12, 60, 18]); }, // saved, trip started
  warn: () => { if (can()) navigator.vibrate([30, 50, 30]); }, // end trip, breakdown
  alert: () => { if (can()) navigator.vibrate([80, 60, 80, 60, 160]); }, // SOS
};
