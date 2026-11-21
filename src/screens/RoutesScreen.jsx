import { useEffect, useState } from 'react';
import { PageHeader, Segmented, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { computeFare, peso } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS, seatStatus } from '../lib/directions.js';
import { usePrefs } from '../lib/prefs.js';
import { useAuth } from '../lib/auth.jsx';
import { useTips, TIP_CATEGORIES, tipAge } from '../lib/community.js';
import { stopPlace } from '../lib/places.js';
import { useCommunityPlaces, VEHICLES, fareText } from '../lib/communityPosts.js';
import { useAppSettings, serviceStatus } from '../lib/settings.js';
import { t } from '../lib/i18n.js';

export default function RoutesScreen({ route, jeepneys, sub, openOnMap }) {
  const [query, setQuery] = useState('');
  const { user } = useAuth();
  const { tips } = useTips(route.id, user?.id ?? null);
  const community = useCommunityPlaces(route.id);
  // Old links to the tips page now open the Community tab.
  useEffect(() => { if (sub === 'community') navigate('community'); }, [sub]);
  if (sub === 'detail') return <RouteDetail route={route} jeepneys={jeepneys} openOnMap={openOnMap} />;

  const q = query.trim().toLowerCase();
  const out = route.legs.to_santa_cruz;
  const full = computeFare(out.length);
  const active = jeepneys.length;
  const withSeats = jeepneys.filter((j) => seatStatus(j).level !== 'full').length;
  const routeMatches = !q || `${route.name} ${out.via}`.toLowerCase().includes(q);
  const stops = route.stops.filter((s) => !q || s.name.toLowerCase().includes(q));
  const local = community.filter((p) => !q || p.name.toLowerCase().includes(q));

  return (
    <div className="page">
      <PageHeader
        title={t("Routes")}
        right={<span className={`live-pill ${active ? 'on' : ''}`}><i />{active}{' '}{t("live")}</span>}
      />
      <div className="page-body">
        <label className="search-box">
          <Icon name="search" size={20} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search routes or stops, e.g. DLTB")} />
          {query && <button className="icon-btn small" onClick={() => setQuery('')} aria-label={t("Clear search")}><Icon name="close" size={16} /></button>}
        </label>

        {routeMatches && (
          <>
            <div className="section-label"><span>{t("Jeepney routes")}</span><span>{t("1 route")}</span></div>
            <button className="route-card" onClick={() => navigate('routes/detail')}>
              <div className="route-card-head">
                <span className="tile"><Icon name="bus" size={20} /></span>
                <span className="route-card-name">
                  <b>{route.name}</b>
                  <span className="sub">{t("Both directions ·")}{' '}{(out.length / 1000).toFixed(1)}{' '}{t("km")}</span>
                </span>
                <Icon name="chevron" size={18} className="menu-chevron" />
              </div>
              <div className="route-card-stats">
                <span><small>{t("Full trip")}</small><b>{peso(full.regular)}</b></span>
                <span><small>{t("On the road")}</small><b className={active ? 'live-text' : ''}>{active}</b></span>
                <span><small>{t("With seats")}</small><b>{withSeats}</b></span>
              </div>
            </button>
          </>
        )}

        {local.length > 0 && (
          <>
            <div className="section-label"><span>{t("Tricycle routes & terminals")}</span><span>{local.length}{' '}{t("from commuters")}</span></div>
            <div className="menu-card">
              {local.map((p) => (
                <button key={p.id} className="menu-row" onClick={() => openOnMap({ focus: { id: p.id, kind: p.kind, name: p.name, point: p.point, path: p.path } })}>
                  <span className="menu-icon community"><Icon name={p.kind === 'terminal' ? 'terminal' : 'routes'} size={20} /></span>
                  <span className="menu-text">
                    <span className="menu-title">{p.name} <span className="pill community-pill">{t("Community")}</span></span>
                    <span className="menu-sub">{[p.vehicles.map((v) => VEHICLES[v]?.label ?? v).join(', '), fareText(p.fares)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Icon name="chevron" size={18} className="menu-chevron" />
                </button>
              ))}
            </div>
          </>
        )}

        {!q && (
          <>
            <div className="section-label"><span>{t("From commuters")}</span><span>{tips.length ? (tips.length === 1 ? t('1 tip') : t('{n} tips', { n: tips.length })) : ''}</span></div>
            <button className="route-card" onClick={() => navigate('community')}>
              <div className="route-card-head">
                <span className="tile"><Icon name="chat" size={20} /></span>
                <span className="route-card-name">
                  <b>{t("Community")}</b>
                  <span className="sub">
                    {tips[0]
                      ? `${TIP_CATEGORIES[tips[0].category].label}: “${tips[0].body.length > 70 ? `${tips[0].body.slice(0, 70)}…` : tips[0].body}” · ${tipAge(tips[0].createdAt)}`
                      : 'Tricycle routes, terminals, tips and chat from commuters. Share what you know.'}
                  </span>
                </span>
                <Icon name="chevron" size={18} className="menu-chevron" />
              </div>
            </button>
          </>
        )}

        {stops.length > 0 && (
          <>
            <div className="section-label"><span>{t("Stops")}</span><span>{stops.length}</span></div>
            <div className="menu-card">
              {stops.map((s) => (
                <button key={s.id} className="menu-row" onClick={() => openOnMap({ to: stopPlace(s) })}>
                  <span className="menu-icon"><Icon name={s.icon} size={20} /></span>
                  <span className="menu-text">
                    <span className="menu-title">{s.name}</span>
                    <span className="menu-sub">{t("Plan a trip here")}</span>
                  </span>
                  <Icon name="chevron" size={18} className="menu-chevron" />
                </button>
              ))}
            </div>
          </>
        )}

        {!routeMatches && stops.length === 0 && local.length === 0 && <p className="hint center">{t("Nothing matches “")}{query}”.</p>}
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
  const settings = useAppSettings();
  const service = serviceStatus(settings.service_hours, direction);

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
            <span><small>{t("Distance")}</small><b>{(leg.length / 1000).toFixed(1)}{' '}{t("km")}</b></span>
            <span><small>{t("Full fare")}</small><b>{peso(computeFare(leg.length)[prefs.fareType])}</b></span>
            <span><small>{t("On this side")}</small><b>{onLeg.length}</b></span>
          </div>
          {service.state !== 'unknown' && (
            <div className="detail-stats">
              <span><small>{t("First trip")}</small><b>~{service.first}</b></span>
              <span><small>{t("Last trip")}</small><b>~{service.last}</b></span>
              <span><small>{t("Now")}</small><b className={service.state === 'running' ? 'live-text' : ''}>{{ running: 'Running', last_soon: `Last trip soon`, before_first: 'Not yet', after_last: 'Done for today' }[service.state]}</b></span>
            </div>
          )}
          {settings.service_hours?.note && <p className="hint">{settings.service_hours.note}</p>}
          <div>
            <div className="label">{t("Via")}</div>
            <p className="body-text">{leg.via}</p>
          </div>
          <button className="btn primary wide" onClick={() => openOnMap({ direction })}>
            {t("View on map")}
          </button>
        </div>

        <div className="section-label"><span>{t("Stops & fares from")}{' '}{first.short ?? first.name}</span></div>
        <ol className="timeline card">
          {leg.stops.map((s, i) => {
            const f = i === 0 ? null : computeFare(s.along - first.along);
            return (
              <li key={s.id} className={DIRECTIONS[direction].className}>
                <span className="timeline-dot" />
                <div className="timeline-body">
                  <b>{s.name}</b>
                  <span className="sub">{i === 0 ? t("Start") : `${((s.along - first.along) / 1000).toFixed(1)} km · ${peso(f[prefs.fareType])}`}</span>
                </div>
                {i < leg.stops.length - 1 && (
                  <button className="btn small" onClick={() => openOnMap({ direction, pickupStopId: s.id })}>{t("Ride from here")}</button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
