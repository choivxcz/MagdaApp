// What a jeepney is doing right now, set by the driver (or automatically).
// Riders see it on the map so a stopped jeepney isn't mistaken for one
// that's coming. No browser code: the AI server uses this too.
import { t } from './i18n.js';
export const TRIP_STATUS = {
  on_trip: { get label() { return t('On trip'); }, tl: 'Biyahe', icon: 'bus', inService: true, rider: null },
  loading: { get label() { return t('Loading at terminal'); }, tl: 'Nagpapasakay', icon: 'waiting', inService: true, get rider() { return t('Loading at the terminal · leaves when full'); } },
  break: { get label() { return t('On break'); }, tl: 'Pahinga', icon: 'clock', inService: false, get rider() { return t('On break'); } },
  refueling: { get label() { return t('Refueling'); }, tl: 'Nagpapakarga', icon: 'fuel', inService: false, get rider() { return t('Refueling'); } },
  breakdown: { get label() { return t('Breakdown'); }, tl: 'Sira', icon: 'warning', inService: false, get rider() { return t('Broke down · not in service'); } },
};

export const STATUS_KEYS = Object.keys(TRIP_STATUS);
export const statusOf = (j) => TRIP_STATUS[j?.tripStatus] ?? TRIP_STATUS.on_trip;

// True when the jeepney can pick riders up soon (not on break, refueling or broken down).
export const inService = (j) => statusOf(j).inService;

// "Loading at the terminal · leaves when full · Last trip of the day", or null.
export function riderStatusText(j) {
  const parts = [statusOf(j).rider, j?.lastTrip ? t('Last trip of the day') : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// Short tag for the map marker.
export function markerTag(j) {
  if (j?.tripStatus && j.tripStatus !== 'on_trip') {
    const tag = { loading: 'Loading', break: 'Break', refueling: 'Refueling', breakdown: 'Breakdown' }[j.tripStatus];
    return tag ? t(tag) : null;
  }
  return j?.lastTrip ? t('Last trip') : null;
}
