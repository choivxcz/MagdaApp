import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Segmented, Avatar, Skeleton } from '../components/ui.jsx';
import { photoUrl } from '../lib/photos.js';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { adminListDrivers, adminReviewDriver, adminListReports, adminSetReportStatus } from '../lib/account.js';
import { fetchTips, adminSetTipStatus, deleteTip } from '../lib/community.js';
import { adminListSos, adminResolveSos, mapsLink } from '../lib/driverData.js';
import { TipCard } from './CommunityScreen.jsx';
import {
  adminReviewQueue, adminSetPostStatus, adminListPosts, adminUpdatePost, adminContentReports, adminResolveContent, adminBanUser, adminListBanned,
  VEHICLES, POST_KINDS, REPORT_REASONS, fareText,
} from '../lib/communityPosts.js';
import AdminMfa, { useAdminAssurance } from '../components/AdminMfa.jsx';
import routeData from '../data/route-magdalena-santa-cruz.json';
import { useAppSettings, adminSetSetting, refreshSettings } from '../lib/settings.js';
import { DIRECTIONS, DIRECTION_KEYS } from '../lib/directions.js';

const DRIVER_FILTERS = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['other', 'Rejected'],
];
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', disabled: 'Turned off' };
const REPORT_LABEL = {
  overpricing: 'Overcharging', harassment: 'Sexual harassment or abuse', reckless: 'Reckless driving', rude: 'Rude driver', other: 'Other',
  feedback: 'Feedback', missing_route: 'Route issue: missing route', wrong_route: 'Route issue: wrong path', route_problem: 'Route issue: other',
};

const when = (d) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function AdminScreen() {
  const { isAdmin, reload: reloadMe } = useAuth();
  const [tab, setTab] = useState('drivers');
  const [assurance, recheck] = useAdminAssurance();

  if (!isAdmin) {
    return (
      <div className="page">
        <PageHeader title="Admin tools" back="more" />
        <div className="page-body"><p className="warn">Only admins can open this page.</p></div>
      </div>
    );
  }

  // Admin powers need a session verified with an authenticator code.
  if (assurance !== 'verified') {
    return (
      <div className="page">
        <PageHeader title="Admin tools" back="more" />
        <div className="page-body">
          <AdminMfa state={assurance} onVerified={recheck} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Admin tools" back="more" />
      <div className="page-body">
        <p className="fineprint mfa-ok"><Icon name="shield" size={14} /> 2-step verification on</p>
        <Segmented value={tab} onChange={setTab} options={[['drivers', 'Drivers'], ['reports', 'Rides'], ['community', 'Community'], ['tips', 'Tips'], ['sos', 'SOS'], ['settings', 'Settings']]} />
        {tab === 'drivers' ? <Drivers onChange={reloadMe} /> : tab === 'reports' ? <Reports /> : tab === 'community' ? <CommunityAdmin /> : tab === 'tips' ? <Tips /> : tab === 'settings' ? <SettingsAdmin /> : <SosAlerts />}
      </div>
    </div>
  );
}

function Drivers({ onChange }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminListDrivers());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function review(d, status) {
    let note = null;
    if (status === 'rejected' || status === 'disabled') {
      note = window.prompt(status === 'rejected' ? 'Reason for not approving (the driver will see this):' : 'Reason for turning off (the driver will see this):', '');
      if (note === null) return;
    } else if (!window.confirm(`Approve ${d.full_name} (${d.plate}) as a driver?`)) {
      return;
    }
    setBusyId(d.user_id);
    try {
      await adminReviewDriver(d.user_id, status, note);
      await load();
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const counts = { pending: 0, approved: 0, other: 0 };
  for (const d of rows ?? []) counts[d.status === 'pending' || d.status === 'approved' ? d.status : 'other']++;
  const shown = (rows ?? []).filter((d) => (filter === 'other' ? d.status === 'rejected' || d.status === 'disabled' : d.status === filter));

  return (
    <>
      <div className="filter-chips">
        {DRIVER_FILTERS.map(([id, label]) => (
          <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
            {label} <span>{counts[id]}</span>
          </button>
        ))}
        <button className="icon-btn small refresh" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>
      {error && <p className="warn">{error}</p>}
      {rows === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <p className="hint center">{filter === 'pending' ? 'No applications waiting. All caught up.' : 'Nobody here.'}</p>
      ) : (
        shown.map((d) => {
          const avatar = photoUrl(d.user_id, 'avatar', d.avatar_v);
          const jeepney = photoUrl(d.user_id, 'jeepney', d.jeepney_v);
          return (
          <div key={d.user_id} className="card admin-card">
            <div className="admin-card-head">
              {avatar ? <a href={avatar} target="_blank" rel="noreferrer"><Avatar url={avatar} name={d.full_name} size={44} /></a> : <Avatar name={d.full_name} size={44} />}
              <div className="admin-card-title">
                <b>{d.full_name}</b>
                <span className="sub">{d.email}</span>
              </div>
              <span className={`status-pill s-${d.status}`}>{STATUS_LABEL[d.status]}</span>
            </div>
            <div className="kv-grid">
              <span><small>Plate</small><b>{d.plate}</b></span>
              <span><small>Seats</small><b>{d.seat_capacity}</b></span>
              <span><small>Phone</small><b>{d.phone || '—'}</b></span>
              <span><small>License no.</small><b>{d.license_no || '—'}</b></span>
              <span><small>Franchise no.</small><b>{d.franchise_no || '—'}</b></span>
              <span><small>Applied</small><b>{when(d.applied_at)}</b></span>
            </div>
            {jeepney ? (
              <a className="admin-jeep-photo" href={jeepney} target="_blank" rel="noreferrer"><img src={jeepney} alt={`Jeepney ${d.plate}`} loading="lazy" /></a>
            ) : (
              <p className="hint">{avatar ? 'No jeepney photo yet.' : 'No photos yet.'}</p>
            )}
            {d.review_note && <p className="hint">Note: “{d.review_note}”</p>}
            <div className="admin-actions">
              {d.status !== 'approved' && (
                <button className="btn primary" disabled={busyId === d.user_id} onClick={() => review(d, 'approved')}>Approve</button>
              )}
              {d.status === 'pending' && (
                <button className="btn" disabled={busyId === d.user_id} onClick={() => review(d, 'rejected')}>Don’t approve</button>
              )}
              {d.status === 'approved' && (
                <button className="btn danger-outline" disabled={busyId === d.user_id} onClick={() => review(d, 'disabled')}>Turn off driver</button>
              )}
            </div>
          </div>
          );
        })
      )}
    </>
  );
}

function Reports() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await adminListReports());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(r, status) {
    try {
      await adminSetReportStatus(r.id, status);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = (rows ?? []).filter((r) => r.status === filter);
  const open = (rows ?? []).filter((r) => r.status === 'open').length;

  return (
    <>
      <div className="filter-chips">
        <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open <span>{open}</span></button>
        <button className={filter === 'resolved' ? 'on' : ''} onClick={() => setFilter('resolved')}>Resolved <span>{(rows?.length ?? 0) - open}</span></button>
        <button className="icon-btn small refresh" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>
      {error && <p className="warn">{error}</p>}
      {rows === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <p className="hint center">{filter === 'open' ? 'No open reports.' : 'No resolved reports yet.'}</p>
      ) : (
        shown.map((r) => (
          <div key={r.id} className="card admin-card">
            <div className="admin-card-head">
              <span className="tile warn-tile"><Icon name="report" size={20} /></span>
              <div className="admin-card-title">
                <b>{REPORT_LABEL[r.category] ?? r.category}</b>
                <span className="sub">{r.plate ? `Plate ${r.plate} · ` : r.vehicle ? `Jeep: ${r.vehicle} · ` : ''}{when(r.created_at)}</span>
                {r.context && <span className="sub">Where: {r.context}</span>}
              </div>
            </div>
            {r.details && <p className="body-text">{r.details}</p>}
            <div className="admin-actions">
              {r.status === 'open'
                ? <button className="btn primary" onClick={() => setStatus(r, 'resolved')}>Mark resolved</button>
                : <button className="btn" onClick={() => setStatus(r, 'open')}>Reopen</button>}
            </div>
          </div>
        ))
      )}
    </>
  );
}

// Community: approve new routes and terminals, handle reported posts,
// comments and chat messages, and ban people who break the rules.
function CommunityAdmin() {
  const [view, setView] = useState('review');
  const [queue, setQueue] = useState(null);
  const [reports, setReports] = useState(null);
  const [banned, setBanned] = useState(null);
  const [approved, setApproved] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});

  const load = useCallback(async () => {
    try {
      const [q, r, b, a] = await Promise.all([adminReviewQueue(), adminContentReports(), adminListBanned(), adminListPosts('approved')]);
      setQueue(q); setReports(r); setBanned(b); setApproved(a); setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { try { await fn(); await load(); } catch (e) { setError(e.message); } };
  const mapLink = (p) => mapsLink(p.point ?? p.path?.[0]);

  return (
    <>
      <div className="filter-chips">
        <button className={view === 'review' ? 'on' : ''} onClick={() => setView('review')}>To review <span>{queue?.length ?? 0}</span></button>
        <button className={view === 'reports' ? 'on' : ''} onClick={() => setView('reports')}>Reported <span>{reports?.length ?? 0}</span></button>
        <button className={view === 'approved' ? 'on' : ''} onClick={() => setView('approved')}>Approved <span>{approved?.length ?? 0}</span></button>
        <button className={view === 'banned' ? 'on' : ''} onClick={() => setView('banned')}>Banned <span>{banned?.length ?? 0}</span></button>
        <button className="icon-btn small refresh" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>
      {error && <p className="warn">{error}</p>}

      {view === 'review' && (queue === null ? <Skeleton rows={3} /> : queue.length === 0 ? <p className="hint center">Nothing waiting for review.</p> : queue.map((p) => (
        <div key={p.id} className="card admin-card">
          <div className="admin-card-head">
            <span className="tile"><Icon name={POST_KINDS[p.kind]?.icon ?? 'pin'} size={20} /></span>
            <div className="admin-card-title">
              <b>{p.name}</b>
              <span className="sub">{POST_KINDS[p.kind]?.label} · {p.vehicles.map((v) => VEHICLES[v]?.label ?? v).join(', ')} · by {p.authorFull}{p.authorDriver ? ' (driver)' : ''} · {when(p.createdAt)}</span>
            </div>
          </div>
          {p.body && <p className="body-text">{p.body}</p>}
          {(fareText(p.fares) || p.hours) && <p className="sub">{[fareText(p.fares), p.hours].filter(Boolean).join(' · ')}</p>}
          <p className="sub">{p.kind === 'local_route' ? `${p.path?.length ?? 0} points drawn · ` : ''}<a href={mapLink(p)} target="_blank" rel="noreferrer">Open the spot in Google Maps</a></p>
          <input className="admin-note" placeholder="Note to the person (shown if not approved)" value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} maxLength={200} />
          <div className="admin-actions">
            <button className="btn primary" onClick={() => act(() => adminSetPostStatus(p.id, 'approved'))}>Approve</button>
            <button className="btn" onClick={() => act(() => adminSetPostStatus(p.id, 'rejected', notes[p.id]))}>Not approved</button>
          </div>
        </div>
      )))}

      {view === 'reports' && (reports === null ? <Skeleton rows={3} /> : reports.length === 0 ? <p className="hint center">No reported content.</p> : reports.map((r) => (
        <div key={`${r.kind}:${r.id}`} className="card admin-card">
          <div className="admin-card-head">
            <span className="tile warn-tile"><Icon name="flag" size={20} /></span>
            <div className="admin-card-title">
              <b>{{ post: 'Post', tip: 'Tip', comment: 'Comment', chat: 'Chat message' }[r.kind]} · {r.count} report{r.count === 1 ? '' : 's'}{r.status === 'hidden' ? ' · hidden now' : ''}</b>
              <span className="sub">By {r.author}{r.authorBanned ? ' (banned)' : ''} · {r.reasons.map((x) => REPORT_REASONS[x] ?? x).join(', ')} · {when(r.lastAt)}</span>
            </div>
          </div>
          <p className="body-text">{r.snippet ?? '(already deleted)'}</p>
          {r.notes.length > 0 && <p className="sub">Notes: {r.notes.join(' · ')}</p>}
          <div className="admin-actions">
            <button className="btn" onClick={() => act(() => adminResolveContent(r.kind, r.id, 'dismiss'))}>It’s fine</button>
            <button className="btn" onClick={() => act(() => adminResolveContent(r.kind, r.id, 'hide'))}>Hide</button>
            <button className="btn danger" onClick={() => window.confirm('Delete it for good?') && act(() => adminResolveContent(r.kind, r.id, 'delete'))}>Delete</button>
            {r.authorId && !r.authorBanned && (
              <button className="btn danger" onClick={() => window.confirm(`Ban ${r.author}? They can no longer post, comment or chat, and everything they posted is hidden.`) && act(() => adminBanUser(r.authorId, true))}>Ban person</button>
            )}
          </div>
        </div>
      )))}

      {view === 'approved' && (approved === null ? <Skeleton rows={3} /> : approved.length === 0 ? <p className="hint center">No approved routes or terminals yet.</p> : approved.map((p) => (
        editing === p.id ? (
          <EditPost key={p.id} post={p} onCancel={() => setEditing(null)} onSave={(v) => act(async () => { await adminUpdatePost(p.id, v); setEditing(null); })} />
        ) : (
          <div key={p.id} className="card admin-card">
            <div className="admin-card-head">
              <span className="tile"><Icon name={POST_KINDS[p.kind]?.icon ?? 'pin'} size={20} /></span>
              <div className="admin-card-title">
                <b>{p.name}</b>
                <span className="sub">{p.vehicles.map((v) => VEHICLES[v]?.label ?? v).join(', ')}{fareText(p.fares) ? ` · ${fareText(p.fares)}` : ''}{p.hours ? ` · ${p.hours}` : ''}</span>
              </div>
            </div>
            {p.body && <p className="body-text">{p.body}</p>}
            <div className="admin-actions">
              <button className="btn" onClick={() => setEditing(p.id)}><Icon name="pencil" size={15} /> Edit</button>
              <button className="btn" onClick={() => act(() => adminSetPostStatus(p.id, 'hidden'))}>Hide</button>
            </div>
          </div>
        )
      )))}

      {view === 'banned' && (banned === null ? <Skeleton rows={2} /> : banned.length === 0 ? <p className="hint center">No one is banned.</p> : (
        <div className="menu-card">
          {banned.map((b) => (
            <div key={b.id} className="menu-row">
              <span className="menu-text"><span className="menu-title">{b.name}</span><span className="menu-sub">Banned {when(b.since)}</span></span>
              <button className="btn small" onClick={() => act(() => adminBanUser(b.id, false))}>Unban</button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// Fix the name, rides, fares or hours of an approved route or terminal.
function EditPost({ post, onSave, onCancel }) {
  const [v, setV] = useState({
    name: post.name, note: post.body ?? '', vehicles: post.vehicles, hours: post.hours ?? '',
    fares: { default: post.fares.default ?? '', solo: post.fares.solo ?? '', shared: post.fares.shared ?? '' },
  });
  const num = (x) => (x === '' || x == null ? null : Number.isFinite(+x) ? Math.round(+x * 100) / 100 : null);
  const toggle = (k) => setV({ ...v, vehicles: v.vehicles.includes(k) ? v.vehicles.filter((x) => x !== k) : [...v.vehicles, k].slice(0, 4) });
  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); if (v.name.trim().length >= 3 && v.vehicles.length) onSave({ ...v, fares: { default: num(v.fares.default), solo: num(v.fares.solo), shared: num(v.fares.shared) } }); }}>
      <label className="field"><span className="label">Name</span><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <div className="chip-wrap">
        {Object.entries(VEHICLES).map(([k, x]) => <button type="button" key={k} className={`chip small ${v.vehicles.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)}>{x.label}</button>)}
      </div>
      <div className="fare-inputs">
        {[['default', 'Usual'], ['solo', 'Solo'], ['shared', 'Each, shared']].map(([k, label]) => (
          <label key={k}><small>{label} ₱</small><input inputMode="decimal" value={v.fares[k]} onChange={(e) => setV({ ...v, fares: { ...v.fares, [k]: e.target.value } })} /></label>
        ))}
      </div>
      <label className="field"><span className="label">Hours</span><input value={v.hours} maxLength={80} onChange={(e) => setV({ ...v, hours: e.target.value })} /></label>
      <label className="field"><span className="label">Notes</span><textarea rows={3} value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
      <div className="admin-actions"><button className="btn primary">Save</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

// First / last trip times and contact details shown in the app.
function SettingsAdmin() {
  const settings = useAppSettings();
  useEffect(() => { refreshSettings(); }, []);
  return <SettingsForm key={JSON.stringify(settings)} settings={settings} />;
}

function SettingsForm({ settings }) {
  const [hours, setHours] = useState(() => {
    const h = settings.service_hours ?? {};
    return Object.fromEntries([...DIRECTION_KEYS.map((d) => [d, { first: h[d]?.first ?? '', last: h[d]?.last ?? '' }]), ['note', h.note ?? '']]);
  });
  const [contact, setContact] = useState({ email: '', phone: '', facebook: '', donate: '', ...(settings.contact ?? {}) });
  const [msg, setMsg] = useState(null);

  async function save(key, value) {
    setMsg(null);
    try {
      await adminSetSetting(key, value);
      setMsg({ kind: 'ok', text: 'Saved. Phones get it within 12 hours (right away after reopening the app).' });
    } catch (e) {
      setMsg({ kind: 'warn', text: e.message });
    }
  }
  const cleanHours = () => Object.fromEntries(Object.entries(hours).flatMap(([k, val]) => (k === 'note' ? (val.trim() ? [[k, val.trim()]] : []) : val.first && val.last ? [[k, val]] : [])));
  const cleanContact = () => Object.fromEntries(Object.entries(contact).map(([k, x]) => [k, String(x).trim()]).filter(([, x]) => x));

  return (
    <>
      {msg && <p className={msg.kind}>{msg.text}</p>}
      <form className="card form" onSubmit={(e) => { e.preventDefault(); save('service_hours', cleanHours()); }}>
        <b>Usual first and last trips</b>
        <p className="fineprint">Shown to riders, with a warning near or after the last trip. Leave empty if you don’t know.</p>
        {DIRECTION_KEYS.map((d) => (
          <div key={d} className="fare-inputs two">
            <span className="label">{DIRECTIONS[d].label}</span>
            <label><small>First trip</small><input type="time" value={hours[d].first} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], first: e.target.value } })} /></label>
            <label><small>Last trip</small><input type="time" value={hours[d].last} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], last: e.target.value } })} /></label>
          </div>
        ))}
        <label className="field"><span className="label">Note (optional)</span><input value={hours.note} maxLength={200} onChange={(e) => setHours({ ...hours, note: e.target.value })} placeholder="e.g. Fewer trips on Sundays and holidays" /></label>
        <button className="btn primary">Save trip times</button>
      </form>
      <form className="card form" onSubmit={(e) => { e.preventDefault(); save('contact', cleanContact()); }}>
        <b>Contact & support</b>
        <p className="fineprint">Shown in More → Contact & feedback. Use a team email or page, not a personal one, if you can.</p>
        <label className="field"><span className="label">Email</span><input type="email" value={contact.email} maxLength={200} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
        <label className="field"><span className="label">Phone (call or text)</span><input value={contact.phone} maxLength={200} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
        <label className="field"><span className="label">Facebook page link</span><input value={contact.facebook} maxLength={200} placeholder="https://facebook.com/…" onChange={(e) => setContact({ ...contact, facebook: e.target.value })} /></label>
        <label className="field"><span className="label">Donations (e.g. GCash number and name)</span><input value={contact.donate} maxLength={200} onChange={(e) => setContact({ ...contact, donate: e.target.value })} /></label>
        <button className="btn primary">Save contact details</button>
      </form>
    </>
  );
}

// Community tips, including hidden ones, so admins can hide wrong or abusive tips.
function Tips() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('visible');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await fetchTips(routeData.id, { includeHidden: true }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function hide(t) {
    try {
      await adminSetTipStatus(t.id, t.status === 'hidden' ? 'visible' : 'hidden');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(t) {
    if (!window.confirm('Delete this tip for good?')) return;
    try {
      await deleteTip(t.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = (rows ?? []).filter((t) => t.status === filter);
  const hidden = (rows ?? []).filter((t) => t.status === 'hidden').length;

  return (
    <>
      <div className="filter-chips">
        <button className={filter === 'visible' ? 'on' : ''} onClick={() => setFilter('visible')}>Visible <span>{(rows?.length ?? 0) - hidden}</span></button>
        <button className={filter === 'hidden' ? 'on' : ''} onClick={() => setFilter('hidden')}>Hidden <span>{hidden}</span></button>
        <button className="icon-btn small refresh" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>
      {error && <p className="warn">{error}</p>}
      {rows === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <p className="hint center">{filter === 'visible' ? 'No tips yet.' : 'No hidden tips.'}</p>
      ) : (
        <div className="tip-list">
          {shown.map((t) => <TipCard key={t.id} tip={t} route={routeData} user={null} isAdmin onVote={() => {}} onDelete={remove} onHide={hide} />)}
        </div>
      )}
    </>
  );
}

// Emergency alerts from drivers (SOS button on the Drive tab). Checked
// every 20 seconds while this page is open.
function SosAlerts() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await adminListSos());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  async function setStatus(a, status) {
    try {
      await adminResolveSos(a.id, status);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = (rows ?? []).filter((a) => a.status === filter);
  const open = (rows ?? []).filter((a) => a.status === 'open').length;

  return (
    <>
      <div className="filter-chips">
        <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open <span>{open}</span></button>
        <button className={filter === 'resolved' ? 'on' : ''} onClick={() => setFilter('resolved')}>Resolved <span>{(rows?.length ?? 0) - open}</span></button>
        <button className="icon-btn small refresh" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>
      {error && <p className="warn">{error}</p>}
      {rows === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <p className="hint center">{filter === 'open' ? 'No open SOS alerts.' : 'No resolved alerts yet.'}</p>
      ) : (
        shown.map((a) => {
          const point = a.lat != null && a.lng != null ? [a.lng, a.lat] : null;
          return (
            <div key={a.id} className={`card admin-card ${a.status === 'open' ? 'sos-alert' : ''}`}>
              <div className="admin-card-head">
                <span className="tile sos-tile">SOS</span>
                <div className="admin-card-title">
                  <b>{a.full_name ?? 'Driver'} · {a.plate ?? 'no plate'}</b>
                  <span className="sub">{when(a.created_at)}{a.resolved_at ? ` · resolved ${when(a.resolved_at)}` : ''}</span>
                </div>
              </div>
              <div className="admin-actions">
                {a.phone && <a className="btn primary" href={`tel:${a.phone}`}><Icon name="phone" size={16} /> Call {a.phone}</a>}
                {point ? <a className="btn" href={mapsLink(point)} target="_blank" rel="noreferrer"><Icon name="pin" size={16} /> Location</a> : <span className="hint">No location sent.</span>}
                {a.status === 'open'
                  ? <button className="btn" onClick={() => setStatus(a, 'resolved')}>Mark resolved</button>
                  : <button className="btn" onClick={() => setStatus(a, 'open')}>Reopen</button>}
              </div>
            </div>
          );
        })
      )}
      <p className="fineprint">If a driver is in danger, call 911 first.</p>
    </>
  );
}
