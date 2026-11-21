// The From / To box on the map. Tapping a line opens a search panel with:
// my location, choose on map, saved places, recent places, browse by kind
// (schools, markets...), jeepney stops, and EVERY street, barangay, sitio
// and named place around the route. That list is on the phone, so search
// is instant, works offline and uses no load; only when it finds little do
// we also ask the online OpenStreetMap search. Places that aren't on any
// map can still be pinned on the map.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { matchStops, makeSearcher, serviceBox } from '../lib/places.js';
import { BROWSE } from '../lib/placeIndex.js';
import { usePlaces } from '../lib/placeData.js';
import { distanceMeters } from '../lib/geo.js';
import { addRecent, clearRecents, useRecents } from '../lib/recents.js';
import { normalize } from '../lib/assistant/knowledge.js';
import { useDataSaver } from '../lib/prefs.js';
import { useOnline } from '../lib/useOnline.js';

const FIELD_TEXT = {
  from: { placeholder: 'Where are you?', aria: 'From' },
  to: { placeholder: 'Search places, streets, barangays', aria: 'To' },
};
const ONLINE_WHEN_FEWER = 3; // ask online only when the phone's list finds less than this

function Row({ icon, title, sub, onPick, tone }) {
  return (
    <li>
      <button type="button" className="place-row" onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
        <span className={`place-icon ${tone ?? ''}`}><Icon name={icon} size={18} /></span>
        <span className="place-text">
          <span className="place-title">{title}</span>
          {sub && <span className="place-sub">{sub}</span>}
        </span>
      </button>
    </li>
  );
}

const toneOf = (p) => (p.cat ? `lm lm-${p.cat}` : p.placeType === 'street' ? 'street' : p.placeType === 'barangay' || p.placeType === 'town' ? 'area' : '');

export default function TripSearch({ route, from, to, savedPlaces = [], near, onChoose, onLocate, onPickOnMap, onSwap, onOpenChange, openRequest }) {
  const [active, setActive] = useState(null); // 'from' | 'to' while searching
  const [query, setQuery] = useState('');
  const [browse, setBrowse] = useState(null); // a BROWSE key while browsing one kind
  const [online, setOnline] = useState({ list: [], loading: false, error: null, q: '' });
  const recents = useRecents();
  const saver = useDataSaver();
  const isOnline = useOnline();
  const places = usePlaces(!!active || !saver);
  const minChars = saver ? 4 : 3;
  const searcher = useMemo(() => makeSearcher(saver ? 700 : 400, minChars), [saver, minChars]);
  const box = useMemo(() => serviceBox(route), [route]);
  const inputs = { from: useRef(null), to: useRef(null) };

  useEffect(() => { onOpenChange?.(!!active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from outside (a "Schools" shortcut on the map).
  useEffect(() => {
    if (!openRequest) return;
    setActive(openRequest.field ?? 'to');
    setQuery('');
    setBrowse(openRequest.browse ?? null);
  }, [openRequest]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = normalize(query);
  const local = useMemo(() => (places && q ? places.search(query, { near, limit: 12 }) : []), [places, query, near]); // eslint-disable-line react-hooks/exhaustive-deps
  const needOnline = isOnline && !!places && query.trim().length >= minChars && local.length < ONLINE_WHEN_FEWER;

  useEffect(() => {
    if (!active) return;
    if (!needOnline) { setOnline({ list: [], loading: false, error: null, q: '' }); return; }
    const text = query.trim();
    setOnline((o) => ({ ...o, loading: true, error: null }));
    searcher(text, { box, near }, (list, error) => setOnline({ list: list ?? [], loading: false, error, q: text }));
  }, [query, active, needOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(field) {
    setActive(field);
    setQuery('');
    setBrowse(null);
  }

  function close() {
    setActive(null);
    setQuery('');
    setBrowse(null);
    document.activeElement?.blur?.();
  }

  function choose(place) {
    const field = active;
    close();
    if (place.kind !== 'gps') addRecent(place);
    onChoose(field, place);
  }

  const stops = matchStops(route, query, q ? 6 : 15);
  const saved = savedPlaces.filter((p) => !q || normalize(`${p.label} ${p.sub}`).includes(q));
  const recent = q ? [] : recents.filter((r) => !saved.some((s) => s.label === r.label));
  // Online results that aren't already in the phone's list.
  const listed = [...stops, ...local];
  const extra = online.list.filter((p) => !listed.some((s) => normalize(s.label) === normalize(p.label) && distanceMeters(s.point, p.point) < 150));
  const browsing = browse && !q && places ? places.browse(browse, { near, limit: 40 }) : null;
  const value = (field, place) => (active === field ? query : place?.label ?? '');
  const pinIt = () => { const f = active; close(); onPickOnMap(f); };

  return (
    <div className={`trip-search ${active ? 'open' : ''}`}>
      <div className="trip-card">
        <div className="trip-lines">
          {['from', 'to'].map((field, i) => {
            const place = field === 'from' ? from : to;
            return (
              <div key={field}>
                {i === 1 && <div className="trip-divider" />}
                <label className="trip-row">
                  {field === 'from' ? <span className="trip-dot from" /> : <span className="trip-dot to"><Icon name="pin" size={14} /></span>}
                  <input
                    ref={inputs[field]}
                    className="trip-input"
                    value={value(field, place)}
                    placeholder={FIELD_TEXT[field].placeholder}
                    aria-label={FIELD_TEXT[field].aria}
                    onFocus={() => active !== field && open(field)}
                    onChange={(e) => { setQuery(e.target.value); if (e.target.value) setBrowse(null); }}
                    enterKeyHint="search"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const first = saved[0] ?? stops[0] ?? local[0] ?? extra[0];
                        if (query.trim() && first) choose(first);
                      }
                    }}
                  />
                  {active === field && query && (
                    <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(''); inputs[field].current?.focus(); }} aria-label="Clear">
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </label>
              </div>
            );
          })}
        </div>
        {active ? (
          <button type="button" className="link-btn small search-cancel" onMouseDown={(e) => e.preventDefault()} onClick={close}>Cancel</button>
        ) : (
          <button type="button" className="swap-btn" onClick={onSwap} disabled={!from || !to} aria-label="Swap from and to">
            <Icon name="swap" size={20} />
          </button>
        )}
      </div>

      {active && (
        <div className="place-panel" role="listbox" aria-label={active === 'from' ? 'Choose where you are' : 'Choose where you’re going'}>
          {!isOnline && (
            <p className="place-offline"><Icon name="offline" size={15} /> Offline · Streets, barangays and places on your phone still work</p>
          )}

          {browsing ? (
            <>
              <div className="place-head">
                <button type="button" className="link-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => setBrowse(null)}>
                  <Icon name="back" size={14} /> All kinds
                </button>
                <span>{BROWSE[browse].label}</span>
              </div>
              {browsing.length ? (
                <ul className="place-list">
                  {browsing.map((p) => <Row key={p.id} icon={p.icon} tone={toneOf(p)} title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                </ul>
              ) : <p className="place-empty">None on the map yet. <button type="button" className="link-btn small" onMouseDown={(e) => e.preventDefault()} onClick={pinIt}>Pin a place on the map</button></p>}
            </>
          ) : (
            <>
              <ul className="place-list">
                {active === 'from' && (
                  <Row icon="locate" tone="brand" title="Use my location" sub="GPS" onPick={() => { close(); onLocate(); }} />
                )}
                <Row icon="target" tone="brand" title="Choose on the map" sub="For corners, houses and places without a name" onPick={pinIt} />
              </ul>

              {saved.length > 0 && (
                <>
                  <div className="place-head">Saved places</div>
                  <ul className="place-list">
                    {saved.map((p) => <Row key={p.id} icon={p.icon} tone="saved" title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                  </ul>
                </>
              )}

              {recent.length > 0 && (
                <>
                  <div className="place-head">
                    <span>Recent</span>
                    <button type="button" className="link-btn small" onMouseDown={(e) => e.preventDefault()} onClick={clearRecents}>Clear</button>
                  </div>
                  <ul className="place-list">
                    {recent.map((p, i) => <Row key={`${p.label}${i}`} icon={p.icon ?? 'history'} title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                  </ul>
                </>
              )}

              {!q && (
                <>
                  <div className="place-head">Browse by kind</div>
                  <div className="browse-grid">
                    {Object.entries(BROWSE).map(([k, b]) => (
                      <button type="button" key={k} className="browse-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setBrowse(k)}>
                        <Icon name={b.icon} size={18} /><span>{b.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {stops.length > 0 && (
                <>
                  <div className="place-head">Jeepney stops</div>
                  <ul className="place-list">
                    {stops.map((p) => <Row key={p.stopId} icon={p.icon} tone="stop" title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                  </ul>
                </>
              )}

              {q && (
                <>
                  <div className="place-head">Places, streets & barangays {!places && <span className="spinner" aria-label="Loading places" />}</div>
                  {local.length > 0 && (
                    <ul className="place-list">
                      {local.map((p) => <Row key={p.id} icon={p.icon} tone={toneOf(p)} title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                    </ul>
                  )}
                  {needOnline && (online.loading || extra.length > 0) && (
                    <>
                      <div className="place-head">More places (online) {online.loading && <span className="spinner" aria-label="Searching" />}</div>
                      <ul className="place-list">
                        {extra.map((p) => <Row key={p.id || p.label} icon="pin" title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                      </ul>
                    </>
                  )}
                  {places && !local.length && !extra.length && !online.loading && (
                    <p className="place-empty">
                      {needOnline && online.error ? 'Couldn’t search online right now. ' : `No place called “${query.trim()}” on the map yet. `}
                      <button type="button" className="link-btn small" onMouseDown={(e) => e.preventDefault()} onClick={pinIt}>Pin it on the map</button>
                    </p>
                  )}
                </>
              )}
            </>
          )}
          <p className="place-fine">Streets & places © OpenStreetMap contributors.</p>
        </div>
      )}
    </div>
  );
}
