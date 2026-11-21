import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import MapView, { MapButtons, GUIDE_COLOR, TRIKE_COLOR } from '../components/MapView.jsx';
import Icon, { AiLogo } from '../components/Icon.jsx';
import { projectOnRoute, sliceAlong } from '../lib/geo.js';
import { walkMinutes, walkingPath, roadPath } from '../lib/walking.js';
import { useSakayan } from '../lib/useSakayan.js';
import { peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs, setPrefs, isDataSaver, useNightMap } from '../lib/prefs.js';
import { haptic } from '../lib/haptics.js';
import { useAuth } from '../lib/auth.jsx';
import { saveTrip, savePlace, PLACE_KINDS } from '../lib/account.js';
import { useSavedPlaces } from '../lib/useSavedPlaces.js';
import { useTips, tipsNear, TIP_CATEGORIES, tipAge } from '../lib/community.js';
import { isDemo } from '../lib/supabase.js';
import { planJourneys, networkFromRoutes, refineWithSakayan, withMeasuredSteps, alignWithPaths, PLAN, fmtMinutes, fmtMeters } from '../lib/planner.js';
import { nameForPoint, stopPlace } from '../lib/places.js';
import { loadPlaces } from '../lib/placeData.js';
import { BROWSE, DEFAULT_SHORTCUTS } from '../lib/placeIndex.js';
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
import { useCommunityPlaces, terminalNear, VEHICLES, POST_KINDS, fareText as communityFare } from '../lib/communityPosts.js';
import { useWeather, describeWeather } from '../lib/weather.js';
import { parseTripLink } from '../lib/share.js';
import ShareSheet from '../components/ShareSheet.jsx';
import { useTripGuide, GuideBanner, speak } from '../components/TripGuide.jsx';
import { stepLines } from '../lib/tripGuide.js';
import { useAppSettings, serviceStatus } from '../lib/settings.js';
import { t, tParts, currentLanguage } from '../lib/i18n.js';

const AVG_SPEED_MPS = 20 / 3.6; // jeepneys average ~20 km/h with stops
const SHEET_MIN_PX = 236; // the small panel's height (styles.css --sheet-h)

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
          <span className="sub">{tParts(place.sub)}</span>
          <span className="sub">
            {landmark.rank === 0 ? `${RANK_LABEL[0]} · ` : ''}
            {off < 40 ? t("The jeepney passes right in front") : `About ${fmtMeters(off)} from the jeepney route`}
          </span>
        </div>
        <button className="icon-btn small" onClick={onClose} aria-label={t("Close")}><Icon name="close" size={16} /></button>
      </div>
      <div className="landmark-actions">
        <button className="btn primary small" onClick={onGo}><Icon name="pin" size={15} />{' '}{t("Go here")}</button>
        <button className="btn small" onClick={onStart}><Icon name="locate" size={15} />{' '}{t("Start here")}</button>
      </div>
    </div>
  );
}

// The card for a tricycle route or terminal added by commuters.
function CommunityCard({ place, onGo, onStart, onClose }) {
  const kind = POST_KINDS[place.kind] ?? POST_KINDS.terminal;
  const fares = communityFare(place.fares ?? {});
  return (
    <div className="landmark-card" role="dialog" aria-label={place.name}>
      <div className="landmark-card-head">
        <span className="landmark-icon community"><Icon name={kind.icon} size={18} /></span>
        <div>
          <b>{place.name}</b>
          <span className="sub">{kind.label}{' '}{t("· from commuters")}{place.vehicles?.length ? ` · ${place.vehicles.map((v) => VEHICLES[v]?.label ?? v).join(', ')}` : ''}</span>
          {(fares || place.hours) && <span className="sub">{[fares, place.hours].filter(Boolean).join(' · ')}</span>}
          {place.confirms > 0 && <span className="sub">{place.confirms === 1 ? t('1 commuter confirmed this') : t('{n} commuters confirmed this', { n: place.confirms })}</span>}
        </div>
        <button className="icon-btn small" onClick={onClose} aria-label={t("Close")}><Icon name="close" size={16} /></button>
      </div>
      <div className="landmark-actions">
        {place.point && <button className="btn primary small" onClick={onGo}><Icon name="pin" size={15} />{' '}{t("Go here")}</button>}
        {place.point && <button className="btn small" onClick={onStart}><Icon name="locate" size={15} />{' '}{t("Start here")}</button>}
        <button className="btn small" onClick={() => navigate('community')}><Icon name="chat" size={15} />{' '}{t("Community")}</button>
      </div>
    </div>
  );
}

// Light or night map (night uses no extra load: same map pieces).
function MapStyleButton() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const value = prefs.mapStyle ?? 'auto';
  return (
    <div className="map-style-wrap">
      <button className={`map-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t("Map style")} title={t("Map style")}>
        <Icon name="layers" size={20} />
      </button>
      {open && (
        <div className="map-style-pop" role="menu">
          {[['auto', 'Auto', 'Follows dark mode'], ['day', 'Light', ''], ['night', 'Night', 'Easier on the eyes at night']].map(([k, label, sub]) => (
            <button key={k} role="menuitemradio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => { setPrefs({ mapStyle: k }); setOpen(false); haptic.tap(); }}>
              <span className="radio" /><span><b>{label}</b>{sub && <small>{sub}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WeatherChip({ weather }) {
  if (!weather) return null;
  const d = describeWeather(weather.code);
  return (
    <span className={`weather-chip ${weather.rainSoon ? 'rain' : ''}`} title={weather.rainSoon ? t("Rain is likely in the next 3 hours") : d.text}>
      <Icon name={weather.rainSoon && d.icon !== 'storm' ? 'rain' : d.icon} size={15} /> {weather.temp}°{weather.rainSoon ? t(" · rain soon") : ''}
    </span>
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

const routeCenterOf = (route) => [(route.bounds[0][0] + route.bounds[1][0]) / 2, (route.bounds[0][1] + route.bounds[1][1]) / 2];
const communityPlace = (p) => ({ kind: 'place', id: `community:${p.id}`, label: p.name, sub: `${POST_KINDS[p.kind]?.label ?? 'Place'} · from commuters`, point: p.point ?? p.path?.[0], icon: p.kind === 'terminal' ? 'terminal' : 'routes' });
const PICK_TEXT = { from: 'Tap the map where you’ll start', to: 'Tap the map where you’re going' };

export default function MapScreen({ route, jeepneys, error, request, visible, onRequest, onTracking }) {
  const prefs = usePrefs();
  const night = useNightMap();
  const showAi = prefs.showAssistant !== false;
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
  const [searchRequest, setSearchRequest] = useState(null); // open the search from a shortcut
  const [selectedCp, setSelectedCp] = useState(null); // community route / terminal whose card is open
  const [sharing, setSharing] = useState(false);
  const [guiding, setGuiding] = useState(false); // trip mode (Start)
  const settings = useAppSettings();
  const community = useCommunityPlaces(route.id);
  const weather = useWeather(routeCenterOf(route), visible && !isDemo);
  const handleDrag = useRef(null);
  const screenRef = useRef(null);
  const [chat, setChat] = useState({ messages: [GREETING], busy: false, memory: {} });
  const closeChat = useCallback(() => setChatOpen(false), []);

  const stops = route.stops;
  const [selectedLm, setSelectedLm] = useState(null); // landmark whose card is open
  const showLandmarks = prefs.showLandmarks !== false;
  const routeCenter = useMemo(() => [(route.bounds[0][0] + route.bounds[1][0]) / 2, (route.bounds[0][1] + route.bounds[1][1]) / 2], [route]);
  const sheetRef = useRef(null);
  const stopById = (id) => stops.find((s) => s.id === id);

  // Give a tapped or GPS spot a readable name ("Rizal St, Poblacion,
  // Magdalena") from the streets and barangays on the phone: no load used.
  // Only if we know nothing there do we ask online (not with Data saver).
  const nameLater = useCallback((setter, place) => {
    const apply = (name) => setter((cur) => (cur && cur.point === place.point ? { ...cur, ...(cur.kind === 'gps' ? { nearName: name } : { label: name }) } : cur));
    const online = () => { if (!isDataSaver()) nameForPoint(place.point).then((name) => name && apply(name)); };
    loadPlaces().then((idx) => {
      const r = idx.reverse(place.point);
      if (r) apply(r.label); else online();
    }).catch(online);
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

  // A shared trip link ("#/map?to=..."): open it once, then tidy the address.
  useEffect(() => {
    const shared = parseTripLink(window.location.hash, route);
    if (!shared) return;
    if (shared.from) setFrom(shared.from);
    if (shared.to) setTo(shared.to);
    if (!shared.from) setMsg({ kind: 'hint', text: t("Shared trip: now set where you’ll start (search, GPS or tap the map).") });
    window.history.replaceState(null, '', '#/map');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Move the map to something shown from Community once the map is on screen
  // (it has no size while another tab is open).
  const pendingFocus = useRef(null);
  useEffect(() => {
    const pts = pendingFocus.current;
    if (!visible || !map || !pts) return undefined;
    const t = setTimeout(() => {
      pendingFocus.current = null;
      const xs = pts.map((c) => c[0]);
      const ys = pts.map((c) => c[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 17, duration: 600 });
    }, 80);
    return () => clearTimeout(t);
  }, [visible, map, request]);

  // Open a trip sent from Saved, Routes or the AI.
  useEffect(() => {
    if (!request) return;
    if (request.focus) {
      // "Show on map" from Community or Routes.
      const f = request.focus;
      setSelectedLm(null);
      setSelectedCp(community.find((c) => c.id === f.id) ?? f);
      pendingFocus.current = f.path?.length ? f.path : f.point ? [f.point] : null;
      return;
    }
    setSelectedId(null);
    if (request.from || request.to) {
      if (request.from) setFrom(request.from);
      setTo(request.to ?? null);
      setDirFilter('all');
      setMsg(request.from || from ? null : { kind: 'hint', text: t("Now set where you’ll start: search, use GPS, or tap the map.") });
      return;
    }
    const legStops = route.legs[request.direction]?.stops ?? [];
    if (request.pickupStopId || request.dropoffStopId) {
      const pickup = stopById(request.pickupStopId);
      if (pickup) setFrom(stopPlace(pickup));
      const toStop = stopById(request.dropoffStopId ?? legStops[legStops.length - 1]?.id);
      setTo(toStop ? stopPlace(toStop) : null);
      setDirFilter('all');
      setMsg(request.pickupStopId || from ? null : { kind: 'hint', text: t("Now set where you’ll start: search, use GPS, or tap the map.") });
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
    const pathOf = (s) => {
      const p = paths[stepKey(s)];
      return p && p !== 'failed' ? p : null;
    };
    const measured = withMeasuredSteps(refined, (s) => pathOf(s)?.meters ?? null);
    // Get on where the real road first reaches the route (not after riding
    // a tricycle along the jeepney's route), and off where it leaves it.
    return alignWithPaths(measured, pathOf);
  }, [baseOption, sakayan, paths, useSakayanWalk]);
  const firstRide = option?.steps.find((s) => s.type === 'ride') ?? null;
  // While a trip is planned, the app checks for jeepneys more often (to
  // show the next one coming); otherwise less often, to save data.
  const tracking = !!firstRide && visible;
  useEffect(() => { onTracking?.(tracking); }, [tracking, onTracking]);
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

  // Trip mode: follow the rider's GPS through the steps.
  const voice = prefs.guideVoice === 'off' ? 'off' : currentLanguage() === 'en' ? 'en' : 'tl';
  const lines = useMemo(() => (option ? stepLines(option, (s) => {
    if (option.steps[0] === s && s.type === 'walk' && useSakayanWalk && sakayan.walk?.coords) return { coords: sakayan.walk.coords };
    const p = paths[stepKey(s)];
    return p && p !== 'failed' ? p : null;
  }) : null), [option, paths, useSakayanWalk, sakayan]);
  const tripGuide = useTripGuide({
    active: guiding && !!option,
    option, lines, dest: to?.point ?? null, voice,
    onPosition: setMe,
    onReroute: (pt) => {
      setSelectedId(null);
      setFrom({ kind: 'gps', point: pt, label: t('My location') });
      setMsg({ kind: 'hint', text: t('You went another way, so we planned again from where you are.') });
    },
  });
  // Follow the rider on the map.
  useEffect(() => {
    if (!guiding || !map || !me) return;
    map.easeTo({ center: me, zoom: Math.max(map.getZoom(), tripGuide.state?.phase === 'ride' ? 15 : 16.5), duration: 800 });
  }, [guiding, me]); // eslint-disable-line react-hooks/exhaustive-deps

  function startGuide() {
    if (!navigator.geolocation) return setMsg({ kind: 'warn', text: t('GPS is not available on this device.') });
    haptic.success();
    setGuiding(true);
    setExpanded(false);
    setSelectedLm(null);
    setSelectedCp(null);
    speak('start', voice);
  }
  // Re-planning found no way (or the trip was cleared): leave trip mode.
  useEffect(() => {
    if (guiding && plan && !option) { setGuiding(false); setMsg({ kind: 'warn', text: t('No way found from here. Search again, or ask someone nearby.') }); }
    if (guiding && !to) setGuiding(false);
  }, [guiding, plan, option, to]); // eslint-disable-line react-hooks/exhaustive-deps
  function endGuide() {
    setGuiding(false);
    haptic.tap();
  }
  // Is the jeepney running at this hour? (Times set by the admin.)
  const service = serviceStatus(settings.service_hours, firstRide?.direction ?? (dirFilter !== 'all' ? dirFilter : 'to_santa_cruz'));
  const serviceText = service.state === 'before_first'
    ? t('Jeepneys {dir} usually start around {time}.', { dir: DIRECTIONS[firstRide?.direction]?.label ?? '', time: service.first })
    : service.state === 'after_last'
      ? t('The last jeepney {dir} usually leaves around {time}. There may be no more trips tonight.', { dir: DIRECTIONS[firstRide?.direction]?.label ?? '', time: service.last })
      : service.state === 'last_soon'
        ? t('Last trip {dir} around {time} ({min} min from now).', { dir: DIRECTIONS[firstRide?.direction]?.label ?? '', time: service.last, min: service.minutesLeft })
        : null;

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
      // A step moved by alignWithPaths carries its shortened path.
      const p = s.coords ? { coords: s.coords } : paths[stepKey(s)];
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
    if (guiding) return; // during trip mode, a stray tap must not change the trip
    // First tap away from an open landmark card just closes it.
    if ((selectedLm || selectedCp) && !pickTarget) { setSelectedLm(null); setSelectedCp(null); return; }
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
    haptic.tap();
    setSelectedLm(l);
  }

  function onCommunityTap(id) {
    const p = community.find((c) => c.id === id);
    if (!p) return;
    if (pickTarget) {
      onChoose(pickTarget, communityPlace(p));
      setPickTarget(null);
      return;
    }
    haptic.tap();
    setSelectedLm(null);
    setSelectedCp(p);
  }

  function goWithCommunity(field) {
    const place = communityPlace(selectedCp);
    setSelectedCp(null);
    addRecent(place);
    onChoose(field, place);
  }

  function goWithLandmark(field) {
    const place = landmarks.place(selectedLm);
    setSelectedLm(null);
    addRecent(place);
    onChoose(field, place);
  }

  function onChoose(field, place) {
    haptic.tap();
    setSelectedId(null);
    if (field === 'from') chooseFrom(place);
    else {
      chooseTo(place);
      if (!from) setMsg({ kind: 'hint', text: t("Now set where you’ll start: search, use GPS, or tap the map.") });
    }
  }

  function swap() {
    haptic.tap();
    if (!from || !to) return;
    setSelectedId(null);
    setFrom(to);
    setTo(from);
  }

  function locateMe() {
    if (!navigator.geolocation) return setMsg({ kind: 'warn', text: t("GPS is not available on this device. Search for a place or stop instead.") });
    setMsg({ kind: 'hint', text: t("Finding your location…") });
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
        from: from ? { label: from.kind === 'gps' ? t("My location") : from.label, point: from.point } : null,
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
    if (!user) return setMsg({ kind: 'signin', text: t("Sign in to save trips.") });
    // "My location" moves; save the spot under its street name.
    const start = from.kind === 'gps' ? { ...from, label: from.nearName ?? 'Saved start' } : from;
    const simple = option?.rides === 1 && option.steps.length === 1 && from.stopId && to.stopId;
    try {
      await saveTrip({ name: `${shortName(start)} → ${shortName(to)}`, from: start, to, direction: simple ? firstRide.direction : null });
      haptic.success();
      setMsg({ kind: 'ok', text: t("Trip saved to your Saved tab.") });
    } catch (e) {
      setMsg({ kind: 'warn', text: `Couldn’t save: ${e.message}` });
    }
  }

  async function onSavePlace(placeKind) {
    if (!user) return setMsg({ kind: 'signin', text: t("Sign in to save places.") });
    const label = placeKind === 'other' ? window.prompt('Name this place (e.g. Lola’s house):', shortName(to)) : PLACE_KINDS[placeKind].label;
    if (!label?.trim()) return;
    try {
      await savePlace({ placeKind, label: label.trim(), point: to.point, stopId: to.stopId });
      await saved.reload();
      haptic.success();
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
  const shortcuts = (prefs.shortcuts ?? DEFAULT_SHORTCUTS).filter((k) => BROWSE[k]);
  // A tricycle terminal commuters marked near where the tricycle starts.
  const trikeStep = option?.steps.find((s) => s.type === 'tricycle');
  const trikeTerminal = trikeStep && community.length ? terminalNear(community, trikeStep.from) : null;

  const planProblem = plan && !option && {
    same: 'Your start and destination are the same place.',
    far_from: 'Your start is too far from the jeepney route to plan a trip (more than a short tricycle ride). Search for a place closer to the route.',
    far_to: 'That place is too far from the jeepney route to plan a trip (more than a short tricycle ride).',
    none: 'No good way found between these places. Try a nearby stop.',
  }[plan.reason];

  return (
    <div ref={screenRef} className={`map-screen ${expanded ? 'sheet-expanded' : ''} ${searchOpen ? 'searching' : ''}`}>
      <MapView
        key={night ? 'night' : 'day'} night={night}
        route={route} jeepneys={shown} pickup={from?.point ?? null} dest={to?.point ?? null} me={me} guide={guide} onPick={onMapTap} onJeepTap={setOpenJeepId}
        activeDirection={activeDirection} visible={visible} onReady={setMap}
        landmarks={landmarks.list} showLandmarks={showLandmarks} onLandmarkTap={onLandmarkTap} selectedLandmark={selectedLm?.id}
        community={community} onCommunityTap={onCommunityTap}
        padding={{ top: 170, bottom: expanded ? 420 : 230 }}
      />

      <div className="map-top-overlay">
        {guiding && option ? (
          <GuideBanner
            option={option} state={tripGuide.state} to={to} next={next} gpsError={tripGuide.gpsError} voice={voice}
            onVoice={() => setPrefs({ guideVoice: voice === 'off' ? 'on' : 'off' })}
            onEnd={endGuide} onReport={() => { endGuide(); navigate('more/report'); }}
          />
        ) : pickTarget ? (
          <div className="pick-banner" role="status">
            <Icon name="target" size={18} />
            <span>{PICK_TEXT[pickTarget]}</span>
            <button className="link-btn small" onClick={() => setPickTarget(null)}>{t("Cancel")}</button>
          </div>
        ) : (
          <TripSearch
            route={route} from={from} to={to} savedPlaces={saved.places} near={from?.point ?? me ?? routeCenter}
            onChoose={onChoose} onLocate={locateMe} onPickOnMap={setPickTarget} onSwap={swap} onOpenChange={setSearchOpen}
            openRequest={searchRequest}
          />
        )}
        {!searchOpen && !pickTarget && !guiding && (
          <ScrollRow className="chip-row-wrap" trackClassName="chip-row" role="list" aria-label={t("Quick destinations")}>
            <WeatherChip weather={weather} />
            {saved.places.map((p) => (
              <button key={p.id} role="listitem" className={`chip saved ${to && placeKey(to) === placeKey(p) ? 'on' : ''}`} onClick={() => onChoose('to', p)}>
                <Icon name={p.icon} size={15} /> {p.label}
              </button>
            ))}
            {shortcuts.map((k) => (
              <button key={k} role="listitem" className="chip kind" onClick={() => { haptic.tap(); setSearchRequest({ field: 'to', browse: k, at: Date.now() }); }}>
                <Icon name={BROWSE[k].icon} size={15} /> {BROWSE[k].short ?? BROWSE[k].label}
              </button>
            ))}
            <button role="listitem" className="chip ghost" onClick={() => navigate('more/preferences')} aria-label={t("Edit shortcuts")}>
              <Icon name="pencil" size={14} />{' '}{t("Edit")}
            </button>
            {quickPlaces.filter((p) => p.kind === 'stop').map((p) => (
              <button key={p.stopId} role="listitem" className={`chip ${to && placeKey(to) === placeKey(p) ? 'on' : ''}`} onClick={() => onChoose('to', p)}>
                <Icon name={p.icon} size={15} /> {stopById(p.stopId)?.short ?? p.label}
              </button>
            ))}
          </ScrollRow>
        )}
      </div>

      <div className="map-float-right">
        <MapButtons map={map} onLocate={locateMe}>
          {showAi && (
            <button className="ai-fab" onClick={() => setChatOpen(true)} aria-label={t("Ask Sakay AI")} title={t("Ask Sakay AI")}>
              <AiLogo size={62} />
            </button>
          )}
          <MapStyleButton />
          <button
            className={`map-btn landmark-toggle ${showLandmarks ? 'on' : ''}`} aria-pressed={showLandmarks}
            onClick={() => { setPrefs({ showLandmarks: !showLandmarks }); setSelectedLm(null); }}
            aria-label={showLandmarks ? t("Hide landmarks") : t("Show landmarks")} title={showLandmarks ? t("Hide landmarks") : t("Show landmarks")}
          >
            <Icon name="church" size={20} />
          </button>
        </MapButtons>
      </div>

      {selectedCp && !searchOpen && (
        <CommunityCard place={selectedCp} onGo={() => goWithCommunity('to')} onStart={() => goWithCommunity('from')} onClose={() => setSelectedCp(null)} />
      )}

      {selectedLm && !searchOpen && (
        <LandmarkCard
          landmark={selectedLm} route={route}
          onGo={() => goWithLandmark('to')} onStart={() => goWithLandmark('from')} onClose={() => setSelectedLm(null)}
        />
      )}

      <section
        ref={sheetRef}
        className={`bottom-sheet ${expanded ? 'expanded' : ''}`} aria-label={t("Trip details")}
        // Scrolling down in the small panel opens it fully.
        onScroll={(e) => { if (!expanded && e.currentTarget.scrollTop > 40) setExpanded(true); }}
      >
        <button
          className="sheet-handle" aria-label={expanded ? t("Show less") : t("Show more")} aria-expanded={expanded}
          // The panel follows the finger, then settles open or closed
          // depending on where it was let go and how fast it was flicked.
          onPointerDown={(e) => {
            handleDrag.current = { y: e.clientY, startH: sheetRef.current.getBoundingClientRect().height, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false, swiped: false };
            e.currentTarget.setPointerCapture(e.pointerId); // keep following the finger off the handle
          }}
          onPointerMove={(e) => {
            const d = handleDrag.current;
            const screen = screenRef.current;
            if (!d || !screen) return;
            const dy = e.clientY - d.y;
            if (!d.moved && Math.abs(dy) < 6) return;
            d.moved = true;
            const dt = Math.max(1, e.timeStamp - d.lastT);
            d.v = (e.clientY - d.lastY) / dt; // px per ms, + = down
            d.lastY = e.clientY;
            d.lastT = e.timeStamp;
            const max = screen.clientHeight * 0.68;
            const h = Math.min(max + 16, Math.max(SHEET_MIN_PX - 24, d.startH - dy));
            d.h = h;
            screen.classList.add('sheet-dragging');
            screen.style.setProperty('--sheet-h', `${h}px`);
          }}
          onPointerUp={() => {
            const d = handleDrag.current;
            const screen = screenRef.current;
            if (!d || !d.moved || !screen) return;
            d.swiped = true;
            const max = screen.clientHeight * 0.68;
            const open = d.v < -0.35 ? true : d.v > 0.35 ? false : d.h > (SHEET_MIN_PX + max) / 2;
            screen.classList.remove('sheet-dragging');
            screen.style.removeProperty('--sheet-h');
            if (open !== expanded) haptic.tap();
            setExpanded(open);
          }}
          onPointerCancel={() => {
            screenRef.current?.classList.remove('sheet-dragging');
            screenRef.current?.style.removeProperty('--sheet-h');
            handleDrag.current = null;
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
        {isDemo && <p className="demo-note">{t("Demo mode: jeepneys are simulated.")}</p>}

        {option ? (
          <>
            <div className="trip-summary">
              <div className="trip-summary-main">
                <span className="label">
                  ~{fmtMinutes(option.minutes)} · {option.rides === 0 ? t('no jeepney needed') : option.rides === 1 ? t('1 jeepney') : t('{n} jeepneys', { n: option.rides })}
                  {option.walkM >= 30 ? ` · ${t('{d} walk', { d: fmtMeters(option.walkM) })}` : ''}
                </span>
                <div className="trip-to">{t("To")}{' '}{to.label}</div>
                <div className="fare-line">
                  <b key={`${option.id}|${fareMain}`} className="fare-big pop">{fareText(option, fareMain)}</b>
                  {option.fare.regular > 0 && (
                    <button className="link-btn small" onClick={() => setPrefs({ fareType: fareOther })}>
                      {t(fareLabel[fareOther])} {peso(option.fare[fareOther])}
                    </button>
                  )}
                </div>
              </div>
              <div className="round-actions">
                <button className="round-action" onClick={() => { haptic.tap(); setSharing(true); }} aria-label={t("Share trip")}><Icon name="share" size={21} /></button>
                <button className="round-action" onClick={onSave} aria-label={t("Save trip")}><Icon name="heart" size={22} /></button>
              </div>
            </div>
            {!guiding && (
              <button className="btn primary wide start-btn" onClick={startGuide}>
                <Icon name="play" size={18} fill="currentColor" /> {t('Start')} <span className="start-sub">{t('We’ll tell you when to get off')}</span>
              </button>
            )}
            {serviceText && <p className={service.state === 'running' ? 'hint' : 'warn'}><Icon name="clock" size={15} /> {serviceText}</p>}
            <OptionCards options={options.map((o) => (o.id === option.id ? option : o))} selectedId={option.id} onSelect={(id) => { haptic.tap(); setSelectedId(id); }} fareType={fareMain} />
          </>
        ) : (
          <div className="sheet-head">
            <div>
              <div className="sheet-title">{shown.length === 1 ? t('1 jeepney on the road') : t('{n} jeepneys on the road', { n: shown.length })}</div>
              <div className="sub">{to || from ? t("Set both From and To to plan your trip.") : t("Where are you going? Search any place, stop or landmark.")}</div>
            </div>
            <div className="dir-filter">
              {['all', ...DIRECTION_KEYS].map((d) => (
                <button key={d} className={`${dirFilter === d ? 'on' : ''} ${d === 'all' ? '' : DIRECTIONS[d].className}`} onClick={() => setDirFilter(d)}>
                  {d === 'all' ? t("All") : DIRECTIONS[d].short}
                </button>
              ))}
            </div>
          </div>
        )}

        {planProblem && <p className="warn">{planProblem}</p>}
        {!to && sakayan?.tooFar && <p className="warn">{t("You’re")}{' '}{(sakayan.off / 1000).toFixed(1)}{' '}{t("km from the nearest street the jeepneys pass. Search for your destination to see other ways, or tap the map closer to the colored line.")}</p>}
        {!to && fromPoint && sakayanOk && (
          <div className="walk-hint">
            <span className="walk-dot" />
            <span>
              {sakayan.loading
                ? <>{t("Finding the walking route to the nearest")}{' '}<b>{t("sakayan")}</b>…</>
                : sakayan.walkFailed
                  ? <>{t("Couldn’t load walking directions right now. Walk to the violet")}{' '}<b>{t("Sakayan")}</b>{' '}{t("pin on the map.")}{' '}<button className="link-btn small" onClick={sakayan.retry}>{t("Try again")}</button></>
                  : !sakayan.walk
                    ? <>{t("You’re on the jeepney route. Wait here for a jeepney.")}</>
                    : <>{t("Walk")}{' '}<b>~{sakayan.walk.meters < 1000 ? `${Math.round(sakayan.walk.meters / 10) * 10} m` : `${(sakayan.walk.meters / 1000).toFixed(1)} km`}</b> (~{walkMinutes(sakayan.walk.meters)} min) to the nearest <b>{t("sakayan")}</b>.</>}
            </span>
            {sakayan.directions.length > 0 && (
              <span className="walk-sub">
                {t("Jeepneys")}{' '}{sakayan.directions.map((d) => DIRECTIONS[d].label.replace(/^To /, 'to ')).join(' and ')}{' '}{t("pass there.")}
              </span>
            )}
          </div>
        )}
        {msg && (
          <p className={msg.kind === 'ok' ? 'ok' : msg.kind === 'warn' ? 'warn' : 'hint'}>
            {msg.text}{' '}
            {msg.kind === 'signin' && <button className="link-btn small" onClick={() => setPrefs({ guest: false })}>{t("Sign in")}</button>}
          </p>
        )}
        {error && <p className="warn">{t("Couldn’t load jeepneys:")}{' '}{error}</p>}

        {firstRide && (
          <div className={`next-jeep ${next ? '' : 'none'} ${next && next.gap <= 100 ? 'arriving' : ''}`}>
            <Icon name="clock" size={18} />
            {next
              ? <span><b>{next.gap <= 100 ? t("Arriving now") : `Next jeepney in ~${minutes(next.gap)} min`}</b> · {next.plate} · {seatStatus(next).text}</span>
              : <span>{t("No jeepney heading your way right now.")}</span>}
          </div>
        )}

        {option && (
          <section className="journey" aria-label={t("Trip steps")}>
            <Timeline option={option} from={from} to={to} fareType={fareMain} firstWalkState={firstWalkState} onRetryWalk={sakayan?.retry} />
            {trikeTerminal && (
              <p className="trike-hint">
                <Icon name="terminal" size={16} />
                <span>{t("Tricycle terminal")}{' '}{Math.round(trikeTerminal.meters) < 40 ? 'right there' : `${fmtMeters(trikeTerminal.meters)} away`}: <b>{trikeTerminal.name}</b>{communityFare(trikeTerminal.fares) ? ` · ${communityFare(trikeTerminal.fares)}` : ''} <span className="sub">(from commuters)</span></span>
              </p>
            )}
            <button className="link-btn small report-link" onClick={() => navigate('more/report')}>{t("Something wrong with your ride? Report it")}</button>
          </section>
        )}

        {tripTips.length > 0 && (
          <div className="tips-strip">
            <button className="tips-strip-head" onClick={() => setShowTips(!showTips)} aria-expanded={showTips}>
              <Icon name="chat" size={18} />
              <span><b>{tripTips.length === 1 ? t('1 tip from commuters') : t('{n} tips from commuters', { n: tripTips.length })}</b>{' '}{t("for this trip")}</span>
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
                <li><button className="link-btn small" onClick={() => navigate('community')}>{t("See all tips or share one")}</button></li>
              </ul>
            )}
          </div>
        )}

        {!isDemo && (firstRide || !to) && <WaitingCard route={route} user={user} point={waitPoint} directions={waitDirections} />}

        {option && to.kind !== 'saved' && (
          <div className="save-place">
            <span className="label">{t("Save")}{' '}{shortName(to)}{' '}{t("as")}</span>
            <div className="save-place-row">
              {Object.entries(PLACE_KINDS).map(([k, v]) => (
                <button key={k} className="chip small" onClick={() => onSavePlace(k)}><Icon name={v.icon} size={14} /> {k === 'other' ? t("Other…") : v.label}</button>
              ))}
            </div>
          </div>
        )}

        {(firstRide || !to) && (
          <>
            <div className="sheet-section-head">
              <h3>{firstRide ? t("Coming to your sakayan") : t("On the road now")}</h3>
              <label className="switch-label">
                <span>{t("Free seats only")}</span>
                <input type="checkbox" className="switch" checked={onlyWithSeats} onChange={(e) => setOnlyWithSeats(e.target.checked)} />
              </label>
            </div>
            {list.length ? (
              <ul className="jeep-list">
                {list.map((j) => (
                  <JeepRow key={j.id} j={j} onOpen={setOpenJeepId} detail={j.gap != null && inService(j) ? `${j.gap <= 100 ? t("Arriving now") : `~${minutes(j.gap)} min · ${(j.gap / 1000).toFixed(1)} km away`} · ${agoText(j.updatedAt)}` : undefined} />
                ))}
              </ul>
            ) : (
              <p className="hint">{t("No jeepneys are sharing their location right now.")}</p>
            )}
          </>
        )}

        <div className="legend-row">
          {guide && <span><i style={{ background: GUIDE_COLOR }} />{t("Your trip")}</span>}
          {option?.fare.tricycle > 0 && <span><i style={{ background: TRIKE_COLOR }} />{t("Tricycle")}</span>}
          {DIRECTION_KEYS.map((d) => <span key={d}><i style={{ background: DIRECTIONS[d].color }} />{DIRECTIONS[d].label}</span>)}
        </div>
        <p className="fineprint">Tap a jeepney to see its driver. Times, seats and fares are estimates; actual fares can vary. Not affiliated with LTFRB or any LGU.</p>
      </section>

      {openJeepId && (
        <DriverSheet jeepId={openJeepId} jeep={jeepneys.find((j) => j.id === openJeepId) ?? null} onClose={closeJeep} />
      )}

      {sharing && option && (
        <ShareSheet from={from} to={to} option={option} fareType={fareMain} route={route} onClose={() => setSharing(false)} />
      )}

      {chatOpen && showAi && <AssistantSheet chat={chat} onSend={askAI} onShowTrip={showTrip} onClose={closeChat} />}
    </div>
  );
}
