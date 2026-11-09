import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { DIRECTIONS } from '../lib/directions.js';
import { distanceMeters } from '../lib/geo.js';
import { setPrefs } from '../lib/prefs.js';
import { getMyWaiting, startWaiting, stopWaiting } from '../lib/waiting.js';

const MOVED_M = 60; // farther than this from my signal: offer to move it

function nearestStop(route, point) {
  let best = null;
  for (const s of route.stops) {
    const d = distanceMeters(point, s.coord);
    if (!best || d < best.d) best = { s, d };
  }
  return best && best.d < 600 ? best.s.short ?? best.s.name : null;
}

const dirShort = (d) => DIRECTIONS[d].label.replace(/^To /, 'to ');

// "I'm waiting here": lets on-duty drivers see where passengers wait and how
// many they are. point = the sakayan; directions = which way(s) they can ride.
export default function WaitingCard({ route, user, point, directions }) {
  const [mine, setMine] = useState(undefined); // undefined = loading, null = not waiting
  const [people, setPeople] = useState(1);
  const [pickDir, setPickDir] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    if (!user) { setMine(null); return undefined; }
    let cancelled = false;
    getMyWaiting().then((w) => { if (!cancelled) setMine(w); }).catch(() => { if (!cancelled) setMine(null); });
    return () => { cancelled = true; };
  }, [user]);

  // Countdown, and forget the signal once it has run out.
  useEffect(() => {
    if (!mine) return undefined;
    const t = setInterval(() => {
      if (mine.expiresAt <= new Date()) setMine(null);
      else tick((n) => n + 1);
    }, 15000);
    return () => clearInterval(t);
  }, [mine]);

  const direction = directions.length === 1 ? directions[0] : pickDir && directions.includes(pickDir) ? pickDir : null;

  async function send(dir = direction, at = point, count = people) {
    setBusy(true);
    setError('');
    try {
      setMine(await startWaiting({ routeId: route.id, direction: dir, point: at, people: count }));
    } catch (e) {
      setError(/function|relation|schema/i.test(e.message) ? 'Waiting signals aren’t set up on the server yet.' : `Couldn’t send: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError('');
    try {
      await stopWaiting();
      setMine(null);
    } catch (e) {
      setError(`Couldn’t cancel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (mine === undefined) return null;

  // Already waiting: show it, even if the passenger is looking elsewhere on the map.
  if (mine) {
    const minsLeft = Math.max(1, Math.round((mine.expiresAt - Date.now()) / 60000));
    const place = nearestStop(route, mine.point);
    const moved = point && distanceMeters(point, mine.point) > MOVED_M;
    return (
      <div className="waiting-card on" role="status">
        <div className="waiting-head">
          <span className="waiting-icon"><Icon name="waiting" size={22} /></span>
          <div>
            <b>Drivers can see you’re waiting</b>
            <span className="sub">
              {mine.people} {mine.people === 1 ? 'person' : 'people'} · {dirShort(mine.direction)}{place ? ` · near ${place}` : ''} · ends in {minsLeft} min
            </span>
          </div>
        </div>
        <div className="waiting-actions">
          <button className="btn small primary icon-text" onClick={stop} disabled={busy}><Icon name="check" size={16} /> I got a ride</button>
          {moved && <button className="btn small" onClick={() => send(directions.includes(mine.direction) ? mine.direction : direction ?? mine.direction, point, mine.people)} disabled={busy}>Move here</button>}
          {minsLeft <= 5 && <button className="btn small" onClick={() => send(mine.direction, mine.point, mine.people)} disabled={busy}>+20 min</button>}
          <button className="btn small" onClick={stop} disabled={busy}>Cancel</button>
        </div>
        {error && <p className="warn">{error}</p>}
      </div>
    );
  }

  if (!point || !directions.length) return null;

  if (!user) {
    return (
      <div className="waiting-card">
        <div className="waiting-head">
          <span className="waiting-icon"><Icon name="waiting" size={22} /></span>
          <div>
            <b>Tell drivers you’re waiting here</b>
            <span className="sub">Sign in so jeepney drivers can see where you wait.</span>
          </div>
        </div>
        <div className="waiting-actions">
          <button className="btn small primary" onClick={() => setPrefs({ guest: false })}>Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="waiting-card">
      <div className="waiting-head">
        <span className="waiting-icon"><Icon name="waiting" size={22} /></span>
        <div>
          <b>Waiting for a jeepney here?</b>
          <span className="sub">Drivers on the road will see this spot and how many you are (not your name).</span>
        </div>
      </div>
      {directions.length > 1 && (
        <div className="waiting-row">
          <span className="label">Going</span>
          <div className="dir-filter">
            {directions.map((d) => (
              <button key={d} className={`${direction === d ? 'on' : ''} ${DIRECTIONS[d].className}`} onClick={() => setPickDir(d)}>
                {DIRECTIONS[d].short}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="waiting-row">
        <span className="label">How many?</span>
        <div className="people-stepper">
          <button onClick={() => setPeople((n) => Math.max(1, n - 1))} disabled={people <= 1} aria-label="Fewer people">−</button>
          <b aria-live="polite">{people}</b>
          <button onClick={() => setPeople((n) => Math.min(6, n + 1))} disabled={people >= 6} aria-label="More people">+</button>
        </div>
      </div>
      <button className="btn primary wide icon-text center" onClick={() => send()} disabled={busy || !direction}>
        {direction ? <><Icon name="waiting" size={20} /> I’m waiting here</> : 'Choose your direction first'}
      </button>
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
