import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import MapView, { MapButtons, GUIDE_COLOR } from '../components/MapView.jsx';
import Icon, { AiLogo } from '../components/Icon.jsx';
import { projectOnRoute, pointAlong, sliceAlong } from '../lib/geo.js';
import { walkMinutes } from '../lib/walking.js';
import { useSakayan } from '../lib/useSakayan.js';
import { computeFare, peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { useAuth } from '../lib/auth.jsx';
import { saveTrip } from '../lib/account.js';
import { isDemo } from '../lib/supabase.js';
import InstallHint from '../components/InstallHint.jsx';
import WaitingCard from '../components/WaitingCard.jsx';
import DriverSheet from '../components/DriverSheet.jsx';
import AssistantSheet, { GREETING } from '../components/AssistantSheet.jsx';
import { ScrollRow } from '../components/ui.jsx';
import { gpsErrorText } from '../lib/gps.js';
import { askAssistant } from '../lib/assistant/client.js';

const AVG_SPEED_MPS = 20 / 3.6; // jeepneys average ~20 km/h with stops
const MAX_OFF_ROUTE_M = 1500; // pickup must be this close to the route (we show the walk)
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

function JeepRow({ j, detail, onOpen }) {
  return (
    <li>
      <button className="jeep-row" onClick={() => onOpen(j.id)} aria-label={`Jeepney ${j.plate}, see driver`}>
        <span className={`jeep-avatar ${DIRECTIONS[j.direction]?.className}`}><Icon name="bus" size={18} /></span>
        <span className="jeep-row-text">
          <span className="jeep-row-title"><b>{j.plate}</b><DirBadge direction={j.direction} /></span>
          <span className="sub">{detail ?? agoText(j.updatedAt)}</span>
        </span>
        <SeatChip jeep={j} />
        <Icon name="chevron" size={16} className="menu-chevron" />
      </button>
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

export default function MapScreen({ route, jeepneys, error, request, visible, onRequest }) {
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
  const [openJeepId, setOpenJeepId] = useState(null);
  const closeJeep = useCallback(() => setOpenJeepId(null), []);
  const [chatOpen, setChatOpen] = useState(false);
  const handleDrag = useRef(null);
  const [chat, setChat] = useState({ messages: [GREETING], busy: false, memory: {} });
  const closeChat = useCallback(() => setChatOpen(false), []);

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

  const baseTrip = useMemo(() => resolveTrip(route, fromStopId, fromPoint, toId), [route, fromStopId, fromPoint, toId]);
  const tooFar = baseTrip && baseTrip.off > MAX_OFF_ROUTE_M;
  // The passenger's sakayan: the shortest walk to a street the jeepneys pass
  // (once a destination is set: the right direction, before the babaan).
  const sakayan = useSakayan(route, fromPoint, baseTrip && !tooFar ? { direction: baseTrip.direction, maxAlong: baseTrip.to.along - MIN_RIDE_M } : {});
  const sakayanOk = !!sakayan && !sakayan.tooFar;
  // Fare, ride time and arrivals are counted from the sakayan.
  const trip = useMemo(() => (
    baseTrip && sakayanOk && sakayan.direction === baseTrip.direction
      ? { ...baseTrip, along: sakayan.along, dist: baseTrip.to.along - sakayan.along }
      : baseTrip
  ), [baseTrip, sakayan]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Violet guide: walk to the sakayan, then (with a destination) ride to the babaan.
  const hasRide = !!(trip && !tooFar);
  const board = sakayanOk ? sakayan.point : hasRide ? pointAlong(trip.leg, trip.along) : null;
  const boardKey = board ? board.map((n) => n.toFixed(5)).join(',') : '';
  const guide = useMemo(() => (board ? {
    board,
    alight: hasRide ? pointAlong(trip.leg, trip.to.along) : null,
    ride: hasRide ? sliceAlong(trip.leg, trip.along, trip.to.along) : null,
    // Only ever the street path (none while it loads).
    walk: sakayanOk ? sakayan.walk?.coords ?? null : null,
  } : null), [boardKey, hasRide, trip?.to.id, trip?.direction, trip?.along, sakayan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom so the passenger sees both themselves and the sakayan.
  useEffect(() => {
    const coords = sakayanOk && !sakayan.loading ? sakayan.walk?.coords ?? (sakayan.walkFailed ? [fromPoint, sakayan.point] : null) : null;
    if (!map || !coords) return;
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 16.5, duration: 600 });
  }, [map, sakayan]); // eslint-disable-line react-hooks/exhaustive-deps

  // "I'm waiting here": the sakayan (or chosen stop) and which way they can ride from it.
  const servedAt = (id) => Object.keys(route.legs).filter((d) => route.legs[d].stops.some((s) => s.id === id));
  const waitPoint = sakayanOk ? sakayan.point : hasRide ? board : fromStopId ? stopById(fromStopId)?.coord ?? null : null;
  const waitDirections = hasRide ? [trip.direction] : sakayanOk ? sakayan.directions : fromStopId ? servedAt(fromStopId) : [];

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
      (e) => setMsg({ kind: 'warn', text: `${gpsErrorText(e)} You can also choose a stop instead.` }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function showTrip(t) {
    setChatOpen(false);
    setExpanded(false);
    onRequest?.({ direction: t.direction, pickupStopId: t.pickupStopId, dropoffStopId: t.dropoffStopId });
  }

  async function askAI(question) {
    const messages = [...chat.messages, { role: 'user', text: question }];
    setChat((c) => ({ ...c, messages, busy: true }));
    const answer = await askAssistant({
      messages: messages.slice(1), // the greeting isn't part of the conversation
      route, jeepneys, fareType: prefs.fareType, demo: isDemo, memory: chat.memory,
      mapTrip: { fromId: fromStopId || null, toId: toId || null },
    });
    const trips = answer.actions.filter((a) => a.type === 'show_trip');
    const trip = trips.find((a) => a.auto) ?? trips.at(-1);
    setChat((c) => ({
      busy: false,
      memory: answer.memory,
      messages: [...c.messages, { role: 'assistant', text: answer.text, source: answer.source, trip: trip && !trip.auto ? trip : null }],
    }));
    if (trip?.auto) showTrip(trip);
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
        route={route} jeepneys={shown} pickup={pickupPin} me={me} guide={guide} onPick={pickOnMap} onJeepTap={setOpenJeepId}
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
                <option value="gps">Use my location (GPS)</option>
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
        <ScrollRow className="chip-row-wrap" trackClassName="chip-row" role="list" aria-label="Quick destinations">
          {stops.map((s) => (
            <button key={s.id} role="listitem" className={`chip ${toId === s.id ? 'on' : ''}`} onClick={() => chooseTo(s.id)}>
              <Icon name={s.icon} size={15} /> {s.short}
            </button>
          ))}
        </ScrollRow>
      </div>

      <div className="map-float-right">
        <MapButtons map={map} onLocate={locateMe}>
          <button className="ai-fab" onClick={() => setChatOpen(true)} aria-label="Ask Sakay AI" title="Ask Sakay AI">
            <AiLogo size={62} />
          </button>
        </MapButtons>
      </div>

      <section
        className={`bottom-sheet ${expanded ? 'expanded' : ''}`} aria-label="Trip details"
        // Scrolling down in the small panel opens it fully.
        onScroll={(e) => { if (!expanded && e.currentTarget.scrollTop > 40) setExpanded(true); }}
      >
        <button
          className="sheet-handle" aria-label={expanded ? 'Show less' : 'Show more'} aria-expanded={expanded}
          onPointerDown={(e) => {
            handleDrag.current = { y: e.clientY, swiped: false };
            e.currentTarget.setPointerCapture(e.pointerId); // keep following the finger off the handle
          }}
          onPointerUp={(e) => {
            const d = handleDrag.current;
            if (!d) return;
            const dy = e.clientY - d.y;
            // Swipe up opens the panel, swipe down closes it.
            if (Math.abs(dy) > 25) { d.swiped = true; setExpanded(dy < 0); }
          }}
          onClick={() => {
            if (handleDrag.current?.swiped) { handleDrag.current = null; return; }
            handleDrag.current = null;
            setExpanded(!expanded);
          }}
        >
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

        {tooFar && <p className="warn">Your pickup is {(trip.off / 1000).toFixed(1)} km from the jeepney route. Pick a stop, or tap closer to the colored line.</p>}
        {!trip && sakayan?.tooFar && <p className="warn">You’re {(sakayan.off / 1000).toFixed(1)} km from the nearest street the jeepneys pass. Pick a stop, or tap the map closer to the colored line.</p>}
        {fromPoint && sakayanOk && (
          <div className="walk-hint">
            <span className="walk-dot" />
            <span>
              {sakayan.loading
                ? <>Finding the walking route to the nearest <b>sakayan</b>…</>
                : sakayan.walkFailed
                  ? <>Couldn’t load walking directions right now. Walk to the violet <b>Sakayan</b> pin on the map. <button className="link-btn small" onClick={sakayan.retry}>Try again</button></>
                : !sakayan.walk
                  ? <>You’re on the jeepney route. Wait here for a jeepney{hasRide ? <>, then ride to the <b>babaan</b></> : ''}.</>
                  : (
                    <>
                      Walk <b>~{sakayan.walk.meters < 1000 ? `${Math.round(sakayan.walk.meters / 10) * 10} m` : `${(sakayan.walk.meters / 1000).toFixed(1)} km`}</b> (~{walkMinutes(sakayan.walk.meters)} min) to the {hasRide ? '' : 'nearest '}<b>sakayan</b>
                      {hasRide ? <>, then ride to the <b>babaan</b>.</> : '.'}
                    </>
                  )}
            </span>
            {!hasRide && sakayan.directions.length > 0 && (
              <span className="walk-sub">
                Jeepneys {sakayan.directions.map((d) => DIRECTIONS[d].label.replace(/^To /, 'to ')).join(' and ')} pass there.
              </span>
            )}
          </div>
        )}
        {fromStopId && toId && !trip && <p className="warn">No jeepney on this route goes from there to there. Try the other direction.</p>}
        {msg && (
          <p className={msg.kind === 'ok' ? 'ok' : msg.kind === 'warn' ? 'warn' : 'hint'}>
            {msg.text}{' '}
            {msg.kind === 'signin' && <button className="link-btn small" onClick={() => setPrefs({ guest: false })}>Sign in</button>}
          </p>
        )}
        {error && <p className="warn">Couldn’t load jeepneys: {error}</p>}

        {!isDemo && <WaitingCard route={route} user={user} point={waitPoint} directions={waitDirections} />}

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
              <JeepRow key={j.id} j={j} onOpen={setOpenJeepId} detail={j.gap != null ? `${j.gap <= 100 ? 'Arriving now' : `~${minutes(j.gap)} min · ${(j.gap / 1000).toFixed(1)} km away`} · ${agoText(j.updatedAt)}` : undefined} />
            ))}
          </ul>
        ) : (
          <p className="hint">No jeepneys are sharing their location right now.</p>
        )}

        <div className="legend-row">
          {guide && <span><i style={{ background: GUIDE_COLOR }} />Your trip</span>}
          {DIRECTION_KEYS.map((d) => <span key={d}><i style={{ background: DIRECTIONS[d].color }} />{DIRECTIONS[d].label}</span>)}
        </div>
        <p className="fineprint">Tap a jeepney to see its driver. Times, seats and fares are estimates. Not affiliated with LTFRB or any LGU.</p>
      </section>

      {openJeepId && (
        <DriverSheet jeepId={openJeepId} jeep={jeepneys.find((j) => j.id === openJeepId) ?? null} onClose={closeJeep} />
      )}

      {chatOpen && <AssistantSheet chat={chat} onSend={askAI} onShowTrip={showTrip} onClose={closeChat} />}
    </div>
  );
}
