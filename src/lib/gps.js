// Plain-language reasons the phone couldn't give us a location.
export function gpsErrorText(e) {
  // Browsers only share location with https:// pages (and localhost).
  // Happens when testing `npm run dev` on a phone via http://192.168…
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Location only works on a secure (https://) address. Use https://sakay-laguna.vercel.app, or start the test server with "npm run dev:https".';
  }
  if (e?.code === 1) return 'Location permission is off. Allow location for this app/site in your phone or browser settings.';
  if (e?.code === 2) return 'Your location isn’t available right now. Turn on Location/GPS and try again.';
  if (e?.code === 3) return 'Finding your location took too long. Try again, ideally outdoors or near a window.';
  return `Couldn’t get your location${e?.message ? ` (${e.message})` : ''}.`;
}
