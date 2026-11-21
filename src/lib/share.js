// Sharing a trip (like DavaoGo): a link that opens the same trip in the
// app, a ready-to-send message, or the steps. Works with Messenger, SMS...
import { Capacitor } from '@capacitor/core';

export const SITE = 'https://sakay-laguna.vercel.app';
const base = () => (typeof window === 'undefined' || Capacitor.isNativePlatform() ? SITE : window.location.origin);

const enc = (p) => `${p.point[0].toFixed(5)},${p.point[1].toFixed(5)}`;

// "#/map?to=121.43,14.20&tn=Jollibee&from=…" (a stop is sent by its id).
export function tripLink(from, to) {
  const q = new URLSearchParams();
  if (to) {
    if (to.stopId) q.set('ts', to.stopId); else q.set('to', enc(to));
    q.set('tn', to.label.slice(0, 80));
  }
  if (from && from.kind !== 'gps') {
    if (from.stopId) q.set('fs', from.stopId); else q.set('from', enc(from));
    q.set('fn', from.label.slice(0, 80));
  }
  return `${base()}/#/map?${q}`;
}

// The trip in a link, or null. Points must be near the route's area.
export function parseTripLink(hash, route) {
  const i = String(hash ?? '').indexOf('?');
  if (i < 0) return null;
  const q = new URLSearchParams(hash.slice(i + 1));
  const [[x1, y1], [x2, y2]] = route.bounds;
  const pad = 0.15; // ~15 km
  const place = (pt, stopId, name) => {
    if (stopId) {
      const s = route.stops.find((x) => x.id === stopId);
      return s ? { kind: 'stop', stopId: s.id, label: s.name, sub: 'Jeepney stop', point: s.coord, icon: s.icon } : null;
    }
    if (!pt) return null;
    const [lng, lat] = pt.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < x1 - pad || lng > x2 + pad || lat < y1 - pad || lat > y2 + pad) return null;
    return { kind: 'place', label: String(name || 'Shared place').slice(0, 80), sub: 'Shared place', point: [lng, lat], icon: 'pin' };
  };
  const to = place(q.get('to'), q.get('ts'), q.get('tn'));
  const from = place(q.get('from'), q.get('fs'), q.get('fn'));
  return to || from ? { to, from } : null;
}

export function shareMessage(to, option, fmt) {
  const head = `How to get to ${to.label} by jeep (Sakay Laguna)`;
  return option ? `${head}: about ${fmt.minutes(option.minutes)}, ${fmt.fare}.` : `${head}.`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand?.('copy');
    t.remove();
    return !!ok;
  }
}

export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
export async function shareToApps({ title, text, url }) {
  try {
    await navigator.share({ title, text, url });
    return true;
  } catch (e) {
    return e?.name === 'AbortError' ? null : false;
  }
}
