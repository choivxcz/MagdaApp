import { useEffect, useRef, useState } from 'react';
import MapView, { MapButtons } from '../components/MapView.jsx';
import { sendLocation, endTrip } from '../lib/locations.js';
import { projectOnRoute } from '../lib/geo.js';
import { DIRECTIONS, DIRECTION_KEYS } from '../lib/directions.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, navigate } from '../components/ui.jsx';

const SEND_EVERY_MS = 10000; // one GPS update every 10 s keeps data use low
const SEAT_SEND_DELAY_MS = 800; // wait for a burst of taps, then send once
const END_OF_LEG_M = 80; // this close to the end of a leg = arrived

const other = (d) => (d === 'to_santa_cruz' ? 'to_magdalena' : 'to_santa_cruz');

function SeatCounter({ taken, capacity, onChange }) {
  const free = Math.max(0, capacity - taken);
  const level = free === 0 ? 'full' : free <= 4 ? 'few' : 'many';
  return (
    <div className="seat-counter">
      <div className="seat-head">
        <span className="label">Passengers</span>
        <span className={`seat-chip seats-${level}`}>{free === 0 ? 'Full' : `${free} free`}</span>
      </div>
      <div className="seat-row">
        <button className="seat-btn" onClick={() => onChange(taken - 1)} disabled={taken <= 0} aria-label="One passenger got off">−</button>
        <div className="seat-count"><b>{taken}</b> / {capacity}</div>
        <button className="seat-btn" onClick={() => onChange(taken + 1)} disabled={taken >= capacity} aria-label="One passenger got on">+</button>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => onChange(0)}>Empty</button>
        <button className="btn small" onClick={() => onChange(capacity)}>Full</button>
      </div>
    </div>
  );
}

// Stays mounted while the driver looks at other tabs, so the trip keeps going.
export default function DriveScreen({ route, userId, driver, visible, onTripChange }) {
  const [direction, setDirection] = useState('to_santa_cruz');
  const [seatsTaken, setSeatsTaken] = useState(0);
  const [onTrip, setOnTrip] = useState(false);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState('');
  const [map, setMap] = useState(null);
  const { photos } = useAuth();
  const mapRef = useRef(null);
  const centered = useRef(false);

  const watchId = useRef(null);
  const lastSent = useRef(0);
  const lastCoords = useRef(null);
  const seatTimer = useRef(null);
  const directionRef = useRef(direction);
  const seatsRef = useRef(seatsTaken);
  directionRef.current = direction;
  seatsRef.current = seatsTaken;

  const capacity = driver.seat_capacity ?? 20;

  useEffect(() => onTripChange?.(onTrip), [onTrip, onTripChange]);

  async function push(reason = '') {
    if (!lastCoords.current) return;
    lastSent.current = Date.now();
    try {
      await sendLocation({ userId, direction: directionRef.current, coords: lastCoords.current, seatsTaken: seatsRef.current });
      setStatus(`${reason || 'Sharing location'} · sent ${new Date().toLocaleTimeString()} · ±${Math.round(lastCoords.current.accuracy)} m`);
    } catch (e) {
      setStatus(`Send failed: ${e.message}`);
    }
  }

  function stopWatching() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    clearTimeout(seatTimer.current);
  }
  useEffect(() => stopWatching, []);

  function onPosition(p) {
    lastCoords.current = p.coords;
    const pt = [p.coords.longitude, p.coords.latitude];
    setMe(pt);
    // Center on the jeepney at the first GPS fix of a trip.
    if (!centered.current && mapRef.current) {
      centered.current = true;
      mapRef.current.easeTo({ center: pt, zoom: 14 });
    }

    // Reached the end of this direction: flip to the return trip and
    // empty the seats, since everyone gets off at the terminal.
    const leg = route.legs[directionRef.current];
    const snap = projectOnRoute(leg, pt);
    if (snap.offRoute < 150 && snap.along >= leg.length - END_OF_LEG_M) {
      const next = other(directionRef.current);
      directionRef.current = next;
      seatsRef.current = 0;
      setDirection(next);
      setSeatsTaken(0);
      push(`Arrived at ${leg.to}. Now ${DIRECTIONS[next].label}`);
      return;
    }
    if (Date.now() - lastSent.current >= SEND_EVERY_MS) push();
  }

  function start() {
    if (!navigator.geolocation) return setStatus('GPS is not available on this device.');
    lastSent.current = 0;
    centered.current = false;
    setOnTrip(true);
    setStatus('Waiting for GPS…');
    watchId.current = navigator.geolocation.watchPosition(
      onPosition,
      (e) => setStatus(`GPS error: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  async function stop() {
    stopWatching();
    setOnTrip(false);
    setSeatsTaken(0);
    try {
      await endTrip(userId);
      setStatus('Trip ended. Riders no longer see your jeepney.');
    } catch (e) {
      setStatus(`Could not end trip: ${e.message}`);
    }
  }

  function changeSeats(n) {
    const v = Math.max(0, Math.min(capacity, n));
    setSeatsTaken(v);
    seatsRef.current = v;
    if (!onTrip) return;
    clearTimeout(seatTimer.current);
    seatTimer.current = setTimeout(() => push('Seats updated'), SEAT_SEND_DELAY_MS);
  }

  function changeDirection(d) {
    setDirection(d);
    directionRef.current = d;
    if (onTrip) push(`Now ${DIRECTIONS[d].label}`);
  }

  return (
    <div className="map-screen drive">
      <MapView route={route} me={me} activeDirection={direction} visible={visible} onReady={(m) => { mapRef.current = m; setMap(m); }} padding={{ top: 30, bottom: 460 }} />
      <div className="map-float-right drive">
        <MapButtons map={map} onLocate={me ? () => map?.flyTo({ center: me, zoom: 15 }) : undefined} />
      </div>
      <section className="bottom-sheet drive-sheet">
        <div className="row spread">
          <div className="drive-who">
            <Avatar url={photos.avatar} name={driver.full_name} size={46} />
            <div>
              <div className="label">{driver.full_name}</div>
              <div className="big">{driver.plate}</div>
            </div>
          </div>
          <span className={`status-pill ${onTrip ? 'live' : ''}`}>{onTrip ? '● On trip' : 'Off duty'}</span>
        </div>

        <div className="segmented" role="group" aria-label="Direction">
          {DIRECTION_KEYS.map((d) => (
            <button key={d} className={`${direction === d ? 'on' : ''} ${DIRECTIONS[d].className}`} onClick={() => changeDirection(d)}>
              {DIRECTIONS[d].label}
            </button>
          ))}
        </div>

        <SeatCounter taken={seatsTaken} capacity={capacity} onChange={changeSeats} />

        {onTrip ? (
          <button className="btn danger big-btn" onClick={stop}>■ End trip</button>
        ) : (
          <button className="btn primary big-btn" onClick={start}>▶ Start trip</button>
        )}
        {status && <p className="hint">{status}</p>}
        {(!photos.avatar || !photos.jeepney) && (
          <p className="hint">
            Riders see your {!photos.avatar && !photos.jeepney ? 'photo and jeepney photo' : !photos.avatar ? 'profile picture' : 'jeepney photo'} when they tap your jeepney.{' '}
            <button className="link-btn small" onClick={() => navigate('more/account')}>Add {!photos.avatar && !photos.jeepney ? 'photos' : 'photo'}</button>
          </p>
        )}
        <p className="fineprint">
          Keep the app open while driving. Direction switches by itself at each terminal.
          Let the konduktor or a passenger tap the seat buttons, not the driver while moving.
        </p>
      </section>
    </div>
  );
}
