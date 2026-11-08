import { useState } from 'react';
import { PageHeader, Segmented, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { computeFare, peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs } from '../lib/prefs.js';

export default function RoutesScreen({ route, jeepneys, sub, openOnMap }) {
  const [query, setQuery] = useState('');
  if (sub === 'detail') return <RouteDetail route={route} jeepneys={jeepneys} openOnMap={openOnMap} />;

  const q = query.trim().toLowerCase();
  const out = route.legs.to_santa_cruz;
  const full = computeFare(out.length);
  const active = jeepneys.length;
  const withSeats = jeepneys.filter((j) => seatStatus(j).level !== 'full').length;
  const routeMatches = !q || `${route.name} ${out.via}`.toLowerCase().includes(q);
  const stops = route.stops.filter((s) => !q || s.name.toLowerCase().includes(q));

  return (
    <div className="page">
      <PageHeader
        title="Routes"
        right={<span className={`live-pill ${active ? 'on' : ''}`}><i />{active} live</span>}
      />
      <div className="page-body">
        <label className="search-box">
          <Icon name="search" size={20} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search routes or stops, e.g. DLTB" />
          {query && <button className="icon-btn small" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={16} /></button>}
        </label>

        {routeMatches && (
          <>
            <div className="section-label"><span>Jeepney routes</span><span>1 route</span></div>
            <button className="route-card" onClick={() => navigate('routes/detail')}>
              <div className="route-card-head">
                <span className="tile"><Icon name="bus" size={20} /></span>
                <span className="route-card-name">
                  <b>{route.name}</b>
                  <span className="sub">Both directions · {(out.length / 1000).toFixed(1)} km</span>
                </span>
                <Icon name="chevron" size={18} className="menu-chevron" />
              </div>
              <div className="route-card-stats">
                <span><small>Full trip</small><b>{peso(full.regular)}</b></span>
                <span><small>On the road</small><b className={active ? 'live-text' : ''}>{active}</b></span>
                <span><small>With seats</small><b>{withSeats}</b></span>
              </div>
            </button>
          </>
        )}

        {stops.length > 0 && (
          <>
            <div className="section-label"><span>Stops</span><span>{stops.length}</span></div>
            <div className="menu-card">
              {stops.map((s) => (
                <button key={s.id} className="menu-row" onClick={() => openOnMap({ direction: s.id === 'magdalena-plaza' ? 'to_santa_cruz' : 'to_magdalena', dropoffStopId: s.id, pickupStopId: null, toOnly: true })}>
                  <span className="menu-icon"><Icon name={s.icon} size={20} /></span>
                  <span className="menu-text">
                    <span className="menu-title">{s.name}</span>
                    <span className="menu-sub">Plan a trip here</span>
                  </span>
                  <Icon name="chevron" size={18} className="menu-chevron" />
                </button>
              ))}
            </div>
          </>
        )}

        {!routeMatches && stops.length === 0 && <p className="hint center">Nothing matches “{query}”.</p>}
      </div>
    </div>
  );
}

function RouteDetail({ route, jeepneys, openOnMap }) {
  const prefs = usePrefs();
  const [direction, setDirection] = useState('to_santa_cruz');
  const leg = route.legs[direction];
  const first = leg.stops[0];
  const onLeg = jeepneys.filter((j) => j.direction === direction);

  return (
    <div className="page">
      <PageHeader title={route.name} back="routes" />
      <div className="page-body">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={DIRECTION_KEYS.map((d) => [d, DIRECTIONS[d].label, DIRECTIONS[d].className])}
        />

        <div className="card">
          <div className="detail-stats">
            <span><small>Distance</small><b>{(leg.length / 1000).toFixed(1)} km</b></span>
            <span><small>Full fare</small><b>{peso(computeFare(leg.length)[prefs.fareType])}</b></span>
            <span><small>On this side</small><b>{onLeg.length}</b></span>
          </div>
          <div>
            <div className="label">Via</div>
            <p className="body-text">{leg.via}</p>
          </div>
          <button className="btn primary wide" onClick={() => openOnMap({ direction })}>
            View on map
          </button>
        </div>

        <div className="section-label"><span>Stops & fares from {first.short ?? first.name}</span></div>
        <ol className="timeline card">
          {leg.stops.map((s, i) => {
            const f = i === 0 ? null : computeFare(s.along - first.along);
            return (
              <li key={s.id} className={DIRECTIONS[direction].className}>
                <span className="timeline-dot" />
                <div className="timeline-body">
                  <b>{s.name}</b>
                  <span className="sub">{i === 0 ? 'Start' : `${((s.along - first.along) / 1000).toFixed(1)} km · ${peso(f[prefs.fareType])}`}</span>
                </div>
                {i < leg.stops.length - 1 && (
                  <button className="btn small" onClick={() => openOnMap({ direction, pickupStopId: s.id })}>Ride from here</button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
