// A small map for Community posts: pin one spot (a terminal) or draw a
// route by tapping along the road, or record it with GPS while riding.
// The jeepney route is drawn too, so people can see where they are.
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Icon from './Icon.jsx';
import { MAP_STYLE, COMMUNITY_COLOR } from './MapView.jsx';
import { DIRECTIONS } from '../lib/directions.js';
import { distanceMeters } from '../lib/geo.js';
import { gpsErrorText } from '../lib/gps.js';
import { t } from '../lib/i18n.js';

const MAX_POINTS = 400;
const RECORD_EVERY_M = 15; // GPS: keep a point every 15 m

const EMPTY = { type: 'FeatureCollection', features: [] };
function drawing(mode, value) {
  if (!value) return EMPTY;
  if (mode === 'point') return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: value } }] };
  return {
    type: 'FeatureCollection',
    features: [
      ...(value.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: value } }] : []),
      ...value.map((c, i) => ({ type: 'Feature', properties: { end: i === 0 || i === value.length - 1 ? 1 : 0 }, geometry: { type: 'Point', coordinates: c } })),
    ],
  };
}

// mode: 'point' | 'path'. value: [lng, lat] or [[lng, lat], ...].
export default function PickMap({ route, mode, value, onChange, center }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [recording, setRecording] = useState(false);
  const [gpsMsg, setGpsMsg] = useState('');
  const watch = useRef(null);

  useEffect(() => {
    const start = center ?? (mode === 'point' ? value : value?.[0]);
    const map = new maplibregl.Map({
      container: box.current,
      style: MAP_STYLE,
      ...(start ? { center: start, zoom: 16 } : { bounds: route.bounds, fitBoundsOptions: { padding: 20 } }),
      attributionControl: { compact: true },
      renderWorldCopies: false,
    });
    map.on('load', () => {
      for (const [direction, leg] of Object.entries(route.legs)) {
        map.addSource(`leg-${direction}`, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.coordinates } } });
        map.addLayer({ id: `leg-${direction}`, type: 'line', source: `leg-${direction}`, paint: { 'line-color': DIRECTIONS[direction].color, 'line-width': 3, 'line-opacity': 0.55, 'line-offset': 2 } });
      }
      map.addSource('draw', { type: 'geojson', data: drawing(mode, valueRef.current) });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COMMUNITY_COLOR, 'line-width': 5 } });
      map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': mode === 'point' ? 9 : ['case', ['==', ['get', 'end'], 1], 6, 3.5], 'circle-color': mode === 'point' ? '#c84b0c' : COMMUNITY_COLOR, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    });
    map.on('click', (e) => {
      const pt = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)];
      if (mode === 'point') onChangeRef.current(pt);
      else if ((valueRef.current?.length ?? 0) < MAX_POINTS) onChangeRef.current([...(valueRef.current ?? []), pt]);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [route, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const src = mapRef.current?.getSource('draw');
    if (src) src.setData(drawing(mode, value));
  }, [value, mode]);

  useEffect(() => () => { if (watch.current != null) navigator.geolocation?.clearWatch(watch.current); }, []);

  function useGps() {
    if (!navigator.geolocation) return setGpsMsg('GPS is not available on this phone.');
    setGpsMsg('Finding you…');
    navigator.geolocation.getCurrentPosition((p) => {
      const pt = [+p.coords.longitude.toFixed(6), +p.coords.latitude.toFixed(6)];
      setGpsMsg('');
      onChange(pt);
      mapRef.current?.flyTo({ center: pt, zoom: 17 });
    }, (e) => setGpsMsg(gpsErrorText(e)), { enableHighAccuracy: true, timeout: 15000 });
  }

  function toggleRecord() {
    if (recording) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      setRecording(false);
      setGpsMsg(value?.length > 1 ? t("Recording stopped. Check the line, then save.") : t("No route recorded yet."));
      return;
    }
    if (!navigator.geolocation) return setGpsMsg('GPS is not available on this phone.');
    setRecording(true);
    setGpsMsg('Recording… keep this screen open while you ride.');
    watch.current = navigator.geolocation.watchPosition((p) => {
      if (p.coords.accuracy > 40) return; // too rough
      const pt = [+p.coords.longitude.toFixed(6), +p.coords.latitude.toFixed(6)];
      const cur = valueRef.current ?? [];
      if (cur.length && distanceMeters(cur.at(-1), pt) < RECORD_EVERY_M) return;
      if (cur.length >= MAX_POINTS) return;
      onChangeRef.current([...cur, pt]);
      mapRef.current?.easeTo({ center: pt });
    }, (e) => { setGpsMsg(gpsErrorText(e)); setRecording(false); }, { enableHighAccuracy: true, maximumAge: 2000 });
  }

  const length = mode === 'path' && value?.length > 1 ? value.slice(1).reduce((m, p, i) => m + distanceMeters(value[i], p), 0) : 0;

  return (
    <div className="pick-map">
      <div ref={box} className="pick-map-canvas" />
      <div className="pick-map-bar">
        {mode === 'point' ? (
          <>
            <span className="sub">{value ? t("Pinned. Tap the map to move it.") : t("Tap the map where it is.")}</span>
            <button type="button" className="btn small" onClick={useGps}><Icon name="locate" size={15} />{' '}{t("I’m here")}</button>
          </>
        ) : (
          <>
            <span className="sub">
              {value?.length ? `${value.length === 1 ? t('1 point') : t('{n} points', { n: value.length })} · ${length < 1000 ? `${Math.round(length)} m` : `${(length / 1000).toFixed(1)} km`}` : t('Tap along the road, start to end.')}
            </span>
            <button type="button" className="icon-btn small" onClick={() => onChange((value ?? []).slice(0, -1))} disabled={!value?.length || recording} aria-label={t("Undo last point")}><Icon name="undo" size={16} /></button>
            <button type="button" className="icon-btn small" onClick={() => onChange([])} disabled={!value?.length || recording} aria-label={t("Clear the line")}><Icon name="trash" size={16} /></button>
            <button type="button" className={`btn small ${recording ? 'danger' : ''}`} onClick={toggleRecord}>
              <Icon name={recording ? 'stop' : 'record'} size={15} /> {recording ? t("Stop recording") : t("Record")}
            </button>
          </>
        )}
      </div>
      {gpsMsg && <p className="hint small">{gpsMsg}</p>}
    </div>
  );
}
