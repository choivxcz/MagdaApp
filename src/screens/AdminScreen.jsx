import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Segmented, Avatar } from '../components/ui.jsx';
import { photoUrl } from '../lib/photos.js';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { adminListDrivers, adminReviewDriver, adminListReports, adminSetReportStatus } from '../lib/account.js';
import { fetchTips, adminSetTipStatus, deleteTip } from '../lib/community.js';
import { adminListSos, adminResolveSos, mapsLink } from '../lib/driverData.js';
import { TipCard } from './CommunityScreen.jsx';
import routeData from '../data/route-magdalena-santa-cruz.json';

const DRIVER_FILTERS = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['other', 'Rejected'],
];
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', disabled: 'Turned off' };
const REPORT_LABEL = { overpricing: 'Overpricing', harassment: 'Harassment', reckless: 'Reckless driving', other: 'Other' };

const when = (d) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function AdminScreen() {
  const { isAdmin, reload: reloadMe } = useAuth();
  const [tab, setTab] = useState('drivers');

  if (!isAdmin) {
    return (
      <div className="page">
        <PageHeader title="Admin tools" back="more" />
        <div className="page-body"><p className="warn">Only admins can open this page.</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Admin tools" back="more" />
      <div className="page-body">
        <Segmented value={tab} onChange={setTab} options={[['drivers', 'Drivers'], ['reports', 'Reports'], ['tips', 'Tips'], ['sos', 'SOS']]} />
        {tab === 'drivers' ? <Drivers onChange={reloadMe} /> : tab === 'reports' ? <Reports /> : tab === 'tips' ? <Tips /> : <SosAlerts />}
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
        <p className="hint">Loading…</p>
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
        <p className="hint">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="hint center">{filter === 'open' ? 'No open reports.' : 'No resolved reports yet.'}</p>
      ) : (
        shown.map((r) => (
          <div key={r.id} className="card admin-card">
            <div className="admin-card-head">
              <span className="tile warn-tile"><Icon name="report" size={20} /></span>
              <div className="admin-card-title">
                <b>{REPORT_LABEL[r.category]}</b>
                <span className="sub">{r.plate ? `Plate ${r.plate} · ` : ''}{when(r.created_at)}</span>
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
        <p className="hint">Loading…</p>
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
        <p className="hint">Loading…</p>
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
