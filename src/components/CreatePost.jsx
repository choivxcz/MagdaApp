// "Know a route that's not on the map?" Add a tricycle / e-trike route,
// mark a terminal, or share a tip. Routes and terminals are checked by an
// admin before everyone sees them; tips show right away.
import { useState } from 'react';
import Icon from './Icon.jsx';
import PickMap from './PickMap.jsx';
import { haptic } from '../lib/haptics.js';
import { postTip, TIP_CATEGORIES } from '../lib/community.js';
import { createPost, VEHICLES, POST_KINDS } from '../lib/communityPosts.js';
import { gpsErrorText } from '../lib/gps.js';
import { t } from '../lib/i18n.js';

const LOCAL_VEHICLES = ['tricycle', 'etrike', 'pedicab', 'habal', 'jeepney', 'van', 'bus'];
const fare = (s) => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
};

function TipForm({ route, onDone, onCancel }) {
  const [category, setCategory] = useState('boarding');
  const [body, setBody] = useState('');
  const [stopId, setStopId] = useState('');
  const [point, setPoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (body.trim().length < 5) return setMsg(t("Please write a little more (at least 5 letters)."));
    setBusy(true);
    setMsg('');
    try {
      await postTip({ routeId: route.id, category, body: body.trim(), stopId, point });
      haptic.success();
      onDone('Thanks! Your tip is now visible to other commuters.');
    } catch (err) {
      setMsg(`Couldn’t share: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function addLocation() {
    if (!navigator.geolocation) return setMsg(t("GPS is not available on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => setPoint([p.coords.longitude, p.coords.latitude]),
      (err) => setMsg(gpsErrorText(err)),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <form className="card form" onSubmit={submit}>
      <span className="label">{t("What kind of tip?")}</span>
      <div className="choice-list">
        {Object.entries(TIP_CATEGORIES).map(([id, c]) => (
          <button type="button" key={id} className={`choice ${category === id ? 'on' : ''}`} onClick={() => setCategory(id)}>
            <span className="radio" />
            <span><b>{c.label}</b>{c.hint && <small>{c.hint}</small>}</span>
          </button>
        ))}
      </div>
      <label className="field"><span className="label">{t("Your tip")}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 280))} rows={4} maxLength={280}
          placeholder={t("e.g. Jeepneys to Sta. Cruz stop in front of the 7-Eleven, not at the waiting shed.")} />
        <span className="fineprint">{body.length}{t("/280 · Don’t include names, phone numbers or plate numbers. Use Report a ride for complaints.")}</span>
      </label>
      <label className="field"><span className="label">{t("Near a stop (optional)")}</span>
        <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
          <option value="">{t("No particular stop")}</option>
          {route.stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="row-between">
        <span className="sub">{point ? t("Your current spot will be attached.") : t("Attach where you are now (optional)")}</span>
        {point
          ? <button type="button" className="link-btn small" onClick={() => setPoint(null)}>{t("Remove")}</button>
          : <button type="button" className="btn small" onClick={addLocation}><Icon name="locate" size={15} />{' '}{t("Add my spot")}</button>}
      </div>
      {msg && <p className="warn small">{msg}</p>}
      <div className="row-between">
        <button type="button" className="btn" onClick={onCancel}>{t("Cancel")}</button>
        <button className="btn primary" disabled={busy}>{busy ? t("Sharing…") : t("Share tip")}</button>
      </div>
    </form>
  );
}

function PlaceForm({ route, kind, onDone, onCancel }) {
  const isRoute = kind === 'local_route';
  const [name, setName] = useState('');
  const [vehicles, setVehicles] = useState(['tricycle']);
  const [fares, setFares] = useState({ default: '', solo: '', shared: '' });
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [geo, setGeo] = useState(isRoute ? [] : null);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const toggle = (v) => setVehicles((list) => (list.includes(v) ? list.filter((x) => x !== v) : list.length >= 4 ? list : [...list, v]));

  async function submit(e) {
    e.preventDefault();
    if (name.trim().length < 3) return setMsg(isRoute ? t("Name the route, e.g. “Poblacion – Brgy. Bucal”.") : t("Name the terminal, e.g. “Bucal TODA terminal”."));
    if (!vehicles.length) return setMsg(t("Choose at least one kind of ride."));
    if (isRoute ? geo.length < 2 : !geo) return setMsg(isRoute ? t("Draw the route on the map: tap along the road from start to end, or Record while riding.") : t("Pin the terminal on the map."));
    setBusy(true);
    setMsg('');
    try {
      await createPost({
        routeId: route.id, kind, name: name.trim(), note: note.trim(), vehicles, hours: hours.trim(), anonymous,
        fares: { default: fare(fares.default), solo: fare(fares.solo), shared: fare(fares.shared) },
        point: isRoute ? geo[0] : geo, path: isRoute ? geo : null,
      });
      haptic.success();
      onDone('Thanks! An admin will check it (usually within a day). Until then only you can see it.');
    } catch (err) {
      setMsg(`Couldn’t send: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field"><span className="label">{isRoute ? t("Route name") : t("Terminal name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} maxLength={80}
          placeholder={isRoute ? t("e.g. Poblacion – Brgy. Bucal (tricycle)") : t("e.g. Bucal TODA terminal, beside the chapel")} />
      </label>
      <div className="field">
        <span className="label">{t("Rides here")}</span>
        <div className="chip-wrap">
          {LOCAL_VEHICLES.map((v) => (
            <button type="button" key={v} className={`chip small ${vehicles.includes(v) ? 'on' : ''}`} onClick={() => toggle(v)} aria-pressed={vehicles.includes(v)}>
              <Icon name={VEHICLES[v].icon} size={14} /> {VEHICLES[v].label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{isRoute ? t("Draw the route") : t("Where is it?")}</span>
        <PickMap route={route} mode={isRoute ? 'path' : 'point'} value={geo} onChange={setGeo} />
      </div>
      <div className="field">
        <span className="label">{t("Fare (optional, in pesos)")}</span>
        <div className="fare-inputs">
          <label><small>{t("Usual")}</small><input inputMode="decimal" value={fares.default} onChange={(e) => setFares({ ...fares, default: e.target.value })} placeholder="20" /></label>
          <label><small>{t("Solo / special")}</small><input inputMode="decimal" value={fares.solo} onChange={(e) => setFares({ ...fares, solo: e.target.value })} placeholder="40" /></label>
          <label><small>{t("Each, if shared")}</small><input inputMode="decimal" value={fares.shared} onChange={(e) => setFares({ ...fares, shared: e.target.value })} placeholder="10" /></label>
        </div>
      </div>
      <label className="field"><span className="label">{t("Hours (optional)")}</span>
        <input value={hours} onChange={(e) => setHours(e.target.value.slice(0, 80))} maxLength={80} placeholder={t("e.g. 5 AM – 8 PM, few after 6 PM")} />
      </label>
      <label className="field"><span className="label">{t("Notes (optional)")}</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} maxLength={500}
          placeholder={isRoute ? t("Where it starts and ends, landmarks it passes…") : t("How to find it, which places it goes to…")} />
        <span className="fineprint">{t("Don’t include names, phone numbers or plate numbers.")}</span>
      </label>
      <label className="switch-label"><span>{t("Post as “Anonymous commuter”")}</span>
        <input type="checkbox" className="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
      </label>
      {msg && <p className="warn small">{msg}</p>}
      <div className="row-between">
        <button type="button" className="btn" onClick={onCancel}>{t("Cancel")}</button>
        <button className="btn primary" disabled={busy}>{busy ? t("Sending…") : t("Send for review")}</button>
      </div>
    </form>
  );
}

export default function CreatePost({ route, onDone, onCancel, initialKind = null }) {
  const [kind, setKind] = useState(initialKind);
  if (!kind) {
    return (
      <div className="card">
        <div className="row-between"><b>{t("What can you share?")}</b><button type="button" className="icon-btn small" onClick={onCancel} aria-label={t("Close")}><Icon name="close" size={16} /></button></div>
        <div className="create-kinds">
          {Object.entries(POST_KINDS).map(([k, p]) => (
            <button type="button" key={k} className="create-kind" onClick={() => setKind(k)}>
              <span className={`post-kind ${k}`}><Icon name={p.icon} size={20} /></span>
              <span><b>{p.what}</b><small>{p.hint}</small></span>
              <Icon name="chevron" size={16} className="menu-chevron" />
            </button>
          ))}
        </div>
      </div>
    );
  }
  const back = () => (initialKind ? onCancel() : setKind(null));
  return (
    <>
      <button type="button" className="link-btn small align-start" onClick={back}><Icon name="back" size={14} /> {POST_KINDS[kind].what}</button>
      {kind === 'tip'
        ? <TipForm route={route} onDone={onDone} onCancel={back} />
        : <PlaceForm route={route} kind={kind} onDone={onDone} onCancel={back} />}
    </>
  );
}
