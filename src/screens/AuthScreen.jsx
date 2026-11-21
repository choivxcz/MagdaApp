import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { friendlyAuthError, passwordProblem } from '../lib/account.js';
import { AUTH_REDIRECT_URL } from '../lib/authLinks.js';
import { Logo } from '../components/Icon.jsx';
import { t } from '../lib/i18n.js';

export default function AuthScreen() {
  const prefs = usePrefs();
  const [mode, setMode] = useState('signin'); // signin | signup | forgot
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function switchMode(m) {
    setMode(m);
    setError('');
    setNotice('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        setPrefs({ guest: false });
      } else if (mode === 'signup') {
        const weak = passwordProblem(password, email);
        if (weak) throw new Error(weak);
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim(), fare_type: prefs.fareType },
            emailRedirectTo: AUTH_REDIRECT_URL,
          },
        });
        if (err) throw err;
        if (!data.session) {
          setNotice(`We sent a confirmation link to ${email.trim()}. Open it on this phone and the app will sign you in.`);
          setMode('signin');
        }
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: AUTH_REDIRECT_URL });
        if (err) throw err;
        setNotice('If that email has an account, we sent a reset link. Open it on this phone to set a new password.');
        setMode('signin');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <Logo size={76} />
        <h1>{t("Sakay Laguna")}</h1>
        <p>{t("Magdalena ⇄ Santa Cruz jeepneys, live.")}</p>
      </div>

      {mode !== 'forgot' && (
        <div className="segmented auth-tabs" role="tablist">
          <button role="tab" className={mode === 'signin' ? 'on' : ''} onClick={() => switchMode('signin')}>{t("Sign in")}</button>
          <button role="tab" className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>{t("Create account")}</button>
        </div>
      )}

      <form className="auth-form" onSubmit={submit}>
        {mode === 'forgot' && (
          <>
            <h2>{t("Reset password")}</h2>
            <p className="hint">{t("Enter your email and we’ll send you a reset link.")}</p>
          </>
        )}
        {mode === 'signup' && (
          <label>{t("Full name")}
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" />
          </label>
        )}
        <label>{t("Email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        {mode !== 'forgot' && (
          <label>{t("Password")}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : 6} maxLength={72}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>
        )}

        {error && <p className="warn">{error}</p>}
        {notice && <p className="ok">{notice}</p>}

        <button className="btn primary wide" disabled={busy}>
          {busy ? t("Please wait…") : mode === 'signin' ? t("Sign in") : mode === 'signup' ? t("Create account") : t("Send reset link")}
        </button>

        {mode === 'signin' && <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>{t("Forgot password?")}</button>}
        {mode === 'forgot' && <button type="button" className="link-btn" onClick={() => switchMode('signin')}>{t("Back to sign in")}</button>}
        {mode === 'signup' && (
          <p className="fineprint center">{t("By creating an account you agree to use the app responsibly. See More → Privacy for what we store.")}</p>
        )}
      </form>

      <div className="auth-guest">
        <button className="btn wide" onClick={() => setPrefs({ guest: true })}>{t("Continue as guest")}</button>
        <p className="hint center">{t("Guests can see jeepneys, seats and fares. Sign in to save trips and report rides.")}</p>
        <p className="hint center">{t("Jeepney drivers: sign in with the account your operator gave you.")}</p>
      </div>
    </div>
  );
}
