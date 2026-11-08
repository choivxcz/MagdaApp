import { useEffect, useState } from 'react';
import { PageHeader, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { applyAsDriver } from '../lib/account.js';
import { setPrefs } from '../lib/prefs.js';

const STATUS = {
  pending: { icon: 'clock', title: 'Application pending', text: 'An admin will review your application. You’ll get the Drive tab as soon as you’re approved. Tap Check status below, or reopen the app later.', cls: 'pending' },
  approved: { icon: 'check', title: 'You’re an approved driver', text: 'Open the Drive tab to start a trip.', cls: 'approved' },
  rejected: { icon: 'close', title: 'Application not approved', text: 'You can fix the details below and apply again.', cls: 'rejected' },
  disabled: { icon: 'shield', title: 'Driver access turned off', text: 'Please contact the admin if you think this is a mistake.', cls: 'rejected' },
};

export default function DriverApplyScreen() {
  const { user, profile, driverRecord, reload } = useAuth();
  const [form, setForm] = useState({ fullName: '', plate: '', seats: '20', phone: '', licenseNo: '', franchiseNo: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  // Fill the form from the earlier application, or from the profile name.
  useEffect(() => {
    setForm((f) => ({
      fullName: driverRecord?.full_name ?? profile?.full_name ?? f.fullName,
      plate: driverRecord?.plate ?? f.plate,
      seats: String(driverRecord?.seat_capacity ?? f.seats),
      phone: driverRecord?.phone ?? f.phone,
      licenseNo: driverRecord?.license_no ?? f.licenseNo,
      franchiseNo: driverRecord?.franchise_no ?? f.franchiseNo,
    }));
  }, [driverRecord, profile]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!user) {
    return (
      <div className="page">
        <PageHeader title="Become a driver" back="more" />
        <div className="page-body">
          <div className="empty">
            <span className="empty-icon"><Icon name="drive" size={30} /></span>
            <h3>Sign in to apply</h3>
            <p>Create a normal account first, then come back here to apply as a jeepney driver.</p>
            <button className="btn primary pill-btn" onClick={() => setPrefs({ guest: false })}>Sign in or create account</button>
          </div>
        </div>
      </div>
    );
  }

  const status = driverRecord?.status;
  const showForm = !status || editing || status === 'rejected';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!agree) return setError('Please agree to share your jeepney’s location during trips.');
    setBusy(true);
    setError('');
    try {
      await applyAsDriver({ ...form, seats: Number(form.seats) });
      await reload();
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Become a driver" back="more" />
      <div className="page-body">
        {status && (
          <div className={`status-card ${STATUS[status].cls}`}>
            <span className="status-icon"><Icon name={STATUS[status].icon} size={22} /></span>
            <div>
              <b>{STATUS[status].title}</b>
              <p>{STATUS[status].text}</p>
              {driverRecord.review_note && <p className="note">Admin’s note: “{driverRecord.review_note}”</p>}
            </div>
          </div>
        )}

        {status === 'approved' && (
          <button className="btn primary wide" onClick={() => navigate('drive')}>Go to Drive</button>
        )}

        {status === 'pending' && !editing && (
          <div className="card">
            <div className="label">Your application</div>
            <div className="kv"><span>Name</span><b>{driverRecord.full_name}</b></div>
            <div className="kv"><span>Plate</span><b>{driverRecord.plate}</b></div>
            <div className="kv"><span>Seats</span><b>{driverRecord.seat_capacity}</b></div>
            {driverRecord.phone && <div className="kv"><span>Phone</span><b>{driverRecord.phone}</b></div>}
            <div className="row">
              <button className="btn small" onClick={() => reload()}>Check status</button>
              <button className="btn small" onClick={() => setEditing(true)}>Edit application</button>
            </div>
          </div>
        )}

        {!status && (
          <div className="card intro">
            <b>Drive with Sakay Laguna</b>
            <ul>
              <li>Riders see your jeepney on the map and how many seats are free.</li>
              <li>Your location is shared only while you’re on a trip.</li>
              <li>An admin checks every application to keep riders safe.</li>
            </ul>
          </div>
        )}

        {showForm && status !== 'approved' && status !== 'disabled' && (
          <form className="card form" onSubmit={submit}>
            <label className="field">Full name
              <input value={form.fullName} onChange={set('fullName')} required maxLength={60} autoComplete="name" />
            </label>
            <div className="field-row">
              <label className="field">Plate number
                <input value={form.plate} onChange={set('plate')} required maxLength={20} placeholder="e.g. DXY 123" className="upper" />
              </label>
              <label className="field narrow">Seats
                <input type="number" inputMode="numeric" min={1} max={40} value={form.seats} onChange={set('seats')} required />
              </label>
            </div>
            <label className="field"><span>Mobile number <span className="optional">(optional)</span></span>
              <input type="tel" value={form.phone} onChange={set('phone')} maxLength={30} placeholder="09XX XXX XXXX" autoComplete="tel" />
            </label>
            <label className="field"><span>Driver’s license no. <span className="optional">(optional)</span></span>
              <input value={form.licenseNo} onChange={set('licenseNo')} maxLength={40} />
            </label>
            <label className="field"><span>Franchise / case no. <span className="optional">(optional)</span></span>
              <input value={form.franchiseNo} onChange={set('franchiseNo')} maxLength={40} />
            </label>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I agree to share my jeepney’s location and passenger count while I’m on a trip.</span>
            </label>
            {error && <p className="warn">{error}</p>}
            <button className="btn primary wide" disabled={busy}>
              {busy ? 'Sending…' : status ? 'Send application again' : 'Send application'}
            </button>
            {editing && <button type="button" className="link-btn" onClick={() => setEditing(false)}>Cancel</button>}
          </form>
        )}
      </div>
    </div>
  );
}
