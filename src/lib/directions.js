// One place for direction names and colors, so the map, the lists and
// the driver screen always match.
import { t } from './i18n.js';
export const DIRECTIONS = {
  to_santa_cruz: { get label() { return t('To Santa Cruz'); }, get short() { return t('→ Sta. Cruz'); }, color: '#1a73e8', className: 'dir-sc' },
  to_magdalena: { get label() { return t('To Magdalena'); }, get short() { return t('→ Magdalena'); }, color: '#0d9488', className: 'dir-mg' },
};

export const DIRECTION_KEYS = Object.keys(DIRECTIONS);

// Seat levels shown to riders.
export function seatStatus(j) {
  if (j.seatsTotal == null || j.seatsTaken == null) return { level: 'unknown', text: t('Seats: no info') };
  const free = Math.max(0, j.seatsTotal - j.seatsTaken);
  if (free === 0) return { level: 'full', free, text: t('Full') };
  if (free <= 4) return { level: 'few', free, text: free === 1 ? t('1 seat left') : t('{n} seats left', { n: free }) };
  return { level: 'many', free, text: t('{n} seats free', { n: free }) };
}
