// Must come first: counts the data the app uses (wraps fetch before the
// database client keeps its own copy of it).
import './lib/dataMeter.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Website only: keep the app, map tiles and fonts on the phone after the
// first visit, so they aren't downloaded again (see public/sw.js). The
// Android app already has its files built in.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
