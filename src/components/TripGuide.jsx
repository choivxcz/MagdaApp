// Trip mode for riders: after "Start", the app follows the rider's GPS,
// shows what to do now, says it out loud, vibrates before the babaan, and
// plans again when they go another way. GPS itself uses no load.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { followTrip } from '../lib/tripGuide.js';
import { say, useWakeLock } from '../lib/driverTools.js';
import { gpsErrorText } from '../lib/gps.js';
import { fmtMeters, fmtMinutes } from '../lib/planner.js';
import { DIRECTIONS } from '../lib/directions.js';
import { t } from '../lib/i18n.js';

const REROUTE_AFTER = 3; // fixes in a row off the path
const REROUTE_GAP_MS = 45000;

const vibrate = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not supported */ } };

// What to say for each alert, in the rider's language.
const SPOKEN = {
  start: { tl: 'Simula na ang biyahe. Sasabihan kita kapag malapit na ang babaan mo.', en: 'Trip started. I’ll tell you when your stop is near.' },
  prepare: { tl: 'Malapit na ang babaan mo. Maghanda nang bumaba.', en: 'Your stop is coming up. Get ready to get off.' },
  getoff: { tl: 'Bumaba na po dito. Sabihin: para po!', en: 'Get off here. Say: para po!' },
  missed: { tl: 'Lumampas ka na sa babaan. Bumaba na, hahanapan kita ng bagong daan.', en: 'You passed your stop. Get off; I’ll find a new way.' },
  arrived: { tl: 'Nandito ka na. Ingat!', en: 'You’ve arrived. Take care!' },
  reroute: { tl: 'Iba ang dinaanan mo. Bagong daan mula sa kinaroroonan mo.', en: 'You went another way. Here’s a new way from where you are.' },
};
export const speak = (key, lang) => say(SPOKEN[key]?.[lang === 'en' ? 'en' : 'tl'], lang === 'off' ? 'off' : lang === 'en' ? 'en' : 'tl');

// Follows the GPS while active. Returns the guide state and the last GPS error.
export function useTripGuide({ active, option, lines, dest, onPosition, onReroute, voice }) {
  const [state, setState] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const prev = useRef(null);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const latest = useRef({});
  latest.current = { option, lines, dest, onPosition, onReroute, voice };
  useWakeLock(active);

  // A new plan (after re-planning, or another option) starts fresh.
  useEffect(() => { prev.current = null; offCount.current = 0; setState(null); }, [option?.id, active]);

  useEffect(() => {
    if (!active || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition((pos) => {
      const L = latest.current;
      const point = [pos.coords.longitude, pos.coords.latitude];
      setGpsError('');
      L.onPosition?.(point);
      if (!L.option || !L.lines || pos.coords.accuracy > 80) return; // too rough to guide with
      const r = followTrip(L.option, L.lines, point, prev.current, L.dest);
      prev.current = r;
      setState(r);
      if (r.alert === 'prepare') { vibrate([200, 100, 200]); speak('prepare', L.voice); }
      if (r.alert === 'getoff') { vibrate([500, 150, 500, 150, 500]); speak('getoff', L.voice); }
      if (r.alert === 'missed') { vibrate([300, 100, 300]); speak('missed', L.voice); }
      if (r.alert === 'arrived') { vibrate([100, 60, 100]); speak('arrived', L.voice); }
      offCount.current = r.offPath ? offCount.current + 1 : 0;
      if (offCount.current >= REROUTE_AFTER && Date.now() - lastReroute.current > REROUTE_GAP_MS && !r.done) {
        lastReroute.current = Date.now();
        offCount.current = 0;
        speak('reroute', L.voice);
        L.onReroute?.(point);
      }
    }, (e) => setGpsError(gpsErrorText(e)), { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { state, gpsError };
}

const dirText = (d) => DIRECTIONS[d]?.label ?? '';

// The banner at the top of the map during a trip.
export function GuideBanner({ option, state, to, next, gpsError, voice, onVoice, onEnd, onReport }) {
  const step = state && state.index < option.steps.length ? option.steps[state.index] : null;
  const phase = state?.phase ?? (option.steps[0]?.type === 'ride' ? 'wait' : option.steps[0]?.type ?? 'walk');
  const shown = step ?? option.steps[0];
  let icon = 'walk';
  let title = '';
  let sub = '';
  let tone = '';
  const dist = state ? fmtMeters(state.remainingM) : '';

  if (phase === 'arrived' && state?.done) {
    icon = 'check'; tone = 'done';
    title = t('You’ve arrived');
    sub = to?.label ?? '';
  } else if (phase === 'arrived') {
    icon = 'walk';
    title = t('Walk to {place}', { place: to?.label ?? t('your destination') });
    sub = dist;
  } else if (phase === 'walk' || phase === 'transfer') {
    const toRoute = shown?.role === 'first' || phase === 'transfer';
    icon = 'walk';
    title = toRoute ? t('Walk to the sakayan') : t('Walk to {place}', { place: to?.label ?? t('your destination') });
    sub = state ? t('{d} left', { d: dist }) : t('{d} · about {min}', { d: fmtMeters(shown.meters), min: fmtMinutes(shown.minutes) });
  } else if (phase === 'tricycle') {
    icon = 'tricycle';
    title = shown?.role === 'first' ? t('Take a tricycle to the jeepney route') : t('Take a tricycle to {place}', { place: to?.label ?? '' });
    sub = state ? t('{d} left', { d: dist }) : fmtMeters(shown.meters);
  } else if (phase === 'wait') {
    icon = 'clock';
    title = t('Wait here for a jeepney {dir}', { dir: dirText(shown.direction) });
    sub = next ? (next.gap <= 100 ? t('A jeepney is arriving now') : t('Next jeepney in about {min} min', { min: Math.max(1, Math.round(next.gap / (20 / 3.6) / 60)) })) : t('No jeepney sharing its location yet. Keep watching the road.');
  } else if (phase === 'ride') {
    icon = 'bus';
    const remaining = state?.remainingM ?? shown.meters;
    if (remaining <= 150) { tone = 'getoff'; title = t('Get off here!'); sub = t('Say “Para po!”'); } else if (remaining <= 500) {
      tone = 'prepare'; title = t('Get ready to get off'); sub = t('{d} to your babaan', { d: fmtMeters(remaining) });
    } else {
      title = t('On the jeepney {dir}', { dir: dirText(shown.direction) });
      sub = t('{d} to your babaan. We’ll tell you when to get off.', { d: fmtMeters(remaining) });
    }
  }

  const stepNo = Math.min((state?.index ?? 0) + 1, option.steps.length);
  return (
    <div className={`guide-banner ${tone}`} role="status" aria-live="assertive">
      <span className="guide-icon"><Icon name={icon} size={26} /></span>
      <div className="guide-text">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
        {gpsError
          ? <span className="guide-warn">{gpsError}</span>
          : !state && <span className="guide-warn">{t('Waiting for GPS… keep the app open.')}</span>}
        {!state?.done && <span className="guide-step">{t('Step {n} of {total}', { n: stepNo, total: option.steps.length })}</span>}
      </div>
      <div className="guide-actions">
        <button className="icon-btn small" onClick={onVoice} aria-label={voice === 'off' ? t('Turn voice on') : t('Turn voice off')} aria-pressed={voice !== 'off'}>
          <Icon name={voice === 'off' ? 'mute' : 'volume'} size={18} />
        </button>
        {state?.done
          ? <button className="btn small primary" onClick={onEnd}>{t('Done')}</button>
          : <button className="btn small" onClick={onEnd}>{t('End')}</button>}
      </div>
      {state?.done && <button className="link-btn small guide-report" onClick={onReport}>{t('Something wrong with your ride? Report it')}</button>}
    </div>
  );
}
