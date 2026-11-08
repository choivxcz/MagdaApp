import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { usePrefs } from './lib/prefs.js';
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
import DriveScreen from './screens/DriveScreen.jsx';
import NewPasswordScreen from './screens/NewPasswordScreen.jsx';
import routeData from './data/route-magdalena-santa-cruz.json';

const route = prepareRoute(routeData);

// "#/more/preferences" -> ["more", "preferences"]
function useHashPath() {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'map';
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
    { id: 'saved', label: 'Saved', icon: 'heart' },
    ...(driver ? [{ id: 'drive', label: driverOnTrip ? 'On trip' : 'Drive', icon: 'drive' }] : []),
    { id: 'more', label: 'More', icon: 'more' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'map';

  const live = useJeepneys(route, !gate && (current === 'map' || current === 'routes'));

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
      <main className="content">
        {/* Map and Drive stay mounted so the map and an active trip survive tab switches. */}
        <div className="screen" hidden={current !== 'map'}>
          <MapScreen route={route} jeepneys={live.jeepneys} error={live.error} request={mapRequest} visible={current === 'map'} />
        </div>
        {driver && user && (
          <div className="screen" hidden={current !== 'drive'}>
            <DriveScreen key={user.id} route={route} userId={user.id} driver={driver} visible={current === 'drive'} onTripChange={setDriverOnTrip} />
          </div>
        )}
        {current === 'routes' && <RoutesScreen route={route} jeepneys={live.jeepneys} sub={sub} openOnMap={openOnMap} />}
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
