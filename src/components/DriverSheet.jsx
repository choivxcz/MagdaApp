import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { fetchDriverCard } from '../lib/photos.js';
import { isDemo } from '../lib/supabase.js';
import { DIRECTIONS, seatStatus } from '../lib/directions.js';
import { riderStatusText, statusOf } from '../lib/tripStatus.js';
import { useDataSaver } from '../lib/prefs.js';
import { t } from '../lib/i18n.js';

function agoText(date) {
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

// Pops up over the map when a rider taps a jeepney: the jeepney photo,
// the driver's profile picture and name, plate, direction and free seats.
// `jeep` is the live map entry (null once the jeepney stops sharing).
export default function DriverSheet({ jeepId, jeep, onClose }) {
  const [card, setCard] = useState(undefined); // undefined = loading, null = not found
  // Photos are the biggest download here: with Data saver, only on request.
  const saver = useDataSaver();
  const [photosOn, setPhotosOn] = useState(!saver);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCard(undefined);
    setError('');
    if (isDemo) {
      setCard({ name: 'Demo driver', plate: jeep?.plate, avatar: null, jeepney: null });
      return;
    }
    fetchDriverCard(jeepId)
      .then((c) => { if (!cancelled) setCard(c); })
      .catch((e) => { if (!cancelled) { setCard(null); setError(e.message || String(e)); } });
    return () => { cancelled = true; };
  }, [jeepId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dir = jeep && DIRECTIONS[jeep.direction];
  const seats = jeep && seatStatus(jeep);
  const plate = card?.plate ?? jeep?.plate;

  return (
    <div className="driver-backdrop" onClick={onClose}>
      <section className="driver-sheet" role="dialog" aria-modal="true" aria-label={`Jeepney ${plate ?? ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="driver-jeep-photo">
          {card?.jeepney && photosOn ? (
            <img src={card.jeepney} alt={`Jeepney ${plate ?? ''}`} />
          ) : card?.jeepney || card?.avatar ? (
            <button className="jeep-photo-empty photo-load" onClick={() => setPhotosOn(true)}>
              <Icon name="camera" size={30} />
              <span>{t("Show photos")}{' '}<small>(uses a little data)</small></span>
            </button>
          ) : (
            <div className="jeep-photo-empty">
              <Icon name="bus" size={34} />
              <span>{card === undefined ? t("Loading…") : t("No jeepney photo yet")}</span>
            </div>
          )}
          <button className="driver-close" onClick={onClose} aria-label={t("Close")}><Icon name="close" size={18} /></button>
        </div>

        <div className="driver-body">
          <div className="driver-head">
            <Avatar url={photosOn ? card?.avatar : null} name={card?.name} size={72} className="driver-avatar" />
            <div className="driver-name">
              <b>{card?.name ?? (card === undefined ? t("Loading…") : t("Jeepney driver"))}</b>
              <span className="sub">{t("Driver ·")}{' '}{plate}</span>
            </div>
          </div>

          {error && <p className="warn">{t("Couldn’t load the driver’s profile:")}{' '}{error}</p>}

          {jeep && riderStatusText(jeep) && (
            <p className={`driver-status ${jeep.tripStatus ?? ''}`}><Icon name={statusOf(jeep).icon} size={16} /> {riderStatusText(jeep)}</p>
          )}
          {jeep ? (
            <div className="kv-grid">
              <span><small>{t("Plate")}</small><b>{plate}</b></span>
              <span><small>{t("Direction")}</small><b>{dir?.label ?? '—'}</b></span>
              <span><small>{t("Seats")}</small><b>{seats?.level === 'unknown' ? '—' : seats.text}</b></span>
            </div>
          ) : (
            <p className="hint">{t("This jeepney stopped sharing its location.")}</p>
          )}
          {jeep && <p className="fineprint">{t("Location updated")}{' '}{agoText(jeep.updatedAt)}.</p>}
        </div>
      </section>
    </div>
  );
}
