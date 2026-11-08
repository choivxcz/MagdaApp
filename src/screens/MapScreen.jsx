import { useEffect, useMemo, useState } from 'react';
import MapView, { MapButtons } from '../components/MapView.jsx';
import Icon from '../components/Icon.jsx';
import { projectOnRoute } from '../lib/geo.js';
import { computeFare, peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { useAuth } from '../lib/auth.jsx';
import { saveTrip } from '../lib/account.js';
import { isDemo } from '../lib/supabase.js';
import InstallHint from '../components/InstallHint.jsx';

const AVG_SPEED_MPS = 20 / 3.6; // jeepneys average ~20 km/h with stops
const MAX_OFF_ROUTE_M = 300; // pickup must be this close to the route
const MIN_RIDE_M = 100;

function agoText(date) {
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}
const minutes = (meters) => Math.max(1, Math.round(meters / AVG_SPEED_MPS / 60));

export function DirBadge({ direction }) {
  const d = DIRECTIONS[direction];
  return d ? <span className={`dir-badge ${d.className}`}>{d.short}</span> : null;
}

export function SeatChip({ jeep }) {
  const s = seatStatus(jeep);
  return <span className={`seat-chip seats-${s.level}`}>{s.level === 'unknown' ? '—' : s.text}</span>;
}

function JeepRow({ j, detail }) {
  return (
    <li className="jeep-row">
      <span className={`jeep-avatar ${DIRECTIONS[j.direction]?.className}`}><Icon name="bus" size={18} /></span>
      <span className="jeep-row-text">
        <span className="jeep-row-title"><b>{j.plate}</b><DirBadge direction={j.direction} /></span>
        <span className="sub">{detail ?? agoText(j.updatedAt)}</span>
      </span>
      <SeatChip jeep={j} />
    </li>
  );
}

// Finds which direction connects the pickup to the destination.
function resolveTrip(route, fromStopId, fromPoint, toId) {
  if (!toId || (!fromStopId && !fromPoint) || fromStopId === toId) return null;
  let best = null;
  for (const [direction, leg] of Object.entries(route.legs)) {
    const to = leg.stops.find((s) => s.id === toId);
    if (!to) continue;
    let along;
    let off = 0;
    if (fromStopId) {
      const from = leg.stops.find((s) => s.id === fromStopId);
      if (!from) continue;
      along = from.along;
    } else {
      const p = projectOnRoute(leg, fromPoint);
      along = p.along;
      off = p.offRoute;
    }
    const dist = to.along - along;
    if (dist < MIN_RIDE_M) continue;
    if (!best || off < best.off - 1 || (Math.abs(off - best.off) <= 1 && dist < best.dist)) {
      best = { direction, leg, along, off, dist, to };
    }
  }
  return best;
}

export default function MapScreen({ route, jeepneys, error, request, visible }) {
  const prefs = usePrefs();
  const { user } = useAuth();
  const [map, setMap] = useState(null);
  const [fromStopId, setFromStopId] = useState('');
  const [fromPoint, setFromPoint] = useState(null); // GPS or tapped point
  const [me, setMe] = useState(null);
  const [toId, setToId] = useState('');
  const [dirFilter, setDirFilter] = useState('all');
  const [onlyWithSeats, setOnlyWithSeats] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [msg, setMsg] = useState(null);

  const stops = route.stops;
  const stopById = (id) => stops.find((s) => s.id === id);

  // Open a trip sent from Saved or Routes.
  useEffect(() => {
    if (!request) return;
    const legStops = route.legs[request.direction].stops;
    if (request.pickupStopId || request.dropoffStopId) {
      setFromStopId(request.pickupStopId ?? '');
      setFromPoint(null);
      setToId(request.dropoffStopId ?? legStops[legStops.length - 1].id);
      setDirFilter('all');
      setMsg(request.pickupStopId ? null : { kind: 'hint', text: 'Now set where you’ll ride from: pick a stop, use GPS, or tap the route on the map.' });
    } else {
      setFromStopId('');
      setFromPoint(null);
      setToId('');
      setDirFilter(request.direction);
      setMsg(null);
    }
  }, [request, route]);

  const trip = useMemo(() => resolveTrip(route, fromStopId, fromPoint, toId), [route, fromStopId, fromPoint, toId]);
  const tooFar = trip && trip.off > MAX_OFF_ROUTE_M;
  const fare = trip && !tooFar ? computeFare(trip.dist) : null;
  const activeDirection = trip?.direction ?? (dirFilter !== 'all' ? dirFilter : null);

  const shown = jeepneys.filter((j) => (!onlyWithSeats || seatStatus(j).level !== 'full') && (!activeDirection || j.direction === activeDirection));

  const approaching = useMemo(() => {
    if (!trip || tooFar) return [];
    return shown
      .map((j) => ({ ...j, gap: trip.along - projectOnRoute(trip.leg, [j.lng, j.lat]).along }))
      .filter((j) => j.gap >= -50)
      .sort((a, b) => a.gap - b.gap);
  }, [shown, trip, tooFar]);
  const next = approaching[0];

  const pickupPin = fromPoint ?? (fromStopId ? stopById(fromStopId)?.coord : null);

  function pickOnMap(pt) {
    setFromPoint(pt);
    setFromStopId('');
    setMsg(null);
  }

  function onFromChange(value) {
    if (value === 'gps') return locateMe();
    setFromStopId(value);
    setFromPoint(null);
    setMsg(null);
  }

  function chooseTo(id) {
    setToId(id);
    setMsg(null);
    if (!fromStopId && !fromPoint) setMsg({ kind: 'hint', text: 'Now set where you’ll ride from: pick a stop, use GPS, or tap the route on the map.' });
  }

  function swap() {
    if (!fromStopId || !toId) return;
    setFromStopId(toId);
    setToId(fromStopId);
  }

  function locateMe() {
    if (!navigator.geolocation) return setMsg({ kind: 'warn', text: 'GPS is not available on this device. Choose a stop instead.' });
    setMsg({ kind: 'hint', text: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pt = [p.coords.longitude, p.coords.latitude];
        setMe(pt);
        pickOnMap(pt);
        map?.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 14) });
      },
      (e) => setMsg({ kind: 'warn', text: `Couldn’t get your location (${e.message}). Choose a stop instead.` }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function onSave() {
    if (!user) return setMsg({ kind: 'signin', text: 'Sign in to save trips.' });
    const from = fromStopId
      ? stopById(fromStopId)
      : trip.leg.stops
        .filter((s) => s.along < trip.to.along)
        .reduce((best, s) => (!best || Math.abs(s.along - trip.along) < Math.abs(best.along - trip.along) ? s : best), null);
    if (!from) return setMsg({ kind: 'warn', text: 'Choose a pickup stop first.' });
    try {
      await saveTrip({ name: `${from.short ?? from.name} → ${trip.to.short ?? trip.to.name}`, direction: trip.direction, pickupStopId: from.id, dropoffStopId: trip.to.id });
      setMsg({ kind: 'ok', text: 'Trip saved to your Saved tab.' });
    } catch (e) {
      setMsg({ kind: 'warn', text: `Couldn’t save: ${e.message}` });
    }
  }

  const fareMain = prefs.fareType === 'discounted' ? 'discounted' : 'regular';
  const fareOther = fareMain === 'regular' ? 'discounted' : 'regular';
  const fareLabel = { regular: 'Regular', discounted: 'Student / Senior / PWD' };
  const list = trip && !tooFar ? approaching : [...shown].sort((a, b) => a.direction.localeCompare(b.direction));

  return (
    <div className={`map-screen ${expanded ? 'sheet-expanded' : ''}`}>
      <MapView
        route={route} jeepneys={shown} pickup={pickupPin} me={me} onPick={pickOnMap}
        activeDirection={activeDirection} visible={visible} onReady={setMap}
        padding={{ top: 170, bottom: expanded ? 420 : 230 }}
      />

      <div className="map-top-overlay">
        <div className="trip-card">
          <div className="trip-lines">
            <label className="trip-row">
              <span className="trip-dot from" />
              <select value={fromPoint ? 'point' : fromStopId} onChange={(e) => onFromChange(e.target.value)} aria-label="From">
                <option value="" disabled>Where are you?</option>
                {fromPoint && <option value="point" disabled>{me && fromPoint === me ? 'My location' : 'Point on map'}</option>}
                <option value="gps">📍 Use my location</option>
                {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="trip-divider" />
            <label className="trip-row">
              <span className="trip-dot to"><Icon name="pin" size={14} /></span>
              <select value={toId} onChange={(e) => chooseTo(e.target.value)} aria-label="To">
                <option value="" disabled>Where to?</option>
                {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <button className="swap-btn" onClick={swap} disabled={!fromStopId || !toId} aria-label="Swap from and to">
            <Icon name="swap" size={20} />
          </button>
        </div>
        <div className="chip-row" role="list" aria-label="Quick destinations">
          {stops.map((s) => (
            <button key={s.id} role="listitem" className={`chip ${toId === s.id ? 'on' : ''}`} onClick={() => chooseTo(s.id)}>
              <Icon name={s.icon} size={15} /> {s.short}
            </button>
          ))}
        </div>
      </div>

      <div className="map-float-right">
        <MapButtons map={map} onLocate={locateMe} />
      </div>

      <section className={`bottom-sheet ${expanded ? 'expanded' : ''}`} aria-label="Trip details">
        <button className="sheet-handle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Show less' : 'Show more'}>
          <span />
        </button>

        <InstallHint />
        {isDemo && <p className="demo-note">Demo mode: jeepneys are simulated.</p>}

        {trip && !tooFar ? (
          <div className="trip-summary">
            <div className="trip-summary-main">
              <span className="label">{DIRECTIONS[trip.direction].label} · {fare.km.toFixed(1)} km · ~{minutes(trip.dist)} min ride</span>
              <div className="trip-to">To {trip.to.name}</div>
              <div className="fare-line">
                <b className="fare-big">{peso(fare[fareMain])}</b>
                <button className="link-btn small" onClick={() => setPrefs({ fareType: fareOther })}>
                  {fareLabel[fareOther]} {peso(fare[fareOther])}
                </button>
              </div>
            </div>
            <button className="round-action" onClick={onSave} aria-label="Save trip"><Icon name="heart" size={22} /></button>
          </div>
        ) : (
          <div className="sheet-head">
            <div>
              <div className="sheet-title">{shown.length} jeepney{shown.length === 1 ? '' : 's'} on the road</div>
              <div className="sub">{toId || fromStopId || fromPoint ? 'Set both From and To to see your fare.' : 'Choose where you’re going to see your fare.'}</div>
            </div>
            <div className="dir-filter">
              {['all', ...DIRECTION_KEYS].map((d) => (
                <button key={d} className={`${dirFilter === d ? 'on' : ''} ${d === 'all' ? '' : DIRECTIONS[d].className}`} onClick={() => setDirFilter(d)}>
                  {d === 'all' ? 'All' : DIRECTIONS[d].short}
                </button>
              ))}
            </div>
          </div>
        )}

        {tooFar && <p className="warn">Your pickup is {Math.round(trip.off)} m from the route. Tap closer to the colored line or pick a stop.</p>}
        {fromStopId && toId && !trip && <p className="warn">No jeepney on this route goes from there to there. Try the other direction.</p>}
        {msg && (
          <p className={msg.kind === 'ok' ? 'ok' : msg.kind === 'warn' ? 'warn' : 'hint'}>
            {msg.text}{' '}
            {msg.kind === 'signin' && <button className="link-btn small" onClick={() => setPrefs({ guest: false })}>Sign in</button>}
          </p>
        )}
        {error && <p className="warn">Couldn’t load jeepneys: {error}</p>}

        {trip && !tooFar && (
          <div className={`next-jeep ${next ? '' : 'none'}`}>
            <Icon name="clock" size={18} />
            {next
              ? <span><b>{next.gap <= 100 ? 'Arriving now' : `Next jeepney in ~${minutes(next.gap)} min`}</b> · {next.plate} · {seatStatus(next).text}</span>
              : <span>No jeepney heading your way right now.</span>}
          </div>
        )}

        <div className="sheet-section-head">
          <h3>{trip && !tooFar ? 'Coming to you' : 'On the road now'}</h3>
          <label className="switch-label">
            <span>Free seats only</span>
            <input type="checkbox" className="switch" checked={onlyWithSeats} onChange={(e) => setOnlyWithSeats(e.target.checked)} />
          </label>
        </div>
        {list.length ? (
          <ul className="jeep-list">
            {list.map((j) => (
              <JeepRow key={j.id} j={j} detail={j.gap != null ? `${j.gap <= 100 ? 'Arriving now' : `~${minutes(j.gap)} min · ${(j.gap / 1000).toFixed(1)} km away`} · ${agoText(j.updatedAt)}` : undefined} />
            ))}
          </ul>
        ) : (
          <p className="hint">No jeepneys are sharing their location right now.</p>
        )}

        <div className="legend-row">
          {DIRECTION_KEYS.map((d) => <span key={d}><i style={{ background: DIRECTIONS[d].color }} />{DIRECTIONS[d].label}</span>)}
        </div>
        <p className="fineprint">Times, seats and fares are estimates. Not affiliated with LTFRB or any LGU.</p>
      </section>
    </div>
  );
}
