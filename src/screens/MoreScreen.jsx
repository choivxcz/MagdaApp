import { lazy, Suspense, useEffect, useState } from 'react';
import { PageHeader, MenuGroup, MenuRow, Segmented, Avatar, navigate } from '../components/ui.jsx';
import PhotoField from '../components/PhotoField.jsx';
import Icon, { Logo } from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { supabase, isDemo } from '../lib/supabase.js';
import { updateProfile, fileReport, listMyReports, deleteMyAccount } from '../lib/account.js';
import { computeFare, peso, FARE_RULES, TRICYCLE_RULES } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS } from '../lib/directions.js';

import { PageSkeleton } from '../components/ui.jsx';
import { isDataSaver } from '../lib/prefs.js';
import { useDataUsed, fmtBytes, resetDataUsed } from '../lib/dataMeter.js';
import { phoneWantsSavings } from '../lib/prefs.js';
import { BROWSE, DEFAULT_SHORTCUTS } from '../lib/placeIndex.js';
import { listBlocked, unblockUser } from '../lib/communityPosts.js';

// Pages only some people open are downloaded when first opened.
const DriverApplyScreen = lazy(() => import('./DriverApplyScreen.jsx'));
const AdminScreen = lazy(() => import('./AdminScreen.jsx'));
const EarningsScreen = lazy(() => import('./EarningsScreen.jsx'));

const APP_VERSION = '0.6.0';

export default function MoreScreen({ route, sub }) {
  switch (sub) {
    case 'preferences': return <Preferences />;
    case 'fares': return <FareGuide route={route} />;
    case 'report': return <ReportRide />;
    case 'route-issue': return <RouteIssue />;
    case 'guidelines': return <Guidelines />;
    case 'account': return <Account />;
    case 'about': return <About />;
    case 'privacy': return <Privacy />;
    case 'driver': return <Suspense fallback={<PageSkeleton />}><DriverApplyScreen /></Suspense>;
    case 'admin': return <Suspense fallback={<PageSkeleton />}><AdminScreen /></Suspense>;
    case 'earnings': return <Suspense fallback={<PageSkeleton />}><EarningsScreen /></Suspense>;
    default: return <MoreMenu />;
  }
}

function MoreMenu() {
  const { user, profile, driver, driverRecord, isAdmin, photos } = useAuth();
  const prefs = usePrefs();
  const driverStatus = driverRecord?.status;

  async function signOut() {
    await supabase.auth.signOut();
    setPrefs({ guest: false });
    navigate('map');
  }

  function chooseFare(fareType) {
    setPrefs({ fareType });
    if (user) updateProfile(user.id, { fare_type: fareType }).catch(() => {});
  }

  return (
    <div className="page">
      <PageHeader title="More" />
      <div className="page-body">
        {user ? (
          <button className="profile-card" onClick={() => navigate('more/account')}>
            <Avatar url={photos.avatar} name={profile?.full_name || user.email} />
            <span className="profile-text">
              <b>{profile?.full_name || 'Commuter'}</b>
              <span className="sub">{user.email}</span>
              {driver && <span className="pill">Driver · {driver.plate}</span>}
            </span>
            <Icon name="chevron" size={18} className="menu-chevron" />
          </button>
        ) : (
          <button className="profile-card" onClick={() => setPrefs({ guest: false })} disabled={isDemo}>
            <span className="avatar ghost"><Icon name="user" size={22} /></span>
            <span className="profile-text">
              <b>{isDemo ? 'Demo mode' : 'Sign in'}</b>
              <span className="sub">{isDemo ? 'Accounts work once the database is connected.' : 'Save trips and report rides from any phone'}</span>
            </span>
            {!isDemo && <Icon name="chevron" size={18} className="menu-chevron" />}
          </button>
        )}

        {isAdmin && (
          <MenuGroup title="Admin">
            <MenuRow icon="key" title="Admin tools" sub="Drivers, reports, Community review, SOS alerts" onClick={() => navigate('more/admin')} />
          </MenuGroup>
        )}

        <MenuGroup title="Drive with us">
          {driver ? (
            <>
              <MenuRow icon="drive" title="Driver mode" sub={`${driver.plate} · ${driver.seat_capacity} seats`} onClick={() => navigate('drive')} />
              <MenuRow icon="fare" title="Earnings log" sub="Kita, krudo, boundary: your take-home each day" onClick={() => navigate('more/earnings')} />
            </>
          ) : (
            <MenuRow
              icon="drive"
              title={driverStatus ? 'Driver application' : 'Become a driver'}
              sub={driverStatus === 'rejected' ? 'Not approved, tap to see why' : driverStatus === 'disabled' ? 'Driver access turned off' : driverStatus ? 'Waiting for admin approval' : 'Share your jeepney’s location and free seats'}
              badge={driverStatus === 'pending' ? 'Pending' : undefined}
              onClick={() => navigate('more/driver')}
            />
          )}
        </MenuGroup>

        <MenuGroup title="Quick settings">
          <MenuRow icon="theme" title="Theme" right={
            <Segmented small value={prefs.theme} onChange={(theme) => setPrefs({ theme })}
              options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />
          } />
          <MenuRow icon="fare" title="Fare type" right={
            <Segmented small value={prefs.fareType} onChange={chooseFare}
              options={[['regular', 'Regular'], ['discounted', 'Discounted']]} />
          } />
          <MenuRow icon="layers" title="Data saver" sub={isDataSaver(prefs) ? 'On: fewer updates, less load used' : 'Off'} onClick={() => navigate('more/preferences')}
            right={<span className={`pill ${isDataSaver(prefs) ? 'ok-pill' : ''}`}>{prefs.dataSaver === 'auto' ? 'Auto' : prefs.dataSaver === 'on' ? 'On' : 'Off'}</span>} />
        </MenuGroup>

        <MenuGroup title="Commute tools">
          <MenuRow icon="fare" title="Fare guide & calculator" sub="Fares between every stop" onClick={() => navigate('more/fares')} />
          <MenuRow icon="chat" title="Community" sub="Tricycle routes, terminals, tips and chat from commuters" onClick={() => navigate('community')} />
          <MenuRow icon="report" title="Report a ride" sub="Overcharging, harassment, reckless or rude driver" onClick={() => navigate('more/report')} />
          <MenuRow icon="phone" title="Emergency hotline" sub="Call 911 for police, fire or medical help" href="tel:911" />
        </MenuGroup>

        <MenuGroup title="Support">
          <MenuRow icon="routes" title="Report route issue" sub="Missing route, wrong path, or a problem with the map" onClick={() => navigate('more/route-issue')} />
          <MenuRow icon="shield" title="Community guidelines" sub="Rules for posts, comments and chat" onClick={() => navigate('more/guidelines')} />
        </MenuGroup>

        <MenuGroup title="App">
          <MenuRow icon="sliders" title="Preferences" onClick={() => navigate('more/preferences')} />
          <MenuRow icon="info" title="About Sakay Laguna" onClick={() => navigate('more/about')} />
          <MenuRow icon="shield" title="Privacy & data sources" onClick={() => navigate('more/privacy')} />
        </MenuGroup>

        {user && (
          <MenuGroup title="Account">
            <MenuRow icon="user" title="Account & data" sub="Photo, name, delete account" onClick={() => navigate('more/account')} />
            <MenuRow icon="logout" title="Sign out" onClick={signOut} right={<span />} />
          </MenuGroup>
        )}

        <p className="fineprint center">Sakay Laguna v{APP_VERSION} · Student project · Not affiliated with LTFRB or any LGU</p>
      </div>
    </div>
  );
}

function Preferences() {
  const prefs = usePrefs();
  const { user } = useAuth();

  function chooseFare(fareType) {
    setPrefs({ fareType });
    if (user) updateProfile(user.id, { fare_type: fareType }).catch(() => {});
  }

  return (
    <div className="page">
      <PageHeader title="Preferences" back="more" />
      <div className="page-body">
        <MenuGroup title="Fare type">
          <div className="choice-list inset">
            {[
              ['regular', 'Regular', 'Standard fare'],
              ['discounted', 'Discounted', 'Student, Senior Citizen or PWD (20% off)'],
            ].map(([id, title, sub]) => (
              <button key={id} className={`choice ${prefs.fareType === id ? 'on' : ''}`} onClick={() => chooseFare(id)}>
                <span className="radio" />
                <span><b>{title}</b><small>{sub}</small></span>
              </button>
            ))}
          </div>
        </MenuGroup>
        <MenuGroup title="Theme">
          <div className="inset"><Segmented value={prefs.theme} onChange={(theme) => setPrefs({ theme })}
            options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} /></div>
        </MenuGroup>
        <DataSettings />
        <ShortcutSettings />
        <CommunitySettings />
        <MenuGroup title="Feel">
          <MenuRow icon="sparkle" title="Vibrate on taps" sub="A small buzz when you choose, save or start a trip (Android)"
            right={<input type="checkbox" className="switch" checked={prefs.haptics !== false} onChange={(e) => setPrefs({ haptics: e.target.checked })} aria-label="Vibrate on taps" />} />
        </MenuGroup>
      </div>
    </div>
  );
}

// Data saver and how much data the app used, for riders and drivers on load.
function DataSettings() {
  const prefs = usePrefs();
  const used = useDataUsed();
  const on = isDataSaver(prefs);
  return (
    <MenuGroup title="Mobile data">
      <div className="choice-list inset">
        {[
          ['auto', 'Auto', phoneWantsSavings() ? 'On now: your phone’s Data Saver is on or the signal is slow' : 'Turns on when your phone’s Data Saver is on or the signal is slow (2G)'],
          ['on', 'Always save data', 'Fewer jeepney updates, photos only when you tap, fewer searches'],
          ['off', 'Off', 'Fastest updates'],
        ].map(([id, title, sub]) => (
          <button key={id} className={`choice ${prefs.dataSaver === id ? 'on' : ''}`} onClick={() => setPrefs({ dataSaver: id })}>
            <span className="radio" />
            <span><b>{title}</b><small>{sub}</small></span>
          </button>
        ))}
      </div>
      <div className="inset data-meter">
        <div className="data-meter-row">
          <span><small>Today</small><b>{fmtBytes(used.today)}</b></span>
          <span><small>This month</small><b>{fmtBytes(used.thisMonth)}</b></span>
          <button className="link-btn small" onClick={resetDataUsed}>Reset</button>
        </div>
        <p className="fineprint">
          About how much this app’s live updates, searches and directions used on this phone. Map pictures download once and are
          then kept on your phone{on ? '' : ''}. Updates pause when the app is in the background. Data saver is {on ? 'on' : 'off'}.
        </p>
      </div>
    </MenuGroup>
  );
}

// Which "kind" buttons show on the map, next to your saved places (up to 6).
function ShortcutSettings() {
  const prefs = usePrefs();
  const chosen = prefs.shortcuts ?? DEFAULT_SHORTCUTS;
  const toggle = (k) => setPrefs({ shortcuts: chosen.includes(k) ? chosen.filter((x) => x !== k) : chosen.length >= 6 ? chosen : [...chosen, k] });
  return (
    <MenuGroup title="Map shortcuts">
      <div className="inset">
        <p className="fineprint">Buttons under the search box on the map. Your saved places (Home, School…) always come first.</p>
        <div className="chip-wrap">
          {Object.entries(BROWSE).map(([k, b]) => (
            <button key={k} type="button" className={`chip small ${chosen.includes(k) ? 'on' : ''}`} aria-pressed={chosen.includes(k)} onClick={() => toggle(k)}>
              <Icon name={b.icon} size={14} /> {b.short ?? b.label}
            </button>
          ))}
        </div>
      </div>
    </MenuGroup>
  );
}

function CommunitySettings() {
  const prefs = usePrefs();
  const { user } = useAuth();
  const [blocked, setBlocked] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (user && !isDemo) listBlocked().then(setBlocked).catch((e) => setErr(e.message));
  }, [user]);
  if (!user) return null;
  return (
    <MenuGroup title="Community">
      <MenuRow icon="user" title="Anonymous in Community chat" sub="Show “Anonymous commuter” instead of your name on new chat messages"
        right={<input type="checkbox" className="switch" checked={!!prefs.chatAnonymous} onChange={(e) => setPrefs({ chatAnonymous: e.target.checked })} aria-label="Anonymous in Community chat" />} />
      <div className="inset">
        <b className="small-title">Blocked people</b>
        <p className="fineprint">You and the people you block can’t see each other’s posts, comments or chat messages.</p>
        {err && <p className="warn small">{err}</p>}
        {blocked?.length === 0 && <p className="sub">No one.</p>}
        {blocked?.map((b) => (
          <div key={b.id} className="row-between">
            <span>{b.name}</span>
            <button type="button" className="link-btn small" onClick={async () => { await unblockUser(b.id); setBlocked(blocked.filter((x) => x.id !== b.id)); }}>Unblock</button>
          </div>
        ))}
      </div>
    </MenuGroup>
  );
}

function FareGuide({ route }) {
  const prefs = usePrefs();
  const [direction, setDirection] = useState('to_santa_cruz');
  const leg = route.legs[direction];
  const [fromId, setFromId] = useState(leg.stops[0].id);
  const [toId, setToId] = useState(leg.stops[leg.stops.length - 1].id);

  useEffect(() => {
    setFromId(leg.stops[0].id);
    setToId(leg.stops[leg.stops.length - 1].id);
  }, [leg]);

  const from = leg.stops.find((s) => s.id === fromId) ?? leg.stops[0];
  const to = leg.stops.find((s) => s.id === toId) ?? leg.stops[leg.stops.length - 1];
  const valid = to.along > from.along;
  const fare = valid ? computeFare(to.along - from.along) : null;

  return (
    <div className="page">
      <PageHeader title="Fare guide" back="more" />
      <div className="page-body">
        <Segmented value={direction} onChange={setDirection}
          options={DIRECTION_KEYS.map((d) => [d, DIRECTIONS[d].label, DIRECTIONS[d].className])} />

        <div className="card calc">
          <label className="field"><span className="label">From</span>
            <select value={from.id} onChange={(e) => setFromId(e.target.value)}>
              {leg.stops.slice(0, -1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">To</span>
            <select value={to.id} onChange={(e) => setToId(e.target.value)}>
              {leg.stops.slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {valid ? (
            <div className="calc-result">
              <div><span className="label">Regular</span><b className={prefs.fareType === 'regular' ? 'big' : ''}>{peso(fare.regular)}</b></div>
              <div><span className="label">Student / Senior / PWD</span><b className={prefs.fareType === 'discounted' ? 'big' : ''}>{peso(fare.discounted)}</b></div>
              <div><span className="label">Distance</span><b>{fare.km.toFixed(1)} km</b></div>
            </div>
          ) : (
            <p className="warn">“To” must come after “From” in this direction.</p>
          )}
          {valid && <button type="button" className="link-btn small align-start" onClick={() => navigate('more/report')}>Charged more than this? Report it</button>}
        </div>

        <h3>All fares from {leg.stops[0].name}</h3>
        <table className="fare-table">
          <thead><tr><th>Stop</th><th>km</th><th>Regular</th><th>Disc.</th></tr></thead>
          <tbody>
            {leg.stops.slice(1).map((s) => {
              const f = computeFare(s.along - leg.stops[0].along);
              return <tr key={s.id}><td>{s.name}</td><td>{f.km.toFixed(1)}</td><td>{peso(f.regular)}</td><td>{peso(f.discounted)}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="fineprint">
          How fares are computed: ₱{FARE_RULES.base} for the first {FARE_RULES.baseKm} km, then ₱{FARE_RULES.perKm.toFixed(2)} per km.
          Discount: {FARE_RULES.discount * 100}%. Based on the {FARE_RULES.source}. Actual fares may differ.
        </p>
        <p className="fineprint">
          Tricycles: the trip planner suggests one when a place is too far to walk from the route. Their fares are set by each town,
          so the app only shows a rough estimate (₱{TRICYCLE_RULES.base} for the first {TRICYCLE_RULES.baseKm} km, then ₱{TRICYCLE_RULES.perKm} per km, shared ride).
          Agree on the fare with the driver first; special trips cost more.
        </p>
      </div>
    </div>
  );
}

const CATEGORIES = [
  ['overpricing', 'Overcharging', 'Charged more than the fare'],
  ['harassment', 'Sexual harassment or abuse', 'Unwanted touching, comments, threats'],
  ['reckless', 'Reckless driving', 'Speeding, overloading, unsafe stops'],
  ['rude', 'Rude driver', 'Shouting, refusing passengers, no change'],
  ['other', 'Something else', ''],
];
const ROUTE_ISSUES = [
  ['missing_route', 'Missing route', 'A jeepney or tricycle route that isn’t in the app'],
  ['wrong_route', 'Wrong path', 'The line on the map isn’t where the jeepney goes'],
  ['route_problem', 'Other problem', 'Wrong stop, place, fare or anything else'],
];
const ALL_REPORTS = [...CATEGORIES, ...ROUTE_ISSUES];

function ReportRide() {
  const { user } = useAuth();
  const [plate, setPlate] = useState('');
  const [noPlate, setNoPlate] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [category, setCategory] = useState('overpricing');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [mine, setMine] = useState([]);

  useEffect(() => {
    if (user) listMyReports().then(setMine).catch(() => {});
  }, [user]);

  async function submit(e) {
    e.preventDefault();
    if (!noPlate && !plate.trim()) return setMsg('Enter the plate number, or tick “I didn’t see the plate”.');
    if (noPlate && vehicle.trim().length < 3) return setMsg('Describe the jeep, like its body number or colors.');
    setBusy(true);
    setMsg('');
    try {
      await fileReport({ plate: noPlate ? '' : plate.trim().toUpperCase(), vehicle: noPlate ? vehicle.trim() : '', category, details: details.trim() });
      setMsg('Thank you. Your report was sent. The admin will look at it.');
      setPlate('');
      setVehicle('');
      setDetails('');
      setMine(await listMyReports());
    } catch (err) {
      setMsg(`Could not send: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Report a ride" back="more" />
      <div className="page-body">
        <a className="sos" href="tel:911"><Icon name="phone" size={20} /> In danger right now? Call 911</a>
        {!user ? (
          <div className="card">
            <p className="body-text">Sign in so we can follow up on your report and prevent fake reports.</p>
            {!isDemo && <button className="btn primary" onClick={() => setPrefs({ guest: false })}>Sign in</button>}
          </div>
        ) : (
          <form className="card form" onSubmit={submit}>
            {!noPlate ? (
              <label className="field"><span className="label">Plate number</span>
                <input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} placeholder="e.g. MAG 101" />
              </label>
            ) : (
              <label className="field"><span className="label">Jeep body number or description</span>
                <input value={vehicle} onChange={(e) => setVehicle(e.target.value.slice(0, 80))} maxLength={80} placeholder="e.g. No. 12, blue with “Lord’s Gift”" />
              </label>
            )}
            <label className="switch-label"><span>I didn’t see the plate</span>
              <input type="checkbox" className="switch" checked={noPlate} onChange={(e) => setNoPlate(e.target.checked)} />
            </label>
            <span className="label">What happened?</span>
            <div className="choice-list">
              {CATEGORIES.map(([id, title, sub]) => (
                <button type="button" key={id} className={`choice ${category === id ? 'on' : ''}`} onClick={() => setCategory(id)}>
                  <span className="radio" />
                  <span><b>{title}</b>{sub && <small>{sub}</small>}</span>
                </button>
              ))}
            </div>
            {category === 'harassment' && (
              <div className="harass-help">
                <p>If you are in danger now, call for help first.</p>
                <a className="btn danger small" href="tel:911"><Icon name="phone" size={15} /> Call 911</a>
              </div>
            )}
            <label className="field"><span className="label">Details</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={4}
                placeholder="When and where did it happen? What did you see? (You can also send photos to the admin later.)" />
            </label>
            <button className="btn primary wide" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
            {msg && <p className={msg.startsWith('Thank') ? 'ok' : 'warn'}>{msg}</p>}
          </form>
        )}
        {mine.length > 0 && (
          <>
            <h3>Your reports</h3>
            <ul className="list">
              {mine.map((r) => (
                <li key={r.id}>
                  <span className={`status-pill ${r.status}`}>{r.status === 'open' ? 'Sent' : 'Resolved'}</span>
                  <span>
                    <b>{ALL_REPORTS.find((c) => c[0] === r.category)?.[1] ?? r.category}</b>
                    <span className="sub">{r.plate ? `${r.plate} · ` : r.vehicle ? `${r.vehicle} · ` : ''}{new Date(r.created_at).toLocaleDateString()}</span>
                  </span>
                  <span />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// Missing route, wrong path, or another map problem.
function RouteIssue() {
  const { user } = useAuth();
  const [category, setCategory] = useState('missing_route');
  const [where, setWhere] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (details.trim().length < 5) return setMsg('Tell us a little more.');
    setBusy(true);
    setMsg('');
    try {
      await fileReport({ category, context: where.trim().slice(0, 300), details: details.trim() });
      setMsg('Thank you! We’ll check it. You can also add tricycle routes and terminals yourself in Community.');
      setWhere('');
      setDetails('');
    } catch (err) {
      setMsg(`Could not send: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Report route issue" back="more" />
      <div className="page-body">
        <p className="body-text muted">Found something wrong on the map? Tell us. Know a tricycle or e-trike route? <button type="button" className="link-btn small" onClick={() => navigate('community')}>Add it in Community</button></p>
        {!user ? (
          <div className="card">
            <p className="body-text">Sign in to send a report.</p>
            {!isDemo && <button className="btn primary" onClick={() => setPrefs({ guest: false })}>Sign in</button>}
          </div>
        ) : (
          <form className="card form" onSubmit={submit}>
            <div className="choice-list">
              {ROUTE_ISSUES.map(([id, title, sub]) => (
                <button type="button" key={id} className={`choice ${category === id ? 'on' : ''}`} onClick={() => setCategory(id)}>
                  <span className="radio" /><span><b>{title}</b><small>{sub}</small></span>
                </button>
              ))}
            </div>
            <label className="field"><span className="label">Where? (street, barangay or stop)</span>
              <input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={300} placeholder="e.g. Rizal St corner Burgos, Poblacion" />
            </label>
            <label className="field"><span className="label">What’s wrong?</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={4}
                placeholder="e.g. Jeepneys to Sta. Cruz now pass Manas Street, not Zulueta." />
            </label>
            <button className="btn primary wide" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
            {msg && <p className={msg.startsWith('Thank') ? 'ok' : 'warn'}>{msg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

function Guidelines() {
  return (
    <div className="page">
      <PageHeader title="Community guidelines" back="more" />
      <div className="page-body prose">
        <p>Community is for real, useful commute information around Magdalena, Pagsanjan and Santa Cruz. Be kind and helpful.</p>
        <ul>
          <li><b>Share what’s true.</b> Routes, terminals, fares and tips you know from riding. Say when you’re not sure.</li>
          <li><b>No harassment or hate.</b> No insults, threats, or attacks on anyone, including drivers.</li>
          <li><b>No personal information.</b> Don’t post names, phone numbers, addresses, faces or plate numbers. To complain about a ride, use More → Report a ride: it goes to the admin, not the public.</li>
          <li><b>No selling, ads or spam.</b></li>
          <li><b>No sexual or violent content.</b></li>
        </ul>
        <h3>How we keep it safe</h3>
        <ul>
          <li>New routes and terminals are checked by an admin before everyone sees them.</li>
          <li>Tap ••• on any post, comment or chat message to report it or block the person. When 3 people report the same thing, it is hidden right away until the admin reviews it.</li>
          <li>People who break the rules can be banned; all their posts, comments and messages are then hidden.</li>
          <li>Chat messages disappear after 1 hour.</li>
        </ul>
        <p className="fineprint">In an emergency, call 911.</p>
      </div>
    </div>
  );
}

function Account() {
  const { user, profile, driverRecord, photos, reload } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(profile?.full_name ?? ''), [profile]);

  if (!user) {
    navigate('more');
    return null;
  }

  async function saveName(e) {
    e.preventDefault();
    try {
      await updateProfile(user.id, { full_name: name.trim() });
      await reload();
      setMsg('Saved.');
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function removeAccount() {
    if (!window.confirm('Delete your account? Your profile, photos, saved places and trips, and community tips will be permanently deleted. This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteMyAccount(user.id);
      setPrefs({ guest: false });
      navigate('map');
    } catch (err) {
      setMsg(`Could not delete: ${err.message}`);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Account & data" back="more" />
      <div className="page-body">
        <div className="card photos-card">
          <PhotoField
            kind="avatar" userId={user.id} url={photos.avatar} name={profile?.full_name || user.email} onChanged={reload}
            title="Profile picture"
            sub={driverRecord ? 'Riders see this when they tap your jeepney on the map.' : 'Shown on your account.'}
          />
          {driverRecord && (
            <PhotoField
              kind="jeepney" userId={user.id} url={photos.jeepney} onChanged={reload}
              title="Jeepney photo"
              sub="Riders see this when they tap your jeepney. Take it from the front or side so the colors and plate are clear."
            />
          )}
        </div>
        <form className="card form" onSubmit={saveName}>
          <label className="field"><span className="label">Email</span><input value={user.email} disabled /></label>
          <label className="field"><span className="label">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <button className="btn primary">Save</button>
          {msg && <p className="hint">{msg}</p>}
        </form>
        <MenuGroup title="Danger zone">
          <MenuRow icon="trash" danger title={busy ? 'Deleting…' : 'Delete account'} sub="Permanently delete your account, profile, photos, saved places, trips and tips"
            onClick={removeAccount} />
        </MenuGroup>
      </div>
    </div>
  );
}

function About() {
  return (
    <div className="page">
      <PageHeader title="About" back="more" />
      <div className="page-body prose">
        <div className="about-logo"><Logo size={88} /></div>
        <h2>Sakay Laguna</h2>
        <p>
          A free commuter app for the Magdalena – Santa Cruz, Laguna jeepney route. Search any place and it tells you how to
          get there: where to walk, where to wait (sakayan), which jeepney to ride, where to get off (babaan), when a tricycle
          makes sense, and about how much it costs. See jeepneys live on the map, how many seats are free, and when the next one reaches you.
        </p>
        <p>
          Local commuters can share tips that maps don’t know, like where people actually wait, route changes and fare practices.
        </p>
        <p>
          Drivers share their location and passenger count from their phone during a trip. Riders do not need an
          account to see jeepneys; an account lets you save trips and send ride reports.
        </p>
        <p className="fineprint">
          This is an independent student project. It is not affiliated with or endorsed by the LTFRB, DOTr,
          the Provincial Government of Laguna, or the municipalities of Magdalena and Santa Cruz.
        </p>
      </div>
    </div>
  );
}

function Privacy() {
  return (
    <div className="page">
      <PageHeader title="Privacy & data sources" back="more" />
      <div className="page-body prose">
        <h3>What we store</h3>
        <ul>
          <li><b>Account:</b> your email, name and fare type, so you can sign in and keep settings.</li>
          <li><b>Photos (optional):</b> your profile picture, and for drivers a photo of the jeepney. A commuter’s photo isn’t shown to anyone in the app, but like all photos it is stored at a hard-to-guess web link. For approved drivers, riders who tap the jeepney on the map see the driver’s name, profile picture and jeepney photo.</li>
          <li><b>Saved places and trips:</b> the places (like Home or School) and trips you saved. Only you can see them.</li>
          <li><b>Community (optional):</b> tips, tricycle routes, terminals, comments, votes and chat messages you share. Others see only your first name (or “Anonymous commuter” if you choose it), never your email or photo. If you attach your spot to a tip, it is rounded to about 10 m. Chat messages show for 1 hour and are deleted after a day. You can delete what you posted at any time. Reports you send about posts are seen only by the admin, and the person you report isn’t told who reported them.</li>
          <li><b>“I’m waiting here” (optional):</b> the spot where you wait, your direction and how many you are. On-duty drivers see it without your name. It ends after 20 minutes or when you cancel, and is deleted soon after.</li>
          <li><b>Ride reports:</b> what you report, linked to your account so we can follow up.</li>
          <li><b>Drivers only:</b> the jeepney’s location and passenger count during a trip. Only the latest position is kept; it is hidden when the trip ends. Phone, license and franchise numbers are seen only by the admin.</li>
          <li><b>Drivers’ trip status</b> (loading at terminal, break, refueling, breakdown, last trip) is shown to riders during a trip.</li>
          <li><b>Drivers’ earnings log:</b> collected fares, diesel, boundary and other costs you enter. Only you can see it, not your operator or the admin. Trips, km and hours are counted on your phone.</li>
          <li><b>SOS:</b> when a driver presses SOS, the admin sees the driver’s name, plate, phone and location. The emergency contact number is saved on the driver’s phone only.</li>
        </ul>
        <h3>What we don’t do</h3>
        <ul>
          <li>We don’t track or store riders’ locations. When you plan a trip, your start and destination are sent to free OpenStreetMap services to draw walking and tricycle paths (routing.openstreetmap.de, router.project-osrm.org, valhalla1.openstreetmap.de) and to name a spot you tapped (photon.komoot.io). They are not saved by us.</li>
          <li>Place search first looks in the list of streets, barangays and places stored in the app (nothing is sent). Only when it finds little is what you typed sent to the free OpenStreetMap search service Photon (photon.komoot.io).</li>
          <li>The weather on the map comes from Open-Meteo (api.open-meteo.com); only the route’s area (not your location) is sent. It is off with Data saver.</li>
          <li>Questions you type in <b>Ask AI</b> go to Google Gemini to be answered. If your map shows a trip, its start and destination go to our own server to plan routes, but are not sent to Gemini. Don’t type personal details in the chat.</li>
          <li>We don’t sell your data or show ads.</li>
        </ul>
        <h3>Deleting your data</h3>
        <p>More → Account & data → Delete account removes your account, profile, photos, saved places and trips, community tips, comments, chat messages, votes, and routes or terminals still waiting for review. Approved routes and terminals stay in the app without your name, so other commuters can still use them. You can also remove a photo there at any time.</p>
        <h3>Data sources</h3>
        <ul>
          <li>Map data © OpenStreetMap contributors, map tiles by OpenFreeMap.</li>
          <li>Fares estimated from the LTFRB jeepney fare matrix.</li>
          <li>Route traced from the project team’s description of the actual jeepney route.</li>
          <li>Place search by Photon (komoot), using OpenStreetMap data.</li>
          <li>Landmarks, streets, barangays and places © OpenStreetMap contributors.</li>
          <li>Tricycle routes and terminals in Community are added by commuters and checked by the admin.</li>
          <li>Weather by Open-Meteo.com.</li>
          <li>Tricycle fares are rough estimates; each town sets its own.</li>
        </ul>
        <p className="fineprint">Services used: Supabase (accounts, database and photo storage), FOSSGIS OpenStreetMap routing and OSRM (walking and road directions), Photon by komoot (place search), Google Gemini (Ask AI), Vercel (website).</p>
      </div>
    </div>
  );
}
