import { useId } from 'react';

// Simple line icons drawn for this app.
const PATHS = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  routes: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 6v4a4 4 0 0 0 4 4h4m4-2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  more: 'M4 6h16M4 12h16M4 18h16',
  drive: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-9 3h6m6 0h6m-9 3v6',
  back: 'M15 5 8 12l7 7',
  chevron: 'm9 5 7 7-7 7',
  chevronDown: 'm6 9 6 6 6-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  fare: 'M3 7h18v10H3V7Zm9 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6 10v4m12-4v4',
  report: 'M5 21V4h11l-1.5 4L16 12H5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v5m0-8h.01',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  heartAdd: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  seat: 'M7 4v9h10M7 13l-1 7m11-7 1 7M10 4h4',
  bus: 'M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V5Zm0 7h14M8 17v3m8-3v3M8 14.5h.01M16 14.5h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  swap: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  locate: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  theme: 'M12 3a9 9 0 1 0 0 18V3Z',
  school: 'm3 9 9-5 9 5-9 5-9-5Zm4 2.5V16c2.5 2 7.5 2 10 0v-4.5',
  market: 'M4 9h16l-1-5H5L4 9Zm1 0v11h14V9M9 20v-6h6v6',
  church: 'M12 2v4m-2-2h4M7 21V11l5-4 5 4v10M3 21h18M10 21v-4h4v4',
  plaza: 'M4 20h16M6 20V10m12 10V10M3 10l9-6 9 6M10 14h4',
  terminal: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4V6Zm0 6h16M7 16v3m10-3v3',
  capitol: 'M3 21h18M4 18h16M6 18v-7m4 7v-7m4 7v-7m4 7v-7M3 11h18L12 4 3 11Z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  close: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 5 5 9-10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  key: 'M15 7a4 4 0 1 1-3.9 5H4v3h3v3h3v-3h1.1A4 4 0 0 1 15 7Z',
  waiting: 'M8.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 21v-6l-1-1v-3.5A2.5 2.5 0 0 1 7.5 8h2.2l3.3-2.2L14.5 2M11 21v-6l1-1v-3m5-6.5a3 3 0 0 1 1.5 2.5M19.5 2a6 6 0 0 1 2.5 5', // person waving down a jeepney
  play: 'M7 4.5v15l12-7.5L7 4.5Z',
  stop: 'M6 6h12v12H6z',
  sparkle: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9L11 3Zm8 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z',
  send: 'M4 12 20 4l-4 16-4-7-8-1Zm8 1 8-9',
  globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
};

export default function Icon({ name, size = 22, className = '', fill = 'none' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

// App logo: a jeepney inside a map pin, on the winding route, on an orange
// tile. Same drawing as public/logo.svg and the app icons.
const ROAD = 'M-270 572L-10 452C120 392 210 470 300 420S470 352 530 380L770 492';
export function Logo({ size = 40 }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="logo-svg">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a4a" />
          <stop offset="1" stopColor="#e2510a" />
        </linearGradient>
        <clipPath id={`${id}clip`}><rect width="512" height="512" rx="116" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}clip)`}>
        <rect width="512" height="512" fill={`url(#${id}bg)`} />
        <path d={ROAD} fill="none" stroke="#1d3557" strokeWidth="58" strokeLinecap="round" strokeLinejoin="round" />
        <path d={ROAD} fill="none" stroke="#ffd9bd" strokeWidth="7" strokeDasharray="26 22" strokeLinecap="round" />
        <path d="M256 66c-86 0-152 66-152 150 0 98 114 180 142 212a13 13 0 0 0 20 0c28-32 142-114 142-212 0-84-66-150-152-150Z" fill="#fff" />
        <path d="M182 140 170 104M330 140l12-36" stroke="#1d3557" strokeWidth="8" strokeLinecap="round" />
        <circle cx="170" cy="100" r="10" fill="#f26a1f" />
        <circle cx="342" cy="100" r="10" fill="#f26a1f" />
        <g fill="#1d3557">
          <path d="M150 138h212a6 6 0 0 1 5 9l-8 12a10 10 0 0 1-8 4H161a10 10 0 0 1-8-4l-8-12a6 6 0 0 1 5-9Z" />
          <rect x="178" y="160" width="156" height="66" rx="10" />
          <path d="M182 222h148c13 0 22 10 22 22v38c0 7-5 12-12 12H172c-7 0-12-5-12-12v-38c0-12 9-22 22-22Z" />
          <rect x="156" y="296" width="200" height="14" rx="7" />
          <rect x="178" y="306" width="34" height="26" rx="8" />
          <rect x="300" y="306" width="34" height="26" rx="8" />
        </g>
        <rect x="190" y="171" width="132" height="42" rx="8" fill="#ffc79a" />
        <rect x="254" y="171" width="4" height="42" fill="#1d3557" />
        <rect x="228" y="232" width="56" height="54" rx="8" fill="#ff9a4a" />
        <g fill="#1d3557">
          <rect x="238" y="238" width="6" height="42" rx="3" />
          <rect x="253" y="238" width="6" height="42" rx="3" />
          <rect x="268" y="238" width="6" height="42" rx="3" />
        </g>
        <circle cx="194" cy="258" r="15" fill="#fff" />
        <circle cx="318" cy="258" r="15" fill="#fff" />
      </g>
    </svg>
  );
}

// Sakay AI mascot: a chat bubble with a jeepney face (roof visor, headlight
// eyes, grille smile) and a sparkle, on a navy circle. Same as public/ai-logo.svg.
export function AiLogo({ size = 40, className = '' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={`ai-logo ${className}`}>
      <defs>
        <linearGradient id={`${id}ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c4f82" />
          <stop offset="1" stopColor="#13263f" />
        </linearGradient>
        <linearGradient id={`${id}bub`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa45c" />
          <stop offset="1" stopColor="#e8590c" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${id}ring)`} />
      <path d="M19 19h26a7 7 0 0 1 7 7v13a7 7 0 0 1-7 7H29l-7 6a1 1 0 0 1-1.6-.8V46.2A7 7 0 0 1 12 39V26a7 7 0 0 1 7-7Z" fill={`url(#${id}bub)`} />
      <path d="M15 17.5h34a1.4 1.4 0 0 1 1.1 2.2l-1 1.4a2.4 2.4 0 0 1-2 1H16.9a2.4 2.4 0 0 1-2-1l-1-1.4a1.4 1.4 0 0 1 1.1-2.2Z" fill="#fff" />
      <g className="ai-eyes">
        <circle cx="23.5" cy="31" r="5" fill="#fff" />
        <circle cx="40.5" cy="31" r="5" fill="#fff" />
        <circle cx="24.5" cy="31.6" r="2.3" fill="#13263f" />
        <circle cx="41.5" cy="31.6" r="2.3" fill="#13263f" />
      </g>
      <path d="M27 39.5c3 2.2 7 2.2 10 0" fill="none" stroke="#13263f" strokeWidth="2.4" strokeLinecap="round" />
      <path className="ai-sparkle" d="M51 6.5l1.6 4.4 4.4 1.6-4.4 1.6L51 18.5l-1.6-4.4-4.4-1.6 4.4-1.6Z" fill="#ffd9bd" />
    </svg>
  );
}

// Waving person for "waiting here" map markers (plain SVG string).
export const WAITING_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 21v-6l-1-1v-3.5A2.5 2.5 0 0 1 7.5 8h2.2l3.3-2.2L14.5 2M11 21v-6l1-1v-3m5-6.5a3 3 0 0 1 1.5 2.5M19.5 2a6 6 0 0 1 2.5 5"/></svg>`;

// Jeepney glyph used inside map markers (plain SVG string for MapLibre DOM markers).
export const JEEP_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.5 15.5V9.8c0-.7.6-1.3 1.3-1.3h10.5c.5 0 1 .3 1.2.8l1.6 3.4c.2.3.3.7.3 1.1v1.7H3.5Z" fill="currentColor"/><path d="M3 6.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="16" r="2" fill="#fff" stroke="currentColor" stroke-width="1.4"/><circle cx="15" cy="16" r="2" fill="#fff" stroke="currentColor" stroke-width="1.4"/></svg>`;
