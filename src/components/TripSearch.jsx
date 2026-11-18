// The From / To box on the map. Tapping a line opens a search panel with:
// my location, choose on map, saved places, recent places, jeepney stops,
// and any other place (OpenStreetMap search). Works with informal
// landmarks too: if search can't find it, the rider can pin it on the map.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { matchStops, makeSearcher, serviceBox } from '../lib/places.js';
import { landmarks } from '../lib/landmarkData.js';
import { distanceMeters } from '../lib/geo.js';
import { addRecent, clearRecents, useRecents } from '../lib/recents.js';
import { normalize } from '../lib/assistant/knowledge.js';
import { useDataSaver } from '../lib/prefs.js';
import { haptic } from '../lib/haptics.js';

const FIELD_TEXT = {
  from: { placeholder: 'Where are you?', aria: 'From' },
  to: { placeholder: 'Where to?', aria: 'To' },
};

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

export default function TripSearch({ route, from, to, savedPlaces = [], near, onChoose, onLocate, onPickOnMap, onSwap, onOpenChange }) {
  const [active, setActive] = useState(null); // 'from' | 'to' while searching
  const [query, setQuery] = useState('');
  const [online, setOnline] = useState({ list: [], loading: false, error: null });
  const recents = useRecents();
  const saver = useDataSaver();
  const minChars = saver ? 4 : 3;
  const searcher = useMemo(() => makeSearcher(saver ? 700 : 350, minChars), [saver, minChars]);
  const box = useMemo(() => serviceBox(route), [route]);
  const inputs = { from: useRef(null), to: useRef(null) };
  const panelRef = useRef(null);

  useEffect(() => { onOpenChange?.(!!active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    const q = query.trim();
    if (q.length < minChars) { setOnline({ list: [], loading: false, error: null }); return; }
    setOnline((o) => ({ ...o, loading: true, error: null }));
    searcher(q, { box, near }, (list, error) => setOnline({ list: list ?? [], loading: false, error }));
  }, [query, active]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(field) {
    setActive(field);
    setQuery('');
  }

  function close() {
    setActive(null);
    setQuery('');
    document.activeElement?.blur?.();
  }

  function choose(place) {
    const field = active;
    close();
    if (place.kind !== 'gps') addRecent(place);
    onChoose(field, place);
  }

  const q = normalize(query);
  const stops = matchStops(route, query, q ? 6 : 15);
  const saved = savedPlaces.filter((p) => !q || normalize(`${p.label} ${p.sub}`).includes(q));
  const recent = q ? [] : recents.filter((r) => !saved.some((s) => s.label === r.label));
  // Landmarks along the route: instant, and work offline.
  const nearby = landmarks.match(query, 6);
  // Online results that aren't just a stop or landmark we already list.
  const listed = [...stops, ...nearby];
  const places = online.list.filter((p) => !listed.some((s) => normalize(s.label) === normalize(p.label) && distanceMeters(s.point, p.point) < 150));
  const value = (field, place) => (active === field ? query : place?.label ?? '');

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
                    onChange={(e) => setQuery(e.target.value)}
                    enterKeyHint="search"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const first = saved[0] ?? stops[0] ?? places[0];
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
        <div className="place-panel" ref={panelRef} role="listbox" aria-label={active === 'from' ? 'Choose where you are' : 'Choose where you’re going'}>
          <ul className="place-list">
            {active === 'from' && (
              <Row icon="locate" tone="brand" title="Use my location" sub="GPS" onPick={() => { close(); onLocate(); }} />
            )}
            <Row icon="target" tone="brand" title="Choose on the map" sub="For landmarks, corners and places without an address" onPick={() => { const f = active; close(); onPickOnMap(f); }} />
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
                {recent.map((p, i) => <Row key={`${p.label}${i}`} icon="history" title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
              </ul>
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

          {nearby.length > 0 && (
            <>
              <div className="place-head">Landmarks along the route</div>
              <ul className="place-list">
                {nearby.map((p) => <Row key={p.id} icon={p.icon} tone={`lm lm-${p.cat}`} title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
              </ul>
            </>
          )}

          {query.trim().length >= minChars && (
            <>
              <div className="place-head">Places {online.loading && <span className="spinner" aria-label="Searching" />}</div>
              {places.length > 0 ? (
                <ul className="place-list">
                  {places.map((p) => <Row key={p.id || p.label} icon="pin" title={p.label} sub={p.sub} onPick={() => choose(p)} />)}
                </ul>
              ) : !online.loading && (
                <p className="place-empty">
                  {online.error ? 'Couldn’t search right now (check your internet). ' : `No places found for “${query.trim()}”. `}
                  <button type="button" className="link-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => { const f = active; close(); onPickOnMap(f); }}>Pin it on the map</button>
                </p>
              )}
            </>
          )}
          {query.trim().length > 0 && query.trim().length < minChars && <p className="place-empty">Type a few more letters to search all places.</p>}
          <p className="place-fine">Place search © OpenStreetMap contributors (Photon).</p>
        </div>
      )}
    </div>
  );
}
