// Who is signed in, their profile, and whether they are an approved driver.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, isDemo } from './supabase.js';
import { fetchProfile, fetchIsAdmin } from './account.js';
import { fetchDriverProfile } from './locations.js';
import { setPrefs } from './prefs.js';
import { isNative, listenForAuthLinks } from './authLinks.js';

const AuthContext = createContext(null);

// What an email link was for, in plain words.
function linkNotice({ type, error }) {
  if (error) return { kind: 'warn', text: error };
  if (type === 'recovery') return null; // handled by the new-password screen
  if (type === 'signup' || type === 'email' || type === 'email_change') {
    return { kind: 'ok', text: 'Email confirmed. You’re signed in.' };
  }
  return type ? { kind: 'ok', text: 'You’re signed in.' } : null;
}

// On the website, read what the email link said before the router replaces it.
function readWebLink() {
  if (isNative || !/access_token|error_description/.test(window.location.hash)) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  const desc = p.get('error_description');
  return {
    type: p.get('type'),
    error: desc ? (/expired|invalid/i.test(desc) ? 'This link has expired or was already used. If you confirmed before, just sign in.' : desc) : null,
  };
}

export function AuthProvider({ children }) {
  // undefined = still checking the saved session
  const [session, setSession] = useState(isDemo ? null : undefined);
  const [profile, setProfile] = useState(null);
  const [driver, setDriver] = useState(null); // approved drivers only
  const [driverRecord, setDriverRecord] = useState(null); // any status: pending, rejected...
  const [isAdmin, setIsAdmin] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (isDemo) return;
    const webLink = readWebLink();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (webLink) {
        if (webLink.type === 'recovery' && !webLink.error) setRecovery(true);
        setNotice(linkNotice(webLink));
        window.history.replaceState(null, '', '#/map');
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    const stopLinks = listenForAuthLinks((result) => {
      if (result.type === 'recovery' && !result.error) setRecovery(true);
      if (!result.error) setPrefs({ guest: false });
      setNotice(linkNotice(result));
    });
    return () => {
      data.subscription.unsubscribe();
      stopLinks();
    };
  }, []);

  const userId = session?.user?.id;

  const reload = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setDriver(null);
      setDriverRecord(null);
      setIsAdmin(false);
      return;
    }
    // A failed check (e.g. weak signal) keeps what we had, so an active
    // trip is never stopped by a network hiccup.
    const [p, d, admin] = await Promise.all([
      fetchProfile(userId).catch(() => undefined),
      fetchDriverProfile(userId).catch(() => undefined),
      fetchIsAdmin(userId).catch(() => undefined),
    ]);
    if (p !== undefined) setProfile(p);
    if (d !== undefined) {
      setDriverRecord(d);
      setDriver(d?.approved ? d : null);
    }
    if (admin !== undefined) setIsAdmin(admin);
    if (p?.fare_type) setPrefs({ fareType: p.fare_type });
  }, [userId]);

  useEffect(() => {
    reload();
    // Re-check when the app comes back on screen, so a newly approved
    // driver sees the Drive tab without signing out.
    const onShow = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reload]);

  const value = {
    loading: session === undefined,
    session,
    user: session?.user ?? null,
    profile,
    driver,
    driverRecord,
    isAdmin,
    reload,
    recovery,
    finishRecovery: () => setRecovery(false),
    notice,
    clearNotice: () => setNotice(null),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
