// Small weather chip on the map (like DavaoGo): temperature now, and a
// warning when rain is likely in the next few hours, so commuters bring an
// umbrella or leave early. Open-Meteo is free and needs no key. One small
// request (~1 KB) every 30 minutes while the map is open; none with Data
// saver.
import { useEffect, useState } from 'react';
import { isDataSaver } from './prefs.js';

const KEY = 'sakay:weather:v1';
const MAX_AGE = 30 * 60 * 1000;

// WMO weather codes -> what we show.
export function describeWeather(code) {
  if (code == null) return { icon: 'cloud', text: '' };
  if (code >= 95) return { icon: 'storm', text: 'Thunderstorm' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'rain', text: 'Rain' };
  if (code <= 1) return { icon: 'sun', text: 'Clear' };
  if (code <= 3) return { icon: 'cloud', text: 'Cloudy' };
  return { icon: 'cloud', text: 'Cloudy' };
}

export function parseWeather(json) {
  const c = json?.current;
  if (!c || c.temperature_2m == null) return null;
  const probs = (json.hourly?.precipitation_probability ?? []).filter((n) => n != null);
  return {
    temp: Math.round(c.temperature_2m),
    code: c.weather_code,
    rainSoon: Math.max(0, ...probs) >= 60,
    at: Date.now(),
  };
}

function cached() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || 'null');
    return w && Date.now() - w.at < MAX_AGE ? w : null;
  } catch {
    return null;
  }
}

export function useWeather(point, enabled) {
  const [w, setW] = useState(cached);
  useEffect(() => {
    if (!enabled || !point) return undefined;
    let alive = true;
    const load = async () => {
      if (isDataSaver() || document.hidden || cached()) return;
      try {
        const q = new URLSearchParams({
          latitude: point[1].toFixed(2), longitude: point[0].toFixed(2),
          current: 'temperature_2m,weather_code', hourly: 'precipitation_probability', forecast_hours: '3', timezone: 'Asia/Manila',
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
        if (!res.ok) return;
        const next = parseWeather(await res.json());
        if (!next || !alive) return;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage off */ }
        setW(next);
      } catch { /* offline: no chip */ }
    };
    load();
    const t = setInterval(load, MAX_AGE);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, point?.[0]?.toFixed(2), point?.[1]?.toFixed(2)]); // eslint-disable-line react-hooks/exhaustive-deps
  return w;
}
