// Phone features for drivers: keep the screen on during a trip, and speak
// announcements so the driver never has to look at the phone.
import { useEffect } from 'react';

// ---- Keep the screen awake ------------------------------------------------
// While a trip runs, the screen must not sleep: on most phones that stops
// GPS in the browser and the jeepney vanishes from riders' maps.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.hidden || cancelled) return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Battery saver or an old browser: the trip still works, the screen may sleep.
      }
    };
    acquire();
    // The lock is dropped when the app goes to the background; take it again on return.
    const onVisible = () => { if (!document.hidden && (!lock || lock.released)) acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

// ---- Voice ----------------------------------------------------------------
// Uses the phone's own text-to-speech (free, works offline on most phones).
const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  if (lang === 'tl') return voices.find((v) => /^(fil|tl)/i.test(v.lang)) ?? null;
  return voices.find((v) => /^en-PH/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

// lang: 'tl' | 'en' | 'off'
export function say(text, lang) {
  if (lang === 'off' || !text || !hasSpeech()) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? (lang === 'tl' ? 'fil-PH' : 'en-PH');
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export const voiceSupported = hasSpeech;

const distTl = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} metro` : `${(m / 1000).toFixed(1)} kilometro`);
const distEn = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} meters` : `${(m / 1000).toFixed(1)} kilometers`);
const people = (n, lang) => (lang === 'tl' ? `${n} na pasahero` : `${n} ${n === 1 ? 'person' : 'people'}`);

// Everything the app says, in Tagalog and English.
export const PHRASES = {
  waitingAhead: (n, stop, m, lang) => (lang === 'tl'
    ? `May ${people(n, lang)} na naghihintay sa ${stop}, ${distTl(m)} sa unahan.`
    : `${people(n, lang)} waiting at ${stop}, ${distEn(m)} ahead.`),
  waitingClose: (n, stop, lang) => (lang === 'tl'
    ? `Malapit na. ${people(n, lang)} ang naghihintay sa ${stop}.`
    : `Almost there. ${people(n, lang)} waiting at ${stop}.`),
  arrived: (terminal, next, lang) => (lang === 'tl'
    ? `Dumating na sa ${terminal}. Balik papuntang ${next}.`
    : `Arrived at ${terminal}. Next trip to ${next}.`),
  lastTripDone: (lang) => (lang === 'tl'
    ? 'Tapos na ang huling biyahe. Pindutin ang End trip kapag hihinto na.'
    : 'Last trip done. Tap End trip when you stop.'),
  backOnTrip: (lang) => (lang === 'tl' ? 'Biyahe na ulit.' : 'Back on trip.'),
  bunching: (plate, m, lang) => (lang === 'tl'
    ? `Malapit ka sa jeep sa unahan, ${plate}, ${distTl(m)} lang.`
    : `You are close to the jeepney ahead, ${plate}, only ${distEn(m)}.`),
  locked: (lang) => (lang === 'tl' ? 'Nagmamaneho. Naka-lock ang screen. Ingat sa biyahe.' : 'Driving. Screen locked. Drive safely.'),
  test: (lang) => (lang === 'tl' ? 'Ganito ang boses ng Sakay Laguna.' : 'This is how Sakay Laguna sounds.'),
};
