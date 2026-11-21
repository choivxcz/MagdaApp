import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { usePrefs, useDataSaver } from './lib/prefs.js';
import { useJeepneys } from './lib/useJeepneys.js';
import { prepareRoute } from './lib/geo.js';
import { isDemo } from './lib/supabase.js';
import { BottomNav, navigate } from './components/ui.jsx';
import { Logo } from './components/Icon.jsx';
import Onboarding from './screens/Onboarding.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import MapScreen from './screens/MapScreen.jsx';
import RoutesScreen from './screens/RoutesScreen.jsx';
import SavedScreen from './screens/SavedScreen.jsx';
import MoreScreen from './screens/MoreScreen.jsx';
// Only drivers need the Drive tab: riders never download it.
const DriveScreen = lazy(() => import('./screens/DriveScreen.jsx'));
const CommunityScreen = lazy(() => import('./screens/CommunityScreen.jsx'));
import { PageSkeleton } from './components/ui.jsx';
import OfflineRibbon from './components/OfflineRibbon.jsx';
import NewPasswordScreen from './screens/NewPasswordScreen.jsx';
import routeData from './data/route-magdalena-santa-cruz.json';

const route = prepareRoute(routeData);

// "#/more/preferences" -> ["more", "preferences"]
function useHashPath() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'map'; // "?..." is a shared trip
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setPath(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path.split('/');
}

function useTheme(theme) {
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'light' || theme === 'dark') el.setAttribute('data-theme', theme);
    else el.removeAttribute('data-theme');
  }, [theme]);
}

function Shell() {
  const prefs = usePrefs();
  const { loading, user, driver, recovery, notice, clearNotice } = useAuth();
  const [tab, sub] = useHashPath();
  const [mapRequest, setMapRequest] = useState(null);
  const [driverOnTrip, setDriverOnTrip] = useState(false);
  useTheme(prefs.theme);

  const gate = !prefs.onboarded ? 'onboarding'
    : loading ? 'loading'
    : recovery && user ? 'recovery'
    : !user && !prefs.guest && !isDemo ? 'auth'
    : null;

  const tabs = [
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'routes', label: 'Routes', icon: 'routes' },
    { id: 'community', label: 'Community', icon: 'chat' },
    { id: 'saved', label: 'Saved', icon: 'heart' },
    ...(driver ? [{ id: 'drive', label: driverOnTrip ? 'On trip' : 'Drive', icon: 'drive' }] : []),
    { id: 'more', label: 'More', icon: 'more' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'map';

  // The Drive tab uses it too, for the gap to the jeepneys ahead and behind.
  // How often to check for jeepney updates. Fast only while the rider is
  // watching for their jeepney; slower when browsing; slower still with
  // Data saver. (Each check downloads only what changed.)
  const saver = useDataSaver();
  const [tracking, setTracking] = useState(false);
  const pollMs = current === 'map' ? (tracking ? 5000 : 12000) : current === 'drive' ? 15000 : 20000;
  const live = useJeepneys(route, !gate && (current === 'map' || current === 'routes' || current === 'drive'), saver ? Math.max(10000, pollMs * 2) : pollMs);

  const openOnMap = useCallback((request) => {
    setMapRequest({ ...request, at: Date.now() });
    navigate('map');
  }, []);

  const toast = notice && (
    <div className={`toast ${notice.kind}`} role="status">
      <span>{notice.text}</span>
      <button className="link-btn small" onClick={clearNotice}>OK</button>
    </div>
  );

  if (gate === 'onboarding') return <Onboarding />;
  if (gate === 'loading') return <div className="splash"><Logo size={84} /><p>Sakay Laguna</p></div>;
  if (gate === 'recovery') return <NewPasswordScreen />;
  if (gate === 'auth') return <>{toast}<AuthScreen /></>;

  return (
    <div className="app">
      {toast}
      <OfflineRibbon />
      <main className="content">
        {/* Map and Drive stay mounted so the map and an active trip survive tab switches. */}
        <div className="screen" hidden={current !== 'map'}>
          <MapScreen route={route} jeepneys={live.jeepneys} error={live.error} request={mapRequest} visible={current === 'map'} onRequest={openOnMap} onTracking={setTracking} />
        </div>
        {driver && user && (
          <div className="screen" hidden={current !== 'drive'}>
            <Suspense fallback={<div className="splash small"><Logo size={56} /></div>}>
              <DriveScreen key={user.id} route={route} userId={user.id} driver={driver} visible={current === 'drive'} jeepneys={live.jeepneys} onTripChange={setDriverOnTrip} />
            </Suspense>
          </div>
        )}
        {current === 'routes' && <RoutesScreen route={route} jeepneys={live.jeepneys} sub={sub} openOnMap={openOnMap} />}
        {current === 'community' && <Suspense fallback={<PageSkeleton />}><CommunityScreen route={route} sub={sub} openOnMap={openOnMap} /></Suspense>}
        {current === 'saved' && <SavedScreen route={route} openOnMap={openOnMap} />}
        {current === 'more' && <MoreScreen route={route} sub={sub} />}
      </main>
      <BottomNav tabs={tabs} current={current} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
