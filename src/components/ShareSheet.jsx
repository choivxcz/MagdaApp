// Share a planned trip: to Messenger / SMS (the phone's share menu), or copy
// a link that opens the same trip, a short message, or the steps.
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { tripLink, shareMessage, copyText, canShare, shareToApps } from '../lib/share.js';
import { describeOption, fmtMinutes } from '../lib/planner.js';
import { fareText } from './Journey.jsx';
import { DIRECTIONS } from '../lib/directions.js';
import { landmarks } from '../lib/landmarkData.js';
import { haptic } from '../lib/haptics.js';

export default function ShareSheet({ from, to, option, fareType, onClose }) {
  const [done, setDone] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const link = tripLink(from, to);
  const message = shareMessage(to, option, { minutes: fmtMinutes, fare: fareText(option, fareType) });
  const steps = describeOption(option, {
    fareType,
    dirLabel: (d) => DIRECTIONS[d]?.label.replace(/^To /, 'to ') ?? d,
    toLabel: to.label,
    byLandmark: (p) => landmarks.near(p),
  }).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const full = `${message}\n${steps}\n${link}`;

  async function run(kind) {
    haptic.tap();
    if (kind === 'apps') {
      const r = await shareToApps({ title: `To ${to.label}`, text: `${message}\n${steps}`, url: link });
      if (r === false) setDone((await copyText(full)) ? t("Your phone can’t share here, so the trip was copied instead. Paste it in Messenger or SMS.") : t("Couldn’t share."));
      else if (r) onClose();
      return;
    }
    const text = kind === 'link' ? link : kind === 'message' ? `${message} ${link}` : steps;
    setDone((await copyText(text)) ? t("Copied. Paste it in Messenger, SMS or anywhere.") : t("Couldn’t copy on this phone."));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={t("Share this trip")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{t("Share this trip")}</b>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label={t("Close")}><Icon name="close" size={16} /></button>
        </div>
        <p className="share-preview">{message}</p>
        <div className="menu-card">
          {canShare() && (
            <button className="menu-row" onClick={() => run('apps')}>
              <span className="menu-icon"><Icon name="share" size={20} /></span>
              <span className="menu-text"><span className="menu-title">{t("Share to other apps")}</span><span className="menu-sub">{t("Messenger, SMS, Viber…")}</span></span>
            </button>
          )}
          <button className="menu-row" onClick={() => run('link')}>
            <span className="menu-icon"><Icon name="link" size={20} /></span>
            <span className="menu-text"><span className="menu-title">{t("Copy link")}</span><span className="menu-sub">{t("Opens this trip in Sakay Laguna")}</span></span>
          </button>
          <button className="menu-row" onClick={() => run('message')}>
            <span className="menu-icon"><Icon name="chat" size={20} /></span>
            <span className="menu-text"><span className="menu-title">{t("Copy message")}</span><span className="menu-sub">{t("Short text with the link")}</span></span>
          </button>
          <button className="menu-row" onClick={() => run('steps')}>
            <span className="menu-icon"><Icon name="copy" size={20} /></span>
            <span className="menu-text"><span className="menu-title">{t("Copy route steps")}</span><span className="menu-sub">{t("Walk, ride, get off… in words")}</span></span>
          </button>
        </div>
        {done && <p className="ok small">{done}</p>}
        {from?.kind === 'gps' && <p className="fineprint">{t("Your exact location isn’t shared: the person sets their own start.")}</p>}
      </section>
    </div>
  );
}
