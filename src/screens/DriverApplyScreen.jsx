import { useEffect, useState } from 'react';
import { PageHeader, navigate } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { applyAsDriver } from '../lib/account.js';
import { setPrefs } from '../lib/prefs.js';
import { t } from '../lib/i18n.js';

const STATUS = {
  pending: { icon: 'clock', title: 'Application pending', text: t("An admin will review your application. You’ll get the Drive tab as soon as you’re approved. Tap Check status below, or reopen the app later."), cls: 'pending' },
  approved: { icon: 'check', title: 'You’re an approved driver', text: t("Open the Drive tab to start a trip."), cls: 'approved' },
  rejected: { icon: 'close', title: 'Application not approved', text: t("You can fix the details below and apply again."), cls: 'rejected' },
  disabled: { icon: 'shield', title: 'Driver access turned off', text: t("Please contact the admin if you think this is a mistake."), cls: 'rejected' },
};

export default function DriverApplyScreen() {
  const { user, profile, driverRecord, photos, reload } = useAuth();
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
        <PageHeader title={t("Become a driver")} back="more" />
        <div className="page-body">
          <div className="empty">
            <span className="empty-icon"><Icon name="drive" size={30} /></span>
            <h3>{t("Sign in to apply")}</h3>
            <p>{t("Create a normal account first, then come back here to apply as a jeepney driver.")}</p>
            <button className="btn primary pill-btn" onClick={() => setPrefs({ guest: false })}>{t("Sign in or create account")}</button>
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
    if (!agree) return setError(t("Please tick the box to agree first."));
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
      <PageHeader title={t("Become a driver")} back="more" />
      <div className="page-body">
        {status && (
          <div className={`status-card ${STATUS[status].cls}`}>
            <span className="status-icon"><Icon name={STATUS[status].icon} size={22} /></span>
            <div>
              <b>{STATUS[status].title}</b>
              <p>{STATUS[status].text}</p>
              {driverRecord.review_note && <p className="note">{t("Admin’s note: “")}{driverRecord.review_note}”</p>}
            </div>
          </div>
        )}

        {status === 'approved' && (
          <button className="btn primary wide" onClick={() => navigate('drive')}>{t("Go to Drive")}</button>
        )}

        {status === 'pending' && !editing && (
          <div className="card">
            <div className="label">{t("Your application")}</div>
            <div className="kv"><span>{t("Name")}</span><b>{driverRecord.full_name}</b></div>
            <div className="kv"><span>{t("Plate")}</span><b>{driverRecord.plate}</b></div>
            <div className="kv"><span>{t("Seats")}</span><b>{driverRecord.seat_capacity}</b></div>
            {driverRecord.phone && <div className="kv"><span>{t("Phone")}</span><b>{driverRecord.phone}</b></div>}
            <div className="kv"><span>{t("Photos")}</span><b>{photos.avatar && photos.jeepney ? t("Added") : photos.avatar || photos.jeepney ? '1 of 2 added' : 'Not yet'}</b></div>
            <div className="row">
              <button className="btn small" onClick={() => reload()}>{t("Check status")}</button>
              <button className="btn small" onClick={() => setEditing(true)}>{t("Edit application")}</button>
              <button className="btn small icon-text" onClick={() => navigate('more/account')}><Icon name="camera" size={15} /> {photos.avatar && photos.jeepney ? t("Change photos") : t("Add photos")}</button>
            </div>
            {!(photos.avatar && photos.jeepney) && <p className="hint">{t("Add your profile picture and a photo of your jeepney. It helps the admin check your application, and riders see them when they tap your jeepney.")}</p>}
          </div>
        )}

        {!status && (
          <div className="card intro">
            <b>{t("Drive with Sakay Laguna")}</b>
            <ul>
              <li>{t("Riders see your jeepney on the map and how many seats are free.")}</li>
              <li>{t("Your location is shared only while you’re on a trip.")}</li>
              <li>{t("An admin checks every application to keep riders safe.")}</li>
              <li>{t("After you apply, add your profile picture and a jeepney photo. Riders see them when they tap your jeepney.")}</li>
            </ul>
          </div>
        )}

        {showForm && status !== 'approved' && status !== 'disabled' && (
          <form className="card form" onSubmit={submit}>
            <label className="field">{t("Full name")}
              <input value={form.fullName} onChange={set('fullName')} required maxLength={60} autoComplete="name" />
            </label>
            <div className="field-row">
              <label className="field">{t("Plate number")}
                <input value={form.plate} onChange={set('plate')} required maxLength={20} placeholder={t("e.g. DXY 123")} className="upper" />
              </label>
              <label className="field narrow">{t("Seats")}
                <input type="number" inputMode="numeric" min={1} max={40} value={form.seats} onChange={set('seats')} required />
              </label>
            </div>
            <label className="field"><span>{t("Mobile number")}{' '}<span className="optional">(optional)</span></span>
              <input type="tel" value={form.phone} onChange={set('phone')} maxLength={30} placeholder={t("09XX XXX XXXX")} autoComplete="tel" />
            </label>
            <label className="field"><span>{t("Driver’s license no.")}{' '}<span className="optional">(optional)</span></span>
              <input value={form.licenseNo} onChange={set('licenseNo')} maxLength={40} />
            </label>
            <label className="field"><span>{t("Franchise / case no.")}{' '}<span className="optional">(optional)</span></span>
              <input value={form.franchiseNo} onChange={set('franchiseNo')} maxLength={40} />
            </label>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{t("I agree to share my jeepney’s location and passenger count while I’m on a trip, and that riders can see my name, profile picture and jeepney photo.")}</span>
            </label>
            {error && <p className="warn">{error}</p>}
            <button className="btn primary wide" disabled={busy}>
              {busy ? t("Sending…") : status ? t("Send application again") : t("Send application")}
            </button>
            {editing && <button type="button" className="link-btn" onClick={() => setEditing(false)}>{t("Cancel")}</button>}
          </form>
        )}
      </div>
    </div>
  );
}
