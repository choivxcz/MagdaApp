// Emergency help for drivers: call 911, text an emergency contact with the
// jeepney's location, and alert the app admin (after a 5-second countdown
// that can be cancelled, in case the button was pressed by mistake).
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { sendSos, mapsLink } from '../lib/driverData.js';
import { isDemo } from '../lib/supabase.js';
import { t } from '../lib/i18n.js';

const COUNTDOWN_S = 5;

export default function SosSheet({ driver, point, onClose }) {
  const prefs = usePrefs();
  const [left, setLeft] = useState(isDemo ? null : COUNTDOWN_S); // null = not counting
  const [sent, setSent] = useState(null); // null | 'sending' | 'sent' | error text
  const [editing, setEditing] = useState(!prefs.emergencyContact);
  const [contact, setContact] = useState(prefs.emergencyContact ?? '');
  const pointRef = useRef(point);
  pointRef.current = point;

  useEffect(() => {
    if (left == null) return undefined;
    if (left === 0) {
      setLeft(null);
      setSent('sending');
      sendSos(pointRef.current).then(() => setSent('sent')).catch((e) => setSent(e.message));
      return undefined;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const message = `SOS mula kay ${driver.full_name} (jeep ${driver.plate}), Sakay Laguna. `
    + (point ? `Lokasyon: ${mapsLink(point)}` : 'Hindi alam ang lokasyon.')
    + ` Oras: ${new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
  const number = (prefs.emergencyContact ?? '').replace(/[^\d+]/g, '');

  function saveContact(e) {
    e.preventDefault();
    const n = contact.replace(/[^\d+]/g, '');
    if (n.length < 7) return;
    setPrefs({ emergencyContact: n });
    setEditing(false);
  }

  return (
    <div className="driver-backdrop sos-backdrop" onClick={onClose}>
      <section className="sos-sheet" role="dialog" aria-modal="true" aria-label={t("Emergency")} onClick={(e) => e.stopPropagation()}>
        <header className="sos-head">
          <span className="sos-badge">{t("SOS")}</span>
          <div>
            <b>{t("Emergency")}</b>
            <span className="sub">{point ? t("Your location is ready to share.") : t("Waiting for GPS… you can still call.")}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}><Icon name="close" size={20} /></button>
        </header>

        <a className="sos-big" href="tel:911"><Icon name="phone" size={24} />{' '}{t("Call 911")}</a>

        {editing ? (
          <form className="sos-contact" onSubmit={saveContact}>
            <label className="field"><span className="label">{t("Emergency contact number (family, operator)")}</span>
              <input value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel" placeholder={t("09XX XXX XXXX")} maxLength={20} />
            </label>
            <button className="btn" disabled={contact.replace(/[^\d+]/g, '').length < 7}>{t("Save")}</button>
            <span className="fineprint">{t("Saved on this phone only.")}</span>
          </form>
        ) : (
          <div className="sos-row">
            <a className="btn sos-text" href={`sms:${number}?body=${encodeURIComponent(message)}`}>
              <Icon name="send" size={18} />{' '}{t("Text")}{' '}{number}{' '}{t("my location")}
            </a>
            <button className="link-btn small" onClick={() => setEditing(true)}>{t("Change")}</button>
          </div>
        )}

        <div className={`sos-status ${sent === 'sent' ? 'ok' : ''}`}>
          {isDemo ? (
            <span>{t("Admin alerts work once the database is connected.")}</span>
          ) : left != null ? (
            <>
              <span>{t("Alerting the admin with your location in")}{' '}<b>{left}</b>…</span>
              <button className="btn small" onClick={() => setLeft(null)}>{t("Cancel")}</button>
            </>
          ) : sent === 'sending' ? (
            <span>{t("Sending alert…")}</span>
          ) : sent === 'sent' ? (
            <span><Icon name="check" size={16} />{' '}{t("Admin alerted with your location.")}</span>
          ) : sent ? (
            <span>{t("Couldn’t alert the admin:")}{' '}{sent}</span>
          ) : (
            <>
              <span>{t("Admin not alerted.")}</span>
              <button className="btn small" onClick={() => setLeft(0)}>{t("Alert admin now")}</button>
            </>
          )}
        </div>
        <p className="fineprint">{t("For accidents, crimes and medical emergencies call 911 first. Keep yourself and your passengers safe.")}</p>
      </section>
    </div>
  );
}
