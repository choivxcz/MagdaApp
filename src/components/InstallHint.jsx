// One-time tip for iPhone Safari users: add the website to the home screen
// so it opens full-screen like an app.
import { Capacitor } from '@capacitor/core';
import Icon from './Icon.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.navigator.standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches;

export const showInstallHint = isIOS && !isStandalone && !Capacitor.isNativePlatform();

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

export default function InstallHint() {
  const prefs = usePrefs();
  if (!showInstallHint || prefs.installHintDismissed) return null;
  return (
    <div className="install-hint" role="note">
      <div>
        <b>Add Sakay Laguna to your Home Screen</b>
        <span>Tap <ShareIcon /> <b>Share</b> below, then <b>Add to Home Screen</b>. It opens full-screen like an app.</span>
      </div>
      <button className="icon-btn small" onClick={() => setPrefs({ installHintDismissed: true })} aria-label="Dismiss"><Icon name="close" size={16} /></button>
    </div>
  );
}
