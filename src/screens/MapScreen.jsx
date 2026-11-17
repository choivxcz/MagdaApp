import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import MapView, { MapButtons, GUIDE_COLOR, TRIKE_COLOR } from '../components/MapView.jsx';
import Icon, { AiLogo } from '../components/Icon.jsx';
import { projectOnRoute, sliceAlong } from '../lib/geo.js';
import { walkMinutes, walkingPath, roadPath } from '../lib/walking.js';
import { useSakayan } from '../lib/useSakayan.js';
import { peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { useAuth } from '../lib/auth.jsx';
import { saveTrip, savePlace, PLACE_KINDS } from '../lib/account.js';
import { useSavedPlaces } from '../lib/useSavedPlaces.js';
import { useTips, tipsNear, TIP_CATEGORIES, tipAge } from '../lib/community.js';
import { isDemo } from '../lib/supabase.js';
import { planJourneys, networkFromRoutes, refineWithSakayan, withMeasuredSteps, PLAN, fmtMinutes, fmtMeters } from '../lib/planner.js';
import { nameForPoint, stopPlace } from '../lib/places.js';
import InstallHint from '../components/InstallHint.jsx';
import WaitingCard from '../components/WaitingCard.jsx';
import DriverSheet from '../components/DriverSheet.jsx';
import AssistantSheet, { GREETING } from '../components/AssistantSheet.jsx';
import TripSearch from '../components/TripSearch.jsx';
import { OptionCards, Timeline, fareText } from '../components/Journey.jsx';
import { ScrollRow, navigate } from '../components/ui.jsx';
import { gpsErrorText } from '../lib/gps.js';
import { askAssistant } from '../lib/assistant/client.js';
import { landmarks } from '../lib/landmarkData.js';
import { LANDMARK_CATS, RANK_LABEL, offRoute } from '../lib/landmarks.js';
import { addRecent } from '../lib/recents.js';
import { inService, riderStatusText } from '../lib/tripStatus.js';

const AVG_SPEED_MPS = 20 / 3.6; // jeepneys average ~20 km/h with stops

// The card for a landmark tapped on the map: what it is, how close the
// jeepney passes, and buttons to go there or start from there.
function LandmarkCard({ landmark, route, onGo, onStart, onClose }) {
  const cat = LANDMARK_CATS[landmark.cat];
  const place = landmarks.place(landmark);
  const off = offRoute(route, landmark.coord);
  return (
    <div className="landmark-card" role="dialog" aria-label={landmark.name}>
      <div className="landmark-card-head">
        <span className="landmark-icon" style={{ background: cat.color }}><Icon name={cat.icon} size={18} /></span>
        <div>
          <b>{landmark.name}</b>
          <span className="sub">{place.sub}</span>
          <span className="sub">
            {landmark.rank === 0 ? `${RANK_LABEL[0]} · ` : ''}
            {off < 40 ? 'The jeepney passes right in front' : `About ${fmtMeters(off)} from the jeepney route`}
          </span>
        </div>
        <button className="icon-btn small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
      </div>
      <div className="landmark-actions">
        <button className="btn primary small" onClick={onGo}><Icon name="pin" size={15} /> Go here</button>
        <button className="btn small" onClick={onStart}><Icon name="locate" size={15} /> Start here</button>
      </div>
    </div>
  );
}

function agoText(date) {
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}
const minutes = (meters) => Math.max(1, Math.round(meters / AVG_SPEED_MPS / 60));
const placeKey = (p) => (p ? `${p.stopId ?? ''}|${p.point.map((n) => n.toFixed(5)).join(',')}` : '');
const stepKey = (s) => `${s.type}:${s.from.map((n) => n.toFixed(5))}>${s.to.map((n) => n.toFixed(5))}`;
const shortName = (p) => p.label.replace(/^Near /, '').split(',')[0];

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
          {riderStatusText(j) && <span className={`jeep-row-status ${j.tripStatus ?? ''}`}>{riderStatusText(j)}</span>}
          <span className="sub">{detail ?? agoText(j.updatedAt)}</span>
        </span>
        <SeatChip jeep={j} />
        <Icon name="chevron" size={16} className="menu-chevron" />
      </button>
    </li>
  );
}

// Walking and tricycle paths along real streets for the steps of a trip
// (the first walk comes from useSakayan instead). Never a straight line.
function useStepPaths(option, skipFirstWalk) {
  const [paths, setPaths] = useState({});
  const wanted = (option?.steps ?? []).filter((s, i) => s.type !== 'ride' && s.meters >= 20 && !(i === 0 && s.type === 'walk' && skipFirstWalk));
  const sig = wanted.map(stepKey).join('|');
  useEffect(() => {
    let cancelled = false;
    for (const s of wanted) {
      const k = stepKey(s);
      if (paths[k]) continue;
      (s.type === 'tricycle' ? roadPath : walkingPath)(s.from, s.to).then((r) => {
        if (!cancelled) setPaths((p) => ({ ...p, [k]: r ?? 'failed' }));
      });
    }
    return () => { cancelled = true; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return paths;
}

const PICK_TEXT = { from: 'Tap the map where you’ll start', to: 'Tap the map where you’re going' };

export default function MapScreen({ route, jeepneys, error, request, visible, onRequest }) {
  const prefs = usePrefs();
  const { user } = useAuth();
  const network = useMemo(() => networkFromRoutes([route]), [route]);
  const saved = useSavedPlaces(user);
  const { tips } = useTips(route.id, user?.id ?? null);
  const [map, setMap] = useState(null);
  const [from, setFrom] = useState(null); // { kind: 'stop'|'gps'|'map'|'place'|'saved', point, label, stopId? }
  const [to, setTo] = useState(null);
  const [me, setMe] = useState(null);
  const [pickTarget, setPickTarget] = useState(null); // 'from' | 'to' while choosing on the map
  const [selectedId, setSelectedId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dirFilter, setDirFilter] = useState('all');
  const [onlyWithSeats, setOnlyWithSeats] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showTips, setShowTips] = useState(false);
  const [openJeepId, setOpenJeepId] = useState(null);
  const closeJeep = useCallback(() => setOpenJeepId(null), []);
  const [chatOpen, setChatOpen] = useState(false);
  const handleDrag = useRef(null);
  const [chat, setChat] = useState({ messages: [GREETING], busy: false, memory: {} });
  const closeChat = useCallback(() => setChatOpen(false), []);

  const stops = route.stops;
  const [selectedLm, setSelectedLm] = useState(null); // landmark whose card is open
  const showLandmarks = prefs.showLandmarks !== false;
  const routeCenter = useMemo(() => [(route.bounds[0][0] + route.bounds[1][0]) / 2, (route.bounds[0][1] + route.bounds[1][1]) / 2], [route]);
  const sheetRef = useRef(null);
  const stopById = (id) => stops.find((s) => s.id === id);

  // Give a tapped or GPS spot a readable name ("Near Jollibee, Barangay III").
  const nameLater = useCallback((setter, place) => {
    nameForPoint(place.point).then((name) => {
      if (!name) return;
      setter((cur) => (cur && cur.point === place.point ? { ...cur, ...(cur.kind === 'gps' ? { nearName: name } : { label: name }) } : cur));
    });
  }, []);

  const chooseFrom = useCallback((place) => {
    setFrom(place);
    setMsg(null);
    if (place && (place.kind === 'map' || place.kind === 'gps')) nameLater(setFrom, place);
  }, [nameLater]);
  const chooseTo = useCallback((place) => {
    setTo(place);
    setMsg(null);
    if (place?.kind === 'map') nameLater(setTo, place);
  }, [nameLater]);

  // Open a trip sent from Saved, Routes or the AI.
  useEffect(() => {
    if (!request) return;
    setSelectedId(null);
    if (request.from || request.to) {
      if (request.from) setFrom(request.from);
      setTo(request.to ?? null);
      setDirFilter('all');
      setMsg(request.from || from ? null : { kind: 'hint', text: 'Now set where you’ll start: search, use GPS, or tap the map.' });
      return;
    }
    const legStops = route.legs[request.direction]?.stops ?? [];
    if (request.pickupStopId || request.dropoffStopId) {
      const pickup = stopById(request.pickupStopId);
      if (pickup) setFrom(stopPlace(pickup));
      const toStop = stopById(request.dropoffStopId ?? legStops[legStops.length - 1]?.id);
      setTo(toStop ? stopPlace(toStop) : null);
      setDirFilter('all');
      setMsg(request.pickupStopId || from ? null : { kind: 'hint', text: 'Now set where you’ll start: search, use GPS, or tap the map.' });
    } else {
      setTo(null);
      setDirFilter(request.direction);
      setMsg(null);
    }
  }, [request, route]); // eslint-disable-line react-hooks/exhaustive-deps

  // All good ways to get there, best first.
  const plan = useMemo(() => (from && to ? planJourneys(network, from, to) : null), [network, placeKey(from), placeKey(to)]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = plan?.options ?? [];
  const baseOption = options.find((o) => o.id === selectedId) ?? options[0] ?? null;
  const firstRideAt = baseOption ? baseOption.steps.findIndex((s) => s.type === 'ride') : -1;
  const planFirstRide = firstRideAt >= 0 ? baseOption.steps[firstRideAt] : null;

  // The passenger's sakayan: the shortest REAL walk to a street the jeepneys
  // pass (with a trip: the right direction, before the babaan). Not used
  // when they take a tricycle to the route or don't need a jeepney.
  const fromPoint = from && from.kind !== 'stop' ? from.point : null;
  const walkToRoute = !to || (planFirstRide && baseOption.steps[0].type !== 'tricycle');
  const sakayan = useSakayan(
    route,
    fromPoint && walkToRoute ? fromPoint : null,
    planFirstRide ? { direction: planFirstRide.direction, maxAlong: planFirstRide.toAlong - PLAN.minRideM } : {},
  );
  const sakayanOk = !!sakayan && !sakayan.tooFar;
  const useSakayanWalk = sakayanOk && !!planFirstRide && sakayan.direction === planFirstRide.direction;

  // The chosen option, with the real sakayan and real street distances.
  const paths = useStepPaths(baseOption, useSakayanWalk);
  const option = useMemo(() => {
    const refined = useSakayanWalk ? refineWithSakayan(baseOption, sakayan) : baseOption;
    return withMeasuredSteps(refined, (s) => {
      const p = paths[stepKey(s)];
      return p && p !== 'failed' ? p.meters : null;
    });
  }, [baseOption, sakayan, paths, useSakayanWalk]);
  const firstRide = option?.steps.find((s) => s.type === 'ride') ?? null;
  const activeDirection = firstRide?.direction ?? (!to && dirFilter !== 'all' ? dirFilter : null);

  const shown = jeepneys.filter((j) => (!onlyWithSeats || seatStatus(j).level !== 'full') && (!activeDirection || j.direction === activeDirection));

  const approaching = useMemo(() => {
    if (!firstRide) return [];
    return shown
      .map((j) => ({ ...j, gap: firstRide.fromAlong - projectOnRoute(firstRide.leg, [j.lng, j.lat]).along }))
      .filter((j) => j.gap >= -50)
      .sort((a, b) => a.gap - b.gap);
  }, [shown, firstRide]);
  // A jeepney on break, refueling or broken down isn't "coming".
  const next = approaching.find(inService);

  // Violet guide on the map: walks (dotted), rides (solid), tricycles (amber).
  const guide = useMemo(() => {
    if (!option) {
      if (!sakayanOk) return null;
      return { walks: [sakayan.walk?.coords], rides: [], trikes: [], markers: [{ kind: 'board', point: sakayan.point, label: 'Sakayan' }] };
    }
    const g = { walks: [], rides: [], trikes: [], markers: [] };
    option.steps.forEach((s, i) => {
      if (s.type === 'ride') {
        g.rides.push(sliceAlong(s.leg, s.fromAlong, s.toAlong));
        const prev = option.steps[i - 1];
        if (prev?.type !== 'transfer') g.markers.push({ kind: 'board', point: s.board, label: 'Sakayan' });
        const nxt = option.steps[i + 1];
        g.markers.push(nxt?.type === 'transfer' ? { kind: 'transfer', point: s.alight, label: 'Transfer' } : { kind: 'alight', point: s.alight, label: 'Babaan' });
        return;
      }
      if (i === 0 && s.type === 'walk' && useSakayanWalk) { g.walks.push(sakayan.walk?.coords); return; }
      const p = paths[stepKey(s)];
      if (p && p !== 'failed') (s.type === 'tricycle' ? g.trikes : g.walks).push(p.coords);
    });
    return g;
  }, [option, sakayan, paths, useSakayanWalk, sakayanOk]);

  useEffect(() => {
    if (!expanded) sheetRef.current?.scrollTo({ top: 0 });
  }, [expanded]);

  // Zoom to show the whole trip when it changes, or (no destination yet)
  // the rider and their sakayan.
  const fitKey = option ? `${option.id}|${placeKey(from)}|${placeKey(to)}` : '';
  useEffect(() => {
    if (!map || !option) return;
    const pts = [from.point, to.point];
    for (const s of option.steps) if (s.type === 'ride') pts.push(s.board, s.alight);
    const xs = pts.map((c) => c[0]);
    const ys = pts.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 16.5, duration: 600 });
  }, [map, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (to) return;
    const coords = sakayanOk && !sakayan.loading ? sakayan.walk?.coords ?? (sakayan.walkFailed ? [fromPoint, sakayan.point] : null) : null;
    if (!map || !coords) return;
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 16.5, duration: 600 });
  }, [map, sakayan]); // eslint-disable-line react-hooks/exhaustive-deps

  // "I'm waiting here": the sakayan (or chosen stop) and which way they can ride from it.
  const servedAt = (id) => Object.keys(route.legs).filter((d) => route.legs[d].stops.some((s) => s.id === id));
  const waitPoint = firstRide ? firstRide.board : to ? null : sakayanOk ? sakayan.point : from?.stopId ? stopById(from.stopId)?.coord ?? null : null;
  const waitDirections = firstRide ? [firstRide.direction] : to ? [] : sakayanOk ? sakayan.directions : from?.stopId ? servedAt(from.stopId) : [];

  // Community tips about this trip's stops and spots.
  const tripTips = useMemo(() => {
    if (!tips.length || (!option && !from)) return [];
    const stopIds = [from?.stopId, to?.stopId];
    const points = [from?.point, to?.point];
    for (const s of option?.steps ?? []) {
      if (s.type !== 'ride') continue;
      stopIds.push(s.boardNear?.stop.id, s.alightNear?.stop.id);
      points.push(s.board, s.alight);
    }
    return tipsNear(tips, { stopIds: stopIds.filter(Boolean), points }).slice(0, 5);
  }, [tips, option, from, to]);

  function onMapTap(pt) {
    // First tap away from an open landmark card just closes it.
    if (selectedLm && !pickTarget) { setSelectedLm(null); return; }
    const place = { kind: 'map', point: pt, label: 'Pinned spot' };
    if (pickTarget === 'to') chooseTo(place);
    else chooseFrom(place);
    setPickTarget(null);
  }

  // A landmark tapped on the map: open its card (or use it right away when
  // the rider is choosing a spot on the map).
  function onLandmarkTap(props) {
    const l = landmarks.list.find((x) => x.id === props.id);
    if (!l) return;
    if (pickTarget) {
      onChoose(pickTarget, landmarks.place(l));
      setPickTarget(null);
      return;
    }
    setSelectedLm(l);
  }

  function goWithLandmark(field) {
    const place = landmarks.place(selectedLm);
    setSelectedLm(null);
    addRecent(place);
    onChoose(field, place);
  }

  function onChoose(field, place) {
    setSelectedId(null);
    if (field === 'from') chooseFrom(place);
    else {
      chooseTo(place);
      if (!from) setMsg({ kind: 'hint', text: 'Now set where you’ll start: search, use GPS, or tap the map.' });
    }
  }

  function swap() {
    if (!from || !to) return;
    setSelectedId(null);
    setFrom(to);
    setTo(from);
  }

  function locateMe() {
    if (!navigator.geolocation) return setMsg({ kind: 'warn', text: 'GPS is not available on this device. Search for a place or stop instead.' });
    setMsg({ kind: 'hint', text: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pt = [p.coords.longitude, p.coords.latitude];
        setMe(pt);
        setSelectedId(null);
        chooseFrom({ kind: 'gps', point: pt, label: 'My location' });
        if (!to) map?.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 14) });
      },
      (e) => setMsg({ kind: 'warn', text: `${gpsErrorText(e)} You can also search for a place or stop instead.` }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function showTrip(t) {
    setChatOpen(false);
    setExpanded(false);
    onRequest?.(t.from || t.to ? { from: t.from ?? null, to: t.to ?? null } : { direction: t.direction, pickupStopId: t.pickupStopId, dropoffStopId: t.dropoffStopId });
  }

  async function askAI(question) {
    const messages = [...chat.messages, { role: 'user', text: question }];
    setChat((c) => ({ ...c, messages, busy: true }));
    const answer = await askAssistant({
      messages: messages.slice(1), // the greeting isn't part of the conversation
      route, jeepneys, fareType: prefs.fareType, demo: isDemo, memory: chat.memory, tips,
      mapTrip: {
        fromId: from?.stopId ?? null,
        toId: to?.stopId ?? null,
        from: from ? { label: from.kind === 'gps' ? 'My location' : from.label, point: from.point } : null,
        to: to ? { label: to.label, point: to.point } : null,
      },
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
    // "My location" moves; save the spot under its street name.
    const start = from.kind === 'gps' ? { ...from, label: from.nearName ?? 'Saved start' } : from;
    const simple = option?.rides === 1 && option.steps.length === 1 && from.stopId && to.stopId;
    try {
      await saveTrip({ name: `${shortName(start)} → ${shortName(to)}`, from: start, to, direction: simple ? firstRide.direction : null });
      setMsg({ kind: 'ok', text: 'Trip saved to your Saved tab.' });
    } catch (e) {
      setMsg({ kind: 'warn', text: `Couldn’t save: ${e.message}` });
    }
  }

  async function onSavePlace(placeKind) {
    if (!user) return setMsg({ kind: 'signin', text: 'Sign in to save places.' });
    const label = placeKind === 'other' ? window.prompt('Name this place (e.g. Lola’s house):', shortName(to)) : PLACE_KINDS[placeKind].label;
    if (!label?.trim()) return;
    try {
      await savePlace({ placeKind, label: label.trim(), point: to.point, stopId: to.stopId });
      await saved.reload();
      setMsg({ kind: 'ok', text: `Saved as ${label.trim()}. Find it when you search, and in the Saved tab.` });
    } catch (e) {
      setMsg({ kind: 'warn', text: `Couldn’t save: ${e.message}` });
    }
  }

  const fareMain = prefs.fareType === 'discounted' ? 'discounted' : 'regular';
  const fareOther = fareMain === 'regular' ? 'discounted' : 'regular';
  const fareLabel = { regular: 'Regular', discounted: 'Student / Senior / PWD' };
  const list = firstRide ? approaching : [...shown].sort((a, b) => a.direction.localeCompare(b.direction));
  const firstWalkState = useSakayanWalk ? (sakayan.loading ? 'loading' : sakayan.walkFailed ? 'failed' : null) : null;
  const quickPlaces = [...saved.places, ...stops.map(stopPlace)];

  const planProblem = plan && !option && {
    same: 'Your start and destination are the same place.',
    far_from: 'Your start is too far from the jeepney route to plan a trip (more than a short tricycle ride). Search for a place closer to the route.',
    far_to: 'That place is too far from the jeepney route to plan a trip (more than a short tricycle ride).',
    none: 'No good way found between these places. Try a nearby stop.',
  }[plan.reason];

  return (
    <div className={`map-screen ${expanded ? 'sheet-expanded' : ''} ${searchOpen ? 'searching' : ''}`}>
      <MapView
        route={route} jeepneys={shown} pickup={from?.point ?? null} dest={to?.point ?? null} me={me} guide={guide} onPick={onMapTap} onJeepTap={setOpenJeepId}
        activeDirection={activeDirection} visible={visible} onReady={setMap}
        landmarks={landmarks.list} showLandmarks={showLandmarks} onLandmarkTap={onLandmarkTap} selectedLandmark={selectedLm?.id}
        padding={{ top: 170, bottom: expanded ? 420 : 230 }}
      />

      <div className="map-top-overlay">
        {pickTarget ? (
          <div className="pick-banner" role="status">
            <Icon name="target" size={18} />
            <span>{PICK_TEXT[pickTarget]}</span>
            <button className="link-btn small" onClick={() => setPickTarget(null)}>Cancel</button>
          </div>
        ) : (
          <TripSearch
            route={route} from={from} to={to} savedPlaces={saved.places} near={from?.point ?? me ?? routeCenter}
            onChoose={onChoose} onLocate={locateMe} onPickOnMap={setPickTarget} onSwap={swap} onOpenChange={setSearchOpen}
          />
        )}
        {!searchOpen && !pickTarget && (
          <ScrollRow className="chip-row-wrap" trackClassName="chip-row" role="list" aria-label="Quick destinations">
            {quickPlaces.map((p) => (
              <button key={p.id ?? p.stopId} role="listitem" className={`chip ${to && placeKey(to) === placeKey(p) ? 'on' : ''} ${p.kind === 'saved' ? 'saved' : ''}`} onClick={() => onChoose('to', p)}>
                <Icon name={p.icon} size={15} /> {p.kind === 'saved' ? p.label : stopById(p.stopId)?.short ?? p.label}
              </button>
            ))}
          </ScrollRow>
        )}
      </div>

      <div className="map-float-right">
        <MapButtons map={map} onLocate={locateMe}>
          <button className="ai-fab" onClick={() => setChatOpen(true)} aria-label="Ask Sakay AI" title="Ask Sakay AI">
            <AiLogo size={62} />
          </button>
          <button
            className={`map-btn landmark-toggle ${showLandmarks ? 'on' : ''}`} aria-pressed={showLandmarks}
            onClick={() => { setPrefs({ showLandmarks: !showLandmarks }); setSelectedLm(null); }}
            aria-label={showLandmarks ? 'Hide landmarks' : 'Show landmarks'} title={showLandmarks ? 'Hide landmarks' : 'Show landmarks'}
          >
            <Icon name="church" size={20} />
          </button>
        </MapButtons>
      </div>

      {selectedLm && !searchOpen && (
        <LandmarkCard
          landmark={selectedLm} route={route}
          onGo={() => goWithLandmark('to')} onStart={() => goWithLandmark('from')} onClose={() => setSelectedLm(null)}
        />
      )}

      <section
        ref={sheetRef}
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

        {option ? (
          <>
            <div className="trip-summary">
              <div className="trip-summary-main">
                <span className="label">
                  ~{fmtMinutes(option.minutes)} · {option.rides === 0 ? 'no jeepney needed' : option.rides === 1 ? '1 jeepney' : `${option.rides} jeepneys`}
                  {option.walkM >= 30 ? ` · ${fmtMeters(option.walkM)} walk` : ''}
                </span>
                <div className="trip-to">To {to.label}</div>
                <div className="fare-line">
                  <b className="fare-big">{fareText(option, fareMain)}</b>
                  {option.fare.regular > 0 && (
                    <button className="link-btn small" onClick={() => setPrefs({ fareType: fareOther })}>
                      {fareLabel[fareOther]} {peso(option.fare[fareOther])}
                    </button>
                  )}
                </div>
              </div>
              <button className="round-action" onClick={onSave} aria-label="Save trip"><Icon name="heart" size={22} /></button>
            </div>
            <OptionCards options={options.map((o) => (o.id === option.id ? option : o))} selectedId={option.id} onSelect={setSelectedId} fareType={fareMain} />
          </>
        ) : (
          <div className="sheet-head">
            <div>
              <div className="sheet-title">{shown.length} jeepney{shown.length === 1 ? '' : 's'} on the road</div>
              <div className="sub">{to || from ? 'Set both From and To to plan your trip.' : 'Where are you going? Search any place, stop or landmark.'}</div>
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

        {planProblem && <p className="warn">{planProblem}</p>}
        {!to && sakayan?.tooFar && <p className="warn">You’re {(sakayan.off / 1000).toFixed(1)} km from the nearest street the jeepneys pass. Search for your destination to see other ways, or tap the map closer to the colored line.</p>}
        {!to && fromPoint && sakayanOk && (
          <div className="walk-hint">
            <span className="walk-dot" />
            <span>
              {sakayan.loading
                ? <>Finding the walking route to the nearest <b>sakayan</b>…</>
                : sakayan.walkFailed
                  ? <>Couldn’t load walking directions right now. Walk to the violet <b>Sakayan</b> pin on the map. <button className="link-btn small" onClick={sakayan.retry}>Try again</button></>
                  : !sakayan.walk
                    ? <>You’re on the jeepney route. Wait here for a jeepney.</>
                    : <>Walk <b>~{sakayan.walk.meters < 1000 ? `${Math.round(sakayan.walk.meters / 10) * 10} m` : `${(sakayan.walk.meters / 1000).toFixed(1)} km`}</b> (~{walkMinutes(sakayan.walk.meters)} min) to the nearest <b>sakayan</b>.</>}
            </span>
            {sakayan.directions.length > 0 && (
              <span className="walk-sub">
                Jeepneys {sakayan.directions.map((d) => DIRECTIONS[d].label.replace(/^To /, 'to ')).join(' and ')} pass there.
              </span>
            )}
          </div>
        )}
        {msg && (
          <p className={msg.kind === 'ok' ? 'ok' : msg.kind === 'warn' ? 'warn' : 'hint'}>
            {msg.text}{' '}
            {msg.kind === 'signin' && <button className="link-btn small" onClick={() => setPrefs({ guest: false })}>Sign in</button>}
          </p>
        )}
        {error && <p className="warn">Couldn’t load jeepneys: {error}</p>}

        {firstRide && (
          <div className={`next-jeep ${next ? '' : 'none'}`}>
            <Icon name="clock" size={18} />
            {next
              ? <span><b>{next.gap <= 100 ? 'Arriving now' : `Next jeepney in ~${minutes(next.gap)} min`}</b> · {next.plate} · {seatStatus(next).text}</span>
              : <span>No jeepney heading your way right now.</span>}
          </div>
        )}

        {option && (
          <section className="journey" aria-label="Trip steps">
            <Timeline option={option} from={from} to={to} fareType={fareMain} firstWalkState={firstWalkState} onRetryWalk={sakayan?.retry} />
          </section>
        )}

        {tripTips.length > 0 && (
          <div className="tips-strip">
            <button className="tips-strip-head" onClick={() => setShowTips(!showTips)} aria-expanded={showTips}>
              <Icon name="chat" size={18} />
              <span><b>{tripTips.length} tip{tripTips.length === 1 ? '' : 's'} from commuters</b> for this trip</span>
              <Icon name="chevron" size={16} className={`menu-chevron ${showTips ? 'turned' : ''}`} />
            </button>
            {showTips && (
              <ul>
                {tripTips.map((t) => (
                  <li key={t.id}>
                    <span className="tip-cat">{TIP_CATEGORIES[t.category].label}</span> {t.body}
                    <span className="sub"> · {t.author}, {tipAge(t.createdAt)}{t.helpful ? ` · ${t.helpful} found helpful` : ''}</span>
                  </li>
                ))}
                <li><button className="link-btn small" onClick={() => navigate('routes/community')}>See all tips or share one</button></li>
              </ul>
            )}
          </div>
        )}

        {!isDemo && (firstRide || !to) && <WaitingCard route={route} user={user} point={waitPoint} directions={waitDirections} />}

        {option && to.kind !== 'saved' && (
          <div className="save-place">
            <span className="label">Save {shortName(to)} as</span>
            <div className="save-place-row">
              {Object.entries(PLACE_KINDS).map(([k, v]) => (
                <button key={k} className="chip small" onClick={() => onSavePlace(k)}><Icon name={v.icon} size={14} /> {k === 'other' ? 'Other…' : v.label}</button>
              ))}
            </div>
          </div>
        )}

        {(firstRide || !to) && (
          <>
            <div className="sheet-section-head">
              <h3>{firstRide ? 'Coming to your sakayan' : 'On the road now'}</h3>
              <label className="switch-label">
                <span>Free seats only</span>
                <input type="checkbox" className="switch" checked={onlyWithSeats} onChange={(e) => setOnlyWithSeats(e.target.checked)} />
              </label>
            </div>
            {list.length ? (
              <ul className="jeep-list">
                {list.map((j) => (
                  <JeepRow key={j.id} j={j} onOpen={setOpenJeepId} detail={j.gap != null && inService(j) ? `${j.gap <= 100 ? 'Arriving now' : `~${minutes(j.gap)} min · ${(j.gap / 1000).toFixed(1)} km away`} · ${agoText(j.updatedAt)}` : undefined} />
                ))}
              </ul>
            ) : (
              <p className="hint">No jeepneys are sharing their location right now.</p>
            )}
          </>
        )}

        <div className="legend-row">
          {guide && <span><i style={{ background: GUIDE_COLOR }} />Your trip</span>}
          {option?.fare.tricycle > 0 && <span><i style={{ background: TRIKE_COLOR }} />Tricycle</span>}
          {DIRECTION_KEYS.map((d) => <span key={d}><i style={{ background: DIRECTIONS[d].color }} />{DIRECTIONS[d].label}</span>)}
        </div>
        <p className="fineprint">Tap a jeepney to see its driver. Times, seats and fares are estimates; actual fares can vary. Not affiliated with LTFRB or any LGU.</p>
      </section>

      {openJeepId && (
        <DriverSheet jeepId={openJeepId} jeep={jeepneys.find((j) => j.id === openJeepId) ?? null} onClose={closeJeep} />
      )}

      {chatOpen && <AssistantSheet chat={chat} onSend={askAI} onShowTrip={showTrip} onClose={closeChat} />}
    </div>
  );
}
