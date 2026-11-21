// Shown while the jeepney moves: large, glanceable info and no buttons to
// fiddle with (Anti-Distracted Driving Act, RA 10913). Only SOS, and an
// unlock for the konduktor, stay available.
import Icon from './Icon.jsx';
import { TRIP_STATUS } from '../lib/tripStatus.js';
import { DIRECTIONS } from '../lib/directions.js';
import { t } from '../lib/i18n.js';

const dist = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);
const mins = (m) => Math.max(1, Math.round(m / (20 / 3.6) / 60));

export default function DriveLock({ direction, tripStatus, lastTrip, free, capacity, nextWaiting, totalWaiting, gaps, lang, onUnlock, onSos }) {
  const tl = lang !== 'en';
  const status = TRIP_STATUS[tripStatus] ?? TRIP_STATUS.on_trip;
  return (
    <div className="drive-lock" role="region" aria-label={t("Driving: screen locked")}>
      <div className="drive-lock-top">
        <span className="drive-lock-badge"><Icon name="shield" size={16} /> {tl ? t("Nagmamaneho") : t("Driving")}</span>
        <span className={`dir-badge ${DIRECTIONS[direction].className}`}>{DIRECTIONS[direction].short}</span>
        {(tripStatus !== 'on_trip' || lastTrip) && (
          <span className="drive-lock-status">{tripStatus !== 'on_trip' ? (tl ? status.tl : status.label) : ''}{lastTrip ? `${tripStatus !== 'on_trip' ? ' · ' : ''}${tl ? t("Huling biyahe") : t("Last trip")}` : ''}</span>
        )}
        <button className="sos-mini" onClick={onSos} aria-label={t("SOS emergency")}>{t("SOS")}</button>
      </div>

      <div className="drive-lock-main">
        <span className="drive-lock-label">{tl ? t("Naghihintay sa unahan") : t("Waiting ahead")}</span>
        {nextWaiting ? (
          <b className="drive-lock-big">
            {nextWaiting.people} · {nextWaiting.stop.short ?? nextWaiting.stop.name}
            {nextWaiting.aheadM != null && <small> {dist(nextWaiting.aheadM)}</small>}
          </b>
        ) : (
          <b className="drive-lock-big muted">{tl ? t("Wala pa") : t("No one yet")}</b>
        )}
        {totalWaiting > (nextWaiting?.people ?? 0) && (
          <span className="drive-lock-sub">{tl ? `${totalWaiting} lahat sa unahan` : `${totalWaiting} in all ahead`}</span>
        )}
      </div>

      <div className="drive-lock-grid">
        <div>
          <span className="drive-lock-label">{tl ? t("Bakanteng upuan") : t("Free seats")}</span>
          <b className={free === 0 ? 'full' : ''}>{free === 0 ? (tl ? t("Puno") : t("Full")) : `${free} / ${capacity}`}</b>
        </div>
        <div>
          <span className="drive-lock-label">{tl ? t("Jeep sa unahan") : t("Jeep ahead")}</span>
          <b className={gaps?.ahead && gaps.ahead.gap < 300 ? 'warn' : ''}>
            {gaps?.ahead ? `${dist(gaps.ahead.gap)} · ${mins(gaps.ahead.gap)} min` : '—'}
          </b>
        </div>
        <div>
          <span className="drive-lock-label">{tl ? t("Jeep sa likod") : t("Jeep behind")}</span>
          <b>{gaps?.behind ? `${dist(gaps.behind.gap)} · ${mins(gaps.behind.gap)} min` : '—'}</b>
        </div>
      </div>

      <p className="drive-lock-note">
        {tl ? t("Naka-lock habang umaandar. Babalik ang mga button pag huminto.") : t("Locked while moving. Buttons come back when you stop.")}{' '}
        <button className="link-btn small" onClick={onUnlock}>{tl ? t("Konduktor? I-unlock") : t("Konduktor? Unlock")}</button>
      </p>
    </div>
  );
}
