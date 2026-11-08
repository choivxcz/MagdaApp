// One place for direction names and colors, so the map, the lists and
// the driver screen always match.
export const DIRECTIONS = {
  to_santa_cruz: { label: 'To Santa Cruz', short: '→ Sta. Cruz', color: '#1a73e8', className: 'dir-sc' },
  to_magdalena: { label: 'To Magdalena', short: '→ Magdalena', color: '#e8710a', className: 'dir-mg' },
};

export const DIRECTION_KEYS = Object.keys(DIRECTIONS);

// Seat levels shown to riders.
export function seatStatus(j) {
  if (j.seatsTotal == null || j.seatsTaken == null) return { level: 'unknown', text: 'Seats: no info' };
  const free = Math.max(0, j.seatsTotal - j.seatsTaken);
  if (free === 0) return { level: 'full', free, text: 'Full' };
  if (free <= 4) return { level: 'few', free, text: `${free} seat${free === 1 ? '' : 's'} left` };
  return { level: 'many', free, text: `${free} seats free` };
}
