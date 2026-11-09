import { useEffect, useState } from 'react';
import { PageHeader, MenuGroup, MenuRow, Segmented, Avatar, navigate } from '../components/ui.jsx';
import PhotoField from '../components/PhotoField.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { supabase, isDemo } from '../lib/supabase.js';
import { updateProfile, fileReport, listMyReports, deleteMyAccount } from '../lib/account.js';
import { computeFare, peso, FARE_RULES } from '../lib/fare.js';
import { DIRECTIONS, DIRECTION_KEYS } from '../lib/directions.js';

import DriverApplyScreen from './DriverApplyScreen.jsx';
import AdminScreen from './AdminScreen.jsx';

const APP_VERSION = '0.5.0';

export default function MoreScreen({ route, sub }) {
  switch (sub) {
    case 'preferences': return <Preferences />;
    case 'fares': return <FareGuide route={route} />;
    case 'report': return <ReportRide />;
    case 'account': return <Account />;
    case 'about': return <About />;
    case 'privacy': return <Privacy />;
    case 'driver': return <DriverApplyScreen />;
    case 'admin': return <AdminScreen />;
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
            <MenuRow icon="key" title="Admin tools" sub="Approve drivers, review ride reports" onClick={() => navigate('more/admin')} />
          </MenuGroup>
        )}

        <MenuGroup title="Drive with us">
          {driver ? (
            <MenuRow icon="drive" title="Driver mode" sub={`${driver.plate} · ${driver.seat_capacity} seats`} onClick={() => navigate('drive')} />
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
        </MenuGroup>

        <MenuGroup title="Commute tools">
          <MenuRow icon="fare" title="Fare guide & calculator" sub="Fares between every stop" onClick={() => navigate('more/fares')} />
          <MenuRow icon="report" title="Report a ride" sub="Overpricing, harassment, reckless driving" onClick={() => navigate('more/report')} />
          <MenuRow icon="phone" title="Emergency hotline" sub="Call 911 for police, fire or medical help" href="tel:911" />
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
      </div>
    </div>
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
      </div>
    </div>
  );
}

const CATEGORIES = [
  ['overpricing', 'Overpricing', 'Charged more than the fare'],
  ['harassment', 'Harassment', 'Rude, unsafe or inappropriate behavior'],
  ['reckless', 'Reckless driving', 'Speeding, overloading, unsafe stops'],
  ['other', 'Something else', ''],
];

function ReportRide() {
  const { user } = useAuth();
  const [plate, setPlate] = useState('');
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
    setBusy(true);
    setMsg('');
    try {
      await fileReport({ plate: plate.trim().toUpperCase(), category, details: details.trim() });
      setMsg('Thank you. Your report was sent.');
      setPlate('');
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
            <label className="field"><span className="label">Plate number (if you saw it)</span>
              <input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} placeholder="e.g. MAG 101" />
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
            <label className="field"><span className="label">Details</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={4}
                placeholder="When and where did it happen? What did you see?" />
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
                    <b>{CATEGORIES.find((c) => c[0] === r.category)?.[1]}</b>
                    <span className="sub">{r.plate ? `${r.plate} · ` : ''}{new Date(r.created_at).toLocaleDateString()}</span>
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
    if (!window.confirm('Delete your account? Your profile, photos and saved trips will be permanently deleted. This cannot be undone.')) return;
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
          <MenuRow icon="trash" danger title={busy ? 'Deleting…' : 'Delete account'} sub="Permanently delete your account, profile, photos and saved trips"
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
        <div className="about-logo">🚙</div>
        <h2>Sakay Laguna</h2>
        <p>
          A free commuter app for the Magdalena – Santa Cruz, Laguna jeepney route. See jeepneys live on the map,
          how many seats are free, when the next one reaches you, and how much your fare will be.
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
          <li><b>Photos (optional):</b> your profile picture, and for drivers a photo of the jeepney. A commuter’s photo is only shown to them. For approved drivers, riders who tap the jeepney on the map see the driver’s name, profile picture and jeepney photo.</li>
          <li><b>Saved trips:</b> the stops you saved. Only you can see them.</li>
          <li><b>Ride reports:</b> what you report, linked to your account so we can follow up.</li>
          <li><b>Drivers only:</b> the jeepney’s location and passenger count during a trip. Only the latest position is kept; it is hidden when the trip ends. Phone, license and franchise numbers are seen only by the admin.</li>
        </ul>
        <h3>What we don’t do</h3>
        <ul>
          <li>We don’t track riders’ locations. Your GPS is used on your phone only, to find your pickup point.</li>
          <li>We don’t sell your data or show ads.</li>
        </ul>
        <h3>Deleting your data</h3>
        <p>More → Account & data → Delete account removes your account, profile, photos and saved trips. You can also remove a photo there at any time.</p>
        <h3>Data sources</h3>
        <ul>
          <li>Map data © OpenStreetMap contributors, map tiles by OpenFreeMap.</li>
          <li>Fares estimated from the LTFRB jeepney fare matrix.</li>
          <li>Route traced from the project team’s description of the actual jeepney route.</li>
        </ul>
        <p className="fineprint">Services used: Supabase (accounts, database and photo storage).</p>
      </div>
    </div>
  );
}
