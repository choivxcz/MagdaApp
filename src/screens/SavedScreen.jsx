import { useCallback, useEffect, useState } from 'react';
import { PageHeader, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { listSavedTrips, deleteSavedTrip } from '../lib/account.js';
import { computeFare, peso } from '../lib/fare.js';
import { DIRECTIONS } from '../lib/directions.js';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { isDemo } from '../lib/supabase.js';

const WHAT_YOU_CAN_SAVE = [
  ['heart', 'Trips', 'Your usual rides, like home to school, one tap away'],
  ['fare', 'Your fare type', 'Regular or discounted fares, on every phone you sign in to'],
  ['report', 'Ride reports', 'Follow what happened to reports you sent'],
];

export default function SavedScreen({ route, openOnMap }) {
  const { user } = useAuth();
  const prefs = usePrefs();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setTrips(await listSavedTrips());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id) {
    if (!window.confirm('Remove this saved trip?')) return;
    try {
      await deleteSavedTrip(id);
      setTrips((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Saved" subtitle="Trips you’ve saved for quick access." />
      <div className="page-body">
        {!user ? (
          <>
            <div className="empty">
              <span className="empty-icon"><Icon name="heart" size={30} /></span>
              <h3>Save your trips for later</h3>
              <p>Sign in to keep your usual trips in one place, on any phone.</p>
              {!isDemo && (
                <div className="stack">
                  <button className="btn primary pill-btn" onClick={() => setPrefs({ guest: false })}>Sign in</button>
                  <button className="btn pill-btn" onClick={() => setPrefs({ guest: false })}>Create an account</button>
                </div>
              )}
            </div>
            <div className="section-label"><span>What you can save</span></div>
            <div className="menu-card">
              {WHAT_YOU_CAN_SAVE.map(([icon, title, sub]) => (
                <div key={title} className="menu-row static">
                  <span className="menu-icon"><Icon name={icon} size={20} /></span>
                  <span className="menu-text"><span className="menu-title">{title}</span><span className="menu-sub">{sub}</span></span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {error && <p className="warn">{error}</p>}
            {trips === null ? (
              <p className="hint">Loading…</p>
            ) : trips.length === 0 ? (
              <div className="empty">
                <span className="empty-icon"><Icon name="heart" size={30} /></span>
                <h3>Nothing saved yet</h3>
                <p>On the Map, choose where you ride from and to, then tap the heart.</p>
                <button className="btn primary pill-btn" onClick={() => navigate('map')}>Plan a trip</button>
              </div>
            ) : (
              <>
                <div className="section-label"><span>Trips</span><span>{trips.length}</span></div>
                <div className="menu-card">
                  {trips.map((t) => {
                    const leg = route.legs[t.direction];
                    const from = leg?.stops.find((s) => s.id === t.pickup_stop_id);
                    const to = leg?.stops.find((s) => s.id === t.dropoff_stop_id);
                    const fare = from && to ? computeFare(to.along - from.along) : null;
                    return (
                      <div key={t.id} className="menu-row saved-row">
                        <button
                          className="saved-main"
                          onClick={() => openOnMap({ direction: t.direction, pickupStopId: t.pickup_stop_id, dropoffStopId: t.dropoff_stop_id })}
                        >
                          <span className={`menu-icon dir ${DIRECTIONS[t.direction].className}`}><Icon name="arrow" size={18} /></span>
                          <span className="menu-text">
                            <span className="menu-title">{t.name}</span>
                            <span className="menu-sub">
                              {DIRECTIONS[t.direction].label}{fare ? ` · ${peso(fare[prefs.fareType])} · ${fare.km.toFixed(1)} km` : ' · stop no longer on route'}
                            </span>
                          </span>
                        </button>
                        <button className="icon-btn" onClick={() => remove(t.id)} aria-label={`Remove ${t.name}`}>
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
