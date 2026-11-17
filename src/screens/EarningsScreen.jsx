// Earnings log for the boundary system: what the driver collected, minus
// diesel, the boundary paid to the operator and other costs = take-home.
// Trips, km and hours come from the Drive tab automatically.
// Private: only the driver sees it (not the operator, not the admin).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { isDemo } from '../lib/supabase.js';
import { listEarnings, saveEarnings, deleteEarnings, net } from '../lib/driverData.js';
import { useDriverDays, dayStats, today as todayDate } from '../lib/driverDay.js';

const php = (n) => `₱${(Math.round(n * 100) / 100).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dayLabel = (d) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
const hours = (min) => `${Math.floor(min / 60)} h ${min % 60} min`;
const EMPTY = { gross: '', fuel: '', boundary: '', other: '', note: '', trips: '', km: '', minutes: '' };

function MoneyField({ label, hint, value, onChange }) {
  return (
    <label className="field money-field">
      <span className="label">{label}{hint && <small> · {hint}</small>}</span>
      <span className="money-input">
        <span>₱</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
      </span>
    </label>
  );
}

export default function EarningsScreen() {
  const { user, driver } = useAuth();
  const prefs = usePrefs();
  const days = useDriverDays(user?.id);
  const [day, setDay] = useState(todayDate());
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listEarnings(31));
    } catch (e) {
      setRows([]);
      setMsg({ kind: 'warn', text: e.message });
    }
  }, []);
  useEffect(() => { if (driver && !isDemo) load(); }, [driver, load]);

  // Fill the form for the chosen day: what was saved, plus the phone's own counts.
  useEffect(() => {
    const saved = rows?.find((r) => r.day === day);
    const auto = dayStats(days, day);
    const str = (n) => (n ? String(n) : '');
    setForm({
      gross: str(saved?.gross),
      fuel: str(saved?.fuel),
      boundary: saved ? str(saved.boundary) : str(prefs.driverBoundary),
      other: str(saved?.other),
      note: saved?.note ?? '',
      trips: String(Math.max(saved?.trips ?? 0, auto.trips)),
      km: (Math.max(saved?.km ?? 0, auto.km)).toFixed(1),
      minutes: String(Math.max(saved?.minutes ?? 0, Math.round(auto.seconds / 60))),
    });
  }, [day, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (v) => Number(v) || 0;
  const entry = { gross: n(form.gross), fuel: n(form.fuel), boundary: n(form.boundary), other: n(form.other) };
  const takeHome = net(entry);
  const perHour = n(form.minutes) >= 30 ? takeHome / (n(form.minutes) / 60) : null;

  const week = useMemo(() => {
    const since = new Date(Date.now() - 6 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const list = (rows ?? []).filter((r) => r.day >= since);
    const total = list.reduce((s, r) => s + net(r), 0);
    return { days: list.length, total, avg: list.length ? total / list.length : 0, fuel: list.reduce((s, r) => s + r.fuel, 0) };
  }, [rows]);

  if (!driver) {
    return (
      <div className="page">
        <PageHeader title="Earnings log" back="more" />
        <div className="page-body"><p className="hint">The earnings log is for approved drivers.</p></div>
      </div>
    );
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await saveEarnings({ day, ...entry, trips: n(form.trips), km: n(form.km), minutes: n(form.minutes), note: form.note });
      if (entry.boundary) setPrefs({ driverBoundary: entry.boundary });
      setMsg({ kind: 'ok', text: `Saved. Take-home for ${dayLabel(day)}: ${php(takeHome)}.` });
      await load();
    } catch (err) {
      setMsg({ kind: 'warn', text: `Couldn’t save: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    if (!window.confirm(`Delete the entry for ${dayLabel(d)}?`)) return;
    try {
      await deleteEarnings(d);
      await load();
    } catch (err) {
      setMsg({ kind: 'warn', text: err.message });
    }
  }

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="page">
      <PageHeader title="Earnings log" back="more" />
      <div className="page-body">
        <p className="body-text muted">Track your take-home under the boundary system. Only you can see this; it isn’t shared with your operator or the admin.</p>
        {isDemo && <p className="hint">The earnings log works once the database is connected.</p>}

        <form className="card form" onSubmit={save}>
          <label className="field"><span className="label">Day</span>
            <input type="date" value={day} max={todayDate()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>

          <div className="auto-stats">
            <span><small>Trips</small><input inputMode="numeric" value={form.trips} onChange={(e) => set('trips')(e.target.value.replace(/\D/g, ''))} aria-label="One-way trips" /></span>
            <span><small>km</small><input inputMode="decimal" value={form.km} onChange={(e) => set('km')(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Kilometers" /></span>
            <span><small>Minutes</small><input inputMode="numeric" value={form.minutes} onChange={(e) => set('minutes')(e.target.value.replace(/\D/g, ''))} aria-label="Minutes on trips" /></span>
          </div>
          <span className="fineprint">Counted by the Drive tab on this phone; you can correct them.</span>

          <MoneyField label="Kita" hint="all fares collected" value={form.gross} onChange={set('gross')} />
          <MoneyField label="Krudo" hint="diesel" value={form.fuel} onChange={set('fuel')} />
          <MoneyField label="Boundary" hint="paid to the operator" value={form.boundary} onChange={set('boundary')} />
          <MoneyField label="Iba pa" hint="dispatcher, carwash, repairs" value={form.other} onChange={set('other')} />
          <label className="field"><span className="label">Note (optional)</span>
            <input value={form.note} onChange={(e) => set('note')(e.target.value)} maxLength={200} placeholder="e.g. traffic sa Pedro Guevarra, maagang uwi" />
          </label>

          <div className={`take-home ${takeHome < 0 ? 'neg' : ''}`}>
            <span>Take-home <small>(kita − krudo − boundary − iba pa)</small></span>
            <b>{php(takeHome)}</b>
            {perHour != null && <small>{php(perHour)} per hour · {hours(n(form.minutes))} on trips</small>}
          </div>
          <button className="btn primary wide" disabled={busy || isDemo}>{busy ? 'Saving…' : 'Save'}</button>
          {msg && <p className={msg.kind === 'ok' ? 'ok' : 'warn'}>{msg.text}</p>}
        </form>

        {rows?.length > 0 && (
          <>
            <div className="section-label"><span>Last 7 days</span><span>{week.days} day{week.days === 1 ? '' : 's'} logged</span></div>
            <div className="card detail-stats week-stats">
              <span><small>Take-home</small><b>{php(week.total)}</b></span>
              <span><small>Per day</small><b>{php(week.avg)}</b></span>
              <span><small>Diesel</small><b>{php(week.fuel)}</b></span>
            </div>

            <div className="section-label"><span>History</span><span>{rows.length}</span></div>
            <div className="menu-card">
              {rows.map((r) => (
                <div key={r.day} className="menu-row saved-row">
                  <button className="saved-main" onClick={() => { setDay(r.day); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <span className={`menu-icon ${net(r) < 0 ? 'danger' : ''}`}><Icon name="fare" size={18} /></span>
                    <span className="menu-text">
                      <span className="menu-title">{dayLabel(r.day)} · {php(net(r))}</span>
                      <span className="menu-sub">Kita {php(r.gross)} · krudo {php(r.fuel)} · boundary {php(r.boundary)}{r.trips ? ` · ${r.trips} trips` : ''}</span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => remove(r.day)} aria-label={`Delete ${dayLabel(r.day)}`}><Icon name="trash" size={18} /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
