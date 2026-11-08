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
  close: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 5 5 9-10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  key: 'M15 7a4 4 0 1 1-3.9 5H4v3h3v3h3v-3h1.1A4 4 0 0 1 15 7Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
};

export default function Icon({ name, size = 22, className = '', fill = 'none' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

// App logo: a jeepney on a rounded teal tile.
export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo-svg">
      <rect width="48" height="48" rx="14" fill="var(--brand)" />
      <path d="M11 30V19.5c0-1.4 1.1-2.5 2.5-2.5h18.3c1 0 1.9.6 2.3 1.5l2.4 5.2c.3.6.5 1.3.5 2V30H11Z" fill="#fff" />
      <path d="M14 20.5h6v4h-6zM22.5 20.5h6v4h-6zM31 20.5h1.6l1.8 4H31z" fill="var(--brand)" opacity=".85" />
      <path d="M10 14.5h24" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="17" cy="31" r="3.4" fill="#fff" stroke="var(--brand)" strokeWidth="2" />
      <circle cx="31" cy="31" r="3.4" fill="#fff" stroke="var(--brand)" strokeWidth="2" />
    </svg>
  );
}

// Jeepney glyph used inside map markers (plain SVG string for MapLibre DOM markers).
export const JEEP_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.5 15.5V9.8c0-.7.6-1.3 1.3-1.3h10.5c.5 0 1 .3 1.2.8l1.6 3.4c.2.3.3.7.3 1.1v1.7H3.5Z" fill="currentColor"/><path d="M3 6.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="16" r="2" fill="#fff" stroke="currentColor" stroke-width="1.4"/><circle cx="15" cy="16" r="2" fill="#fff" stroke="currentColor" stroke-width="1.4"/></svg>`;
