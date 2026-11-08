// Email links (confirm sign-up, reset password) come back to the app here.
//
// On the phone app, Supabase redirects to ph.sakaylaguna.app://auth/callback,
// Android opens the app, and we read the sign-in tokens from that link.
// On the website, Supabase redirects back to the site and supabase-js reads
// the tokens from the address bar by itself.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { supabase } from './supabase.js';

export const isNative = Capacitor.isNativePlatform();

// Where email links should send people. Add both in Supabase:
// Authentication -> URL Configuration -> Redirect URLs.
export const AUTH_REDIRECT_URL = isNative
  ? 'ph.sakaylaguna.app://auth/callback'
  : `${window.location.origin}${window.location.pathname}`;

// Reads tokens or errors from a link like
//   ph.sakaylaguna.app://auth/callback#access_token=...&refresh_token=...&type=signup
//   ph.sakaylaguna.app://auth/callback?error=access_denied&error_description=...
// and signs the user in. Returns { type, error }.
export async function handleAuthLink(url) {
  const params = new URLSearchParams();
  const [beforeHash, hash = ''] = url.split('#');
  const query = beforeHash.split('?')[1] ?? '';
  for (const part of [query, hash]) {
    for (const [k, v] of new URLSearchParams(part)) params.set(k, v);
  }

  if (params.get('error') || params.get('error_description')) {
    const desc = params.get('error_description') || params.get('error');
    const expired = /expired|invalid/i.test(desc);
    return {
      type: params.get('type'),
      error: expired ? 'This link has expired or was already used. If you confirmed before, just sign in.' : desc,
    };
  }

  if (params.get('code')) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.get('code'));
    return { type: params.get('type'), error: error?.message ?? null };
  }

  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    return { type: params.get('type'), error: error?.message ?? null };
  }

  return { type: null, error: null };
}

// Calls onResult({ type, error }) whenever the app is opened by an email link.
export function listenForAuthLinks(onResult) {
  if (!isNative || !supabase) return () => {};
  const handle = App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith('ph.sakaylaguna.app://auth')) return;
    onResult(await handleAuthLink(url));
  });
  return () => {
    handle.then((h) => h.remove());
  };
}
