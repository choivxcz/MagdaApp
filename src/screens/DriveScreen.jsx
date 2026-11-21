import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { MapButtons } from '../components/MapView.jsx';
import Icon from '../components/Icon.jsx';
import DriveLock from '../components/DriveLock.jsx';
import SosSheet from '../components/SosSheet.jsx';
import { sendLocation, endTrip } from '../lib/locations.js';
import { distanceMeters, projectOnRoute } from '../lib/geo.js';
import { gpsErrorText } from '../lib/gps.js';
import { fetchWaitingForDrivers } from '../lib/waiting.js';
import { DIRECTIONS, DIRECTION_KEYS } from '../lib/directions.js';
import { TRIP_STATUS, STATUS_KEYS } from '../lib/tripStatus.js';
import { useWakeLock, wakeLockSupported, say, voiceSupported, PHRASES } from '../lib/driverTools.js';
import { addDriving, addTrip, useDriverDays, dayStats } from '../lib/driverDay.js';
import { usePrefs, setPrefs, isDataSaver, useDataSaver } from '../lib/prefs.js';
import { haptic } from '../lib/haptics.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, Segmented, navigate } from '../components/ui.jsx';

// Sending the jeepney's position: often while moving (riders' arrival times
// depend on it), rarely while parked (loading at the terminal, on break),
// and right away after a big move. Data saver stretches both.
const SEND_MOVING_MS = 10000;
const SEND_STOPPED_MS = 30000;
const SEND_JUMP_M = 150;
const SEAT_SEND_DELAY_MS = 800; // wait for a burst of taps, then send once
const END_OF_LEG_M = 80; // this close to the end of a leg = arrived
const TERMINAL_M = 150; // this close to the start of a leg = at that terminal
const WAITING_MOVING_MS = 20000; // how often to check for waiting passengers
const WAITING_STOPPED_MS = 30000;
const MOVING_MPS = 10 / 3.6; // faster than 10 km/h = driving: lock the screen
const STOPPED_MPS = 5 / 3.6; // slower than 5 km/h for a few seconds = stopped
const BACK_ON_TRIP_MS = 20000; // driving for 20 s ends "Loading" / "Break" / "Refueling"
const BUNCH_M = 300; // closer than this to the jeep ahead = bunching
const BUNCH_REPEAT_MS = 3 * 60 * 1000;
const JEEP_MPS = 20 / 3.6;

const other = (d) => (d === 'to_santa_cruz' ? 'to_magdalena' : 'to_santa_cruz');
const fmtDist = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);
const fmtMin = (m) => `${Math.max(1, Math.round(m / JEEP_MPS / 60))} min`;
const fmtHours = (s) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
const placeName = (s) => s.replace(/ Terminal$/, '');

// Passengers waiting ahead in this direction, grouped by the nearest stop.
function WaitingAhead({ groups, otherDirection }) {
  const total = groups.reduce((n, g) => n + g.people, 0);
  return (
    <div className="waiting-list">
      <div className="row spread">
        <span className="label icon-label"><Icon name="waiting" size={18} />{' '}{t("Waiting ahead")}</span>
        <span className={`seat-chip ${total ? 'seats-few' : 'seats-unknown'}`}>{total} {total === 1 ? 'person' : 'people'}</span>
      </div>
      {groups.length ? (
        <ul>
          {groups.slice(0, 4).map((g) => (
            <li key={g.stop.id}>
              <b>{g.people}</b>{' '}{t("near")}{' '}{g.stop.short ?? g.stop.name}
              <span className="sub">
                {g.aheadM != null && ` · ${fmtDist(g.aheadM)} ahead`}{' '}{t("· waiting")}{' '}{g.longest}{' '}{t("min")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("No one is waiting ahead right now.")}</p>
      )}
      {otherDirection > 0 && <p className="fineprint">{otherDirection}{' '}{t("waiting for the other direction.")}</p>}
    </div>
  );
}

// Seats: exact +/- for the konduktor, or one tap for how full it is.
function SeatCounter({ taken, capacity, onChange }) {
  const free = Math.max(0, capacity - taken);
  const level = free === 0 ? 'full' : free <= 4 ? 'few' : 'many';
  const quick = [['Wala', 0], ['Maluwag', Math.round(capacity * 0.3)], ['Halos puno', Math.max(0, capacity - 3)], ['Puno', capacity]];
  return (
    <div className="seat-counter">
      <div className="seat-head">
        <span className="label">{t("Passengers")}</span>
        <span className={`seat-chip seats-${level}`}>{free === 0 ? t("Full") : `${free} free`}</span>
      </div>
      <div className="seat-row">
        <button className="seat-btn" onClick={() => onChange(taken - 1)} disabled={taken <= 0} aria-label={t("One passenger got off")}>−</button>
        <div className="seat-count"><b key={taken} className="pop">{taken}</b> / {capacity}</div>
        <button className="seat-btn" onClick={() => onChange(taken + 1)} disabled={taken >= capacity} aria-label={t("One passenger got on")}>+</button>
      </div>
      <div className="seat-quick" role="group" aria-label={t("How full")}>
        {quick.map(([label, n]) => (
          <button key={label} className={`btn small ${taken === n ? 'on' : ''}`} onClick={() => onChange(n)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

// Loading at terminal / Break / Refueling / Breakdown, and "Last trip".
function TripStatusPicker({ value, lastTrip, disabled, onChange, onLastTrip }) {
  return (
    <div className="trip-status">
      <span className="label">{t("Status")}{' '}{disabled && <small>(start a trip first)</small>}</span>
      <div className="status-grid">
        {STATUS_KEYS.map((k) => {
          const s = TRIP_STATUS[k];
          return (
            <button key={k} className={`status-btn ${k} ${value === k ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(k)} aria-pressed={value === k}>
              <Icon name={s.icon} size={18} />
              <span>{s.label}<small>{s.tl}</small></span>
            </button>
          );
        })}
      </div>
      <label className="switch-label last-trip">
        <span><b>{t("Last trip of the day")}</b>{' '}{t("· Huling biyahe. Riders see it on the map.")}</span>
        <input type="checkbox" className="switch" checked={lastTrip} disabled={disabled} onChange={(e) => onLastTrip(e.target.checked)} />
      </label>
    </div>
  );
}

// Jeepneys just ahead and behind on this direction: spacing, not racing.
function Gaps({ gaps }) {
  if (!gaps) return null;
  const row = (label, g, warn) => (
    <div className={`gap-row ${warn ? 'warn' : ''}`}>
      <span className="label">{label}</span>
      {g ? <span><b>{fmtDist(g.gap)}</b> · ~{fmtMin(g.gap)} · {g.j.plate}</span> : <span className="sub">{t("None on this direction")}</span>}
    </div>
  );
  const bunched = gaps.ahead && gaps.ahead.gap < BUNCH_M;
  return (
    <div className="gaps">
      {row('Jeep ahead', gaps.ahead, bunched)}
      {row('Jeep behind', gaps.behind, false)}
      {bunched && <p className="fineprint">{t("You’re right behind another jeepney. Waiting a bit spreads out the trips, so both of you get more passengers.")}</p>}
    </div>
  );
}

// Stays mounted while the driver looks at other tabs, so the trip keeps going.
export default function DriveScreen({ route, userId, driver, visible, jeepneys = [], onTripChange }) {
  const prefs = usePrefs();
  const saver = useDataSaver();
  const voice = prefs.driverVoice ?? 'tl';
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const speak = useCallback((text) => say(text, voiceRef.current), []);

  const [direction, setDirection] = useState('to_santa_cruz');
  const [seatsTaken, setSeatsTaken] = useState(0);
  const [onTrip, setOnTrip] = useState(false);
  const [tripStatus, setTripStatus] = useState('on_trip');
  const [lastTrip, setLastTrip] = useState(false);
  const [moving, setMoving] = useState(false);
  const [unlocked, setUnlocked] = useState(false); // konduktor holds the phone (until the next terminal)
  const [sosOpen, setSosOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState('');
  const [map, setMap] = useState(null);
  const { photos } = useAuth();
  const days = useDriverDays(userId);
  const today = dayStats(days);
  const mapRef = useRef(null);
  const centered = useRef(false);
  const watchId = useRef(null);
  const lastSent = useRef(0);
  const lastCoords = useRef(null);
  const lastSentAt = useRef(null);
  const seatTimer = useRef(null);
  const prevFix = useRef(null);
  const firstFix = useRef(true);
  const motion = useRef({ moving: false, fastSince: null, slowSince: null, movingSince: null });
  const directionRef = useRef(direction);
  const seatsRef = useRef(seatsTaken);
  const statusRef = useRef(tripStatus);
  const lastTripRef = useRef(lastTrip);
  directionRef.current = direction;
  seatsRef.current = seatsTaken;
  statusRef.current = tripStatus;
  lastTripRef.current = lastTrip;

  const capacity = driver.seat_capacity ?? 20;

  // Keep the screen on during a trip (a sleeping screen stops GPS).
  useWakeLock(onTrip);

  // Passengers who tapped "I'm waiting here" (checked while this screen is open).
  const [waiting, setWaiting] = useState([]);
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetchWaitingForDrivers(route.id).then((w) => { if (!cancelled) setWaiting(w); }).catch(() => {});
    };
    load();
    const t = setInterval(load, (moving ? WAITING_MOVING_MS : WAITING_STOPPED_MS) * (saver ? 1.5 : 1));
    return () => { cancelled = true; clearInterval(t); };
  }, [visible, route.id, moving, saver]);

  const myAlong = useMemo(() => (me ? projectOnRoute(route.legs[direction], me).along : null), [me, direction, route]);

  const waitingAhead = useMemo(() => {
    const leg = route.legs[direction];
    const groups = new Map();
    for (const w of waiting) {
      if (w.direction !== direction) continue;
      const along = projectOnRoute(leg, w.point).along;
      if (myAlong != null && along < myAlong - 50) continue; // already passed them
      const stop = leg.stops.reduce((best, st) => (Math.abs(st.along - along) < Math.abs(best.along - along) ? st : best));
      const g = groups.get(stop.id) ?? { stop, people: 0, along, longest: 0 };
      g.people += w.people;
      g.along = Math.min(g.along, along);
      g.longest = Math.max(g.longest, w.minutesWaiting);
      groups.set(stop.id, g);
    }
    return [...groups.values()]
      .sort((a, b) => a.along - b.along)
      .map((g) => ({ ...g, aheadM: myAlong != null ? Math.max(0, g.along - myAlong) : null }));
  }, [waiting, direction, myAlong, route]);
  const waitingOther = waiting.filter((w) => w.direction !== direction).reduce((n, w) => n + w.people, 0);
  const waitingOnMap = useMemo(
    () => waiting.map((w) => ({ point: w.point, people: w.people, dim: w.direction !== direction })),
    [waiting, direction],
  );

  // Other jeepneys on this direction: the nearest ahead and behind.
  const others = useMemo(() => jeepneys.filter((j) => j.id !== userId), [jeepneys, userId]);
  const gaps = useMemo(() => {
    if (myAlong == null) return null;
    const leg = route.legs[direction];
    let ahead = null;
    let behind = null;
    for (const j of others) {
      if (j.direction !== direction) continue;
      const s = projectOnRoute(leg, [j.lng, j.lat]);
      if (s.offRoute > 200) continue;
      const gap = s.along - myAlong;
      if (gap > 0 && (!ahead || gap < ahead.gap)) ahead = { j, gap };
      if (gap < 0 && (!behind || -gap < behind.gap)) behind = { j, gap: -gap };
    }
    return { ahead, behind };
  }, [others, myAlong, direction, route]);

  useEffect(() => onTripChange?.(onTrip), [onTrip, onTripChange]);

  // ---- Voice: waiting passengers ahead, and bunching --------------------
  const spoken = useRef(new Map()); // stop id -> { people, close }
  useEffect(() => { spoken.current = new Map(); }, [direction, onTrip]);
  useEffect(() => {
    if (!onTrip) return;
    for (const g of waitingAhead) {
      if (g.aheadM == null || g.aheadM > 1500) continue;
      const name = g.stop.short ?? g.stop.name;
      const prev = spoken.current.get(g.stop.id);
      if (!prev || g.people > prev.people) {
        speak(g.aheadM < 250 ? PHRASES.waitingClose(g.people, name, voice) : PHRASES.waitingAhead(g.people, name, g.aheadM, voice));
        spoken.current.set(g.stop.id, { people: g.people, close: g.aheadM < 250 });
      } else if (!prev.close && g.aheadM < 250) {
        speak(PHRASES.waitingClose(g.people, name, voice));
        prev.close = true;
      }
    }
  }, [waitingAhead, onTrip, voice, speak]);

  const lastBunch = useRef(0);
  useEffect(() => {
    const a = gaps?.ahead;
    if (!onTrip || !moving || !a || a.gap >= BUNCH_M || tripStatus !== 'on_trip') return;
    if (Date.now() - lastBunch.current < BUNCH_REPEAT_MS) return;
    lastBunch.current = Date.now();
    speak(PHRASES.bunching(a.j.plate, a.gap, voice));
  }, [gaps, onTrip, moving, tripStatus, voice, speak]);

  // Say "screen locked" once per trip, the first time it locks.
  const saidLocked = useRef(false);
  const locked = onTrip && moving && !unlocked;

  // While driving, the map follows the jeepney (no one should be panning it).
  useEffect(() => {
    if (locked && me && mapRef.current) mapRef.current.easeTo({ center: me, duration: 800 });
  }, [locked, me]);
  useEffect(() => {
    if (locked && !saidLocked.current) {
      saidLocked.current = true;
      speak(PHRASES.locked(voice));
    }
  }, [locked, voice, speak]);

  // ---- Sending ------------------------------------------------------------
  async function push(reason = '') {
    if (!lastCoords.current) return;
    lastSent.current = Date.now();
    lastSentAt.current = [lastCoords.current.longitude, lastCoords.current.latitude];
    try {
      await sendLocation({
        userId,
        direction: directionRef.current,
        coords: lastCoords.current,
        seatsTaken: seatsRef.current,
        tripStatus: statusRef.current,
        lastTrip: lastTripRef.current,
      });
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

  function setTripStatusNow(s, reason) {
    statusRef.current = s;
    setTripStatus(s);
    push(reason ?? TRIP_STATUS[s].label);
  }

  // Moving or stopped, from GPS speed (or distance over time when the phone
  // doesn't report speed). A few seconds of each, so one jumpy fix doesn't
  // lock or unlock the screen.
  function trackMotion(p, pt) {
    const t = p.timestamp || Date.now();
    const prev = prevFix.current;
    let speed = Number.isFinite(p.coords.speed) && p.coords.speed >= 0 ? p.coords.speed : null;
    if (prev) {
      const dt = (t - prev.t) / 1000;
      const d = distanceMeters(prev.pt, pt);
      if (speed == null && dt > 0) speed = d / dt;
      // Count today's km and time; skip GPS jumps and long gaps.
      if (dt > 0 && dt < 120 && (p.coords.accuracy ?? 99) <= 60 && d / dt < 33) addDriving(userId, d >= 5 ? d : 0, Math.min(dt, 30));
    }
    prevFix.current = { pt, t };
    if (speed == null) return;
    const m = motion.current;
    if (speed >= MOVING_MPS) {
      m.slowSince = null;
      m.fastSince ??= t;
      if (!m.moving && t - m.fastSince >= 3000) { m.moving = true; m.movingSince = t; setMoving(true); }
    } else if (speed <= STOPPED_MPS) {
      m.fastSince = null;
      m.slowSince ??= t;
      if (m.moving && t - m.slowSince >= 6000) { m.moving = false; m.movingSince = null; setMoving(false); }
    }
    // Driving off again ends Loading / Break / Refueling by itself.
    if (m.moving && t - m.movingSince >= BACK_ON_TRIP_MS && ['loading', 'break', 'refueling'].includes(statusRef.current)) {
      setTripStatusNow('on_trip', 'Back on trip');
      speak(PHRASES.backOnTrip(voiceRef.current));
    }
  }

  function onPosition(p) {
    lastCoords.current = p.coords;
    const pt = [p.coords.longitude, p.coords.latitude];
    setMe(pt);
    // Center on the jeepney at the first GPS fix of a trip.
    if (!centered.current && mapRef.current) {
      centered.current = true;
      mapRef.current.easeTo({ center: pt, zoom: 14 });
    }

    // Starting at a terminal: pick the direction that leaves from there,
    // and show "Loading at terminal" until the jeepney drives off.
    if (firstFix.current) {
      firstFix.current = false;
      for (const d of DIRECTION_KEYS) {
        const leg = route.legs[d];
        if (distanceMeters(pt, leg.coordinates[0]) <= TERMINAL_M) {
          directionRef.current = d;
          setDirection(d);
          statusRef.current = 'loading';
          setTripStatus('loading');
          break;
        }
      }
    }

    trackMotion(p, pt);

    // Reached the end of this direction: flip to the return trip, empty
    // the seats (everyone gets off at the terminal) and start loading.
    const leg = route.legs[directionRef.current];
    const snap = projectOnRoute(leg, pt);
    if (snap.offRoute < 150 && snap.along >= leg.length - END_OF_LEG_M) {
      const next = other(directionRef.current);
      // After the last trip the jeepney isn't going back: show it as not in
      // service (break) until the driver taps End trip.
      const after = lastTripRef.current ? 'break' : 'loading';
      directionRef.current = next;
      seatsRef.current = 0;
      statusRef.current = after;
      setDirection(next);
      setSeatsTaken(0);
      setTripStatus(after);
      setUnlocked(false);
      addTrip(userId);
      if (lastTripRef.current) speak(PHRASES.lastTripDone(voiceRef.current));
      else speak(PHRASES.arrived(placeName(leg.to), placeName(route.legs[next].to), voiceRef.current));
      push(`Arrived at ${leg.to}. Now ${DIRECTIONS[next].label}`);
      return;
    }
    const since = Date.now() - lastSent.current;
    const every = (motion.current.moving ? SEND_MOVING_MS : SEND_STOPPED_MS) * (isDataSaver() ? 1.5 : 1);
    const jumped = lastSentAt.current && distanceMeters(lastSentAt.current, pt) >= SEND_JUMP_M;
    if (since >= every || (jumped && since >= 5000)) push();
  }

  function start() {
    if (!navigator.geolocation) return setStatus('GPS is not available on this device.');
    haptic.success();
    lastSent.current = 0;
    centered.current = false;
    firstFix.current = true;
    prevFix.current = null;
    motion.current = { moving: false, fastSince: null, slowSince: null, movingSince: null };
    saidLocked.current = false;
    statusRef.current = 'on_trip';
    setTripStatus('on_trip');
    setLastTrip(false);
    lastTripRef.current = false;
    setUnlocked(false);
    setOnTrip(true);
    setStatus('Waiting for GPS…');
    watchId.current = navigator.geolocation.watchPosition(
      onPosition,
      (e) => setStatus(gpsErrorText(e)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  async function stop() {
    haptic.warn();
    stopWatching();
    setOnTrip(false);
    setMoving(false);
    setSeatsTaken(0);
    setTripStatus('on_trip');
    setLastTrip(false);
    try {
      await endTrip(userId);
      setStatus('Trip ended. Riders no longer see your jeepney.');
    } catch (e) {
      setStatus(`Could not end trip: ${e.message}`);
    }
  }

  function changeSeats(n) {
    const v = Math.max(0, Math.min(capacity, n));
    if (v !== seatsRef.current) haptic.tap();
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

  function changeLastTrip(v) {
    haptic.tap();
    setLastTrip(v);
    lastTripRef.current = v;
    push(v ? t("Marked as last trip") : t("Last trip removed"));
  }

  function unlock() {
    if (window.confirm('Unlock only if a konduktor or passenger is holding the phone. The driver must not use the phone while driving (RA 10913).\n\nI-unlock lang kung konduktor o pasahero ang may hawak.')) {
      setUnlocked(true);
    }
  }

  const free = Math.max(0, capacity - seatsTaken);
  const totalWaiting = waitingAhead.reduce((n, g) => n + g.people, 0);

  return (
    <div className="map-screen drive">
      <MapView
        route={route} me={me} jeepneys={others} waiting={waitingOnMap} activeDirection={direction} visible={visible}
        onReady={(m) => { mapRef.current = m; setMap(m); }} padding={{ top: 30, bottom: 460 }}
      />
      <button className="sos-float" onClick={() => { haptic.alert(); setSosOpen(true); }} aria-label={t("SOS emergency")}>{t("SOS")}</button>
      <div className="map-float-right drive">
        <MapButtons map={map} onLocate={me ? () => map?.flyTo({ center: me, zoom: 15 }) : undefined} />
      </div>

      {locked ? (
        <DriveLock
          direction={direction} tripStatus={tripStatus} lastTrip={lastTrip} free={free} capacity={capacity}
          nextWaiting={waitingAhead[0]} totalWaiting={totalWaiting} gaps={gaps} lang={voice}
          onUnlock={unlock} onSos={() => { haptic.alert(); setSosOpen(true); }}
        />
      ) : (
        <section className="bottom-sheet drive-sheet">
          <div className="row spread">
            <div className="drive-who">
              <Avatar url={photos.avatar} name={driver.full_name} size={46} />
              <div>
                <div className="label">{driver.full_name}</div>
                <div className="big">{driver.plate}</div>
              </div>
            </div>
            <span className={`status-pill ${onTrip ? 'live' : ''}`}>
              {onTrip ? <><i className="live-dot" aria-hidden="true" />{TRIP_STATUS[tripStatus].label}</> : 'Off duty'}
            </span>
          </div>
          {onTrip && unlocked && moving && <p className="hint">{t("Unlocked for the konduktor until the next terminal.")}</p>}

          <div className="segmented" role="group" aria-label={t("Direction")}>
            {DIRECTION_KEYS.map((d) => (
              <button key={d} className={`${direction === d ? 'on' : ''} ${DIRECTIONS[d].className}`} onClick={() => changeDirection(d)}>
                {DIRECTIONS[d].label}
              </button>
            ))}
          </div>

          {onTrip ? (
            <button className="btn danger big-btn icon-text center" onClick={stop}><Icon name="stop" size={18} fill="currentColor" />{' '}{t("End trip")}</button>
          ) : (
            <button className="btn primary big-btn icon-text center" onClick={start}><Icon name="play" size={18} fill="currentColor" />{' '}{t("Start trip")}</button>
          )}
          {status && <p className="hint">{status}</p>}

          <WaitingAhead groups={waitingAhead} otherDirection={waitingOther} />
          {onTrip && <Gaps gaps={gaps} />}

          <SeatCounter taken={seatsTaken} capacity={capacity} onChange={changeSeats} />

          <TripStatusPicker
            value={tripStatus} lastTrip={lastTrip} disabled={!onTrip}
            onChange={(s) => { if (s === 'breakdown') haptic.warn(); else haptic.tap(); setTripStatusNow(s); }} onLastTrip={changeLastTrip}
          />

          <button className="today-card" onClick={() => navigate('more/earnings')}>
            <span className="menu-icon"><Icon name="fare" size={20} /></span>
            <span className="menu-text">
              <span className="menu-title">{t("Today ·")}{' '}{today.trips === 1 ? t('1 trip') : t('{n} trips', { n: today.trips })} · {today.km.toFixed(1)}{' '}{t("km ·")}{' '}{fmtHours(today.seconds)}</span>
              <span className="menu-sub">{t("Earnings log: kita, krudo, boundary")}</span>
            </span>
            <Icon name="chevron" size={18} className="menu-chevron" />
          </button>

          <div className="voice-setting">
            <span className="label icon-label"><Icon name="chat" size={16} />{' '}{t("Voice announcements")}</span>
            {voiceSupported() ? (
              <div className="row">
                <Segmented small value={voice} onChange={(v) => setPrefs({ driverVoice: v })} options={[['tl', 'Tagalog'], ['en', 'English'], ['off', 'Off']]} />
                {voice !== 'off' && <button className="link-btn small" onClick={() => say(PHRASES.test(voice), voice)}>{t("Test")}</button>}
              </div>
            ) : (
              <span className="sub">{t("This phone can’t speak announcements.")}</span>
            )}
          </div>

          {(!photos.avatar || !photos.jeepney) && (
            <p className="hint">
              {t("Riders see your")}{' '}{!photos.avatar && !photos.jeepney ? 'photo and jeepney photo' : !photos.avatar ? 'profile picture' : 'jeepney photo'}{' '}{t("when they tap your jeepney.")} 
              <button className="link-btn small" onClick={() => navigate('more/account')}>{t("Add")}{' '}{!photos.avatar && !photos.jeepney ? 'photos' : 'photo'}</button>
            </p>
          )}
          <p className="fineprint">
            While the jeepney moves, the screen locks and announcements are spoken, so you never need to touch the phone
            (Anti-Distracted Driving Act). {wakeLockSupported() ? t("The screen stays on during a trip.") : t("Keep the screen on during a trip, or riders stop seeing your jeepney.")}{' '}
            {t("Direction switches by itself at each terminal.")}
          </p>
        </section>
      )}

      {sosOpen && <SosSheet driver={driver} point={me} onClose={() => setSosOpen(false)} />}
    </div>
  );
}
