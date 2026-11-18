import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, Skeleton, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { listSavedTrips, deleteSavedTrip, deleteSavedPlace, tripPlaces, PLACE_KINDS } from '../lib/account.js';
import { useSavedPlaces } from '../lib/useSavedPlaces.js';
import { planJourneys, networkFromRoutes, fmtMinutes } from '../lib/planner.js';
import { fareText } from '../components/Journey.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { isDemo } from '../lib/supabase.js';

const WHAT_YOU_CAN_SAVE = [
  ['home', 'Places', 'Home, school, work: one tap to plan a trip there'],
  ['heart', 'Trips', 'Your usual rides, like home to school, one tap away'],
  ['fare', 'Your fare type', 'Regular or discounted fares, on every phone you sign in to'],
];

export default function SavedScreen({ route, openOnMap }) {
  const { user } = useAuth();
  const prefs = usePrefs();
  const saved = useSavedPlaces(user);
  const network = useMemo(() => networkFromRoutes([route]), [route]);
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
    saved.reload();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeTrip(id) {
    if (!window.confirm('Remove this saved trip?')) return;
    try {
      await deleteSavedTrip(id);
      setTrips((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function removePlace(p) {
    if (!window.confirm(`Remove “${p.label}” from your places?`)) return;
    try {
      await deleteSavedPlace(p.id);
      await saved.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const missingKinds = ['home', 'school', 'work'].filter((k) => !saved.places.some((p) => p.placeKind === k));

  return (
    <div className="page">
      <PageHeader title="Saved" subtitle="Your places and trips, one tap away." />
      <div className="page-body">
        {!user ? (
          <>
            <div className="empty">
              <span className="empty-icon"><Icon name="heart" size={30} /></span>
              <h3>Save your places and trips</h3>
              <p>Sign in to keep Home, School, Work and your usual trips in one place, on any phone.</p>
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
            {(error || saved.error) && <p className="warn">{error || saved.error}</p>}

            <div className="section-label"><span>Places</span>{saved.places.length > 0 && <span>{saved.places.length}</span>}</div>
            <div className="menu-card">
              {saved.places.map((p) => (
                <div key={p.id} className="menu-row saved-row">
                  <button className="saved-main" onClick={() => openOnMap({ to: p })}>
                    <span className="menu-icon"><Icon name={p.icon} size={20} /></span>
                    <span className="menu-text">
                      <span className="menu-title">{p.label}</span>
                      <span className="menu-sub">{p.sub} · Plan a trip here</span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => removePlace(p)} aria-label={`Remove ${p.label}`}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              ))}
              {missingKinds.map((k) => (
                <button key={k} className="menu-row" onClick={() => navigate('map')}>
                  <span className="menu-icon faded"><Icon name={PLACE_KINDS[k].icon} size={20} /></span>
                  <span className="menu-text">
                    <span className="menu-title">Add {PLACE_KINDS[k].label.toLowerCase()}</span>
                    <span className="menu-sub">On the Map, search for it, then tap “Save as {PLACE_KINDS[k].label}”</span>
                  </span>
                  <Icon name="plus" size={18} className="menu-chevron" />
                </button>
              ))}
            </div>

            <div className="section-label"><span>Trips</span>{trips?.length > 0 && <span>{trips.length}</span>}</div>
            {trips === null ? (
              <Skeleton rows={2} />
            ) : trips.length === 0 ? (
              <div className="empty compact">
                <p>On the Map, choose where you start and where you’re going, then tap the heart.</p>
                <button className="btn primary pill-btn" onClick={() => navigate('map')}>Plan a trip</button>
              </div>
            ) : (
              <div className="menu-card">
                {trips.map((t) => {
                  const { from, to } = tripPlaces(t, route);
                  const best = from && to ? planJourneys(network, from, to).options[0] : null;
                  return (
                    <div key={t.id} className="menu-row saved-row">
                      <button className="saved-main" disabled={!from || !to} onClick={() => openOnMap({ from, to })}>
                        <span className="menu-icon"><Icon name="arrow" size={18} /></span>
                        <span className="menu-text">
                          <span className="menu-title">{t.name}</span>
                          <span className="menu-sub">
                            {best
                              ? `~${fmtMinutes(best.minutes)} · ${fareText(best, prefs.fareType)}${best.rides >= 2 ? ' · 1 transfer' : ''}`
                              : from && to ? 'No route found right now' : 'A stop in this trip is no longer on the route'}
                          </span>
                        </span>
                      </button>
                      <button className="icon-btn" onClick={() => removeTrip(t.id)} aria-label={`Remove ${t.name}`}>
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
