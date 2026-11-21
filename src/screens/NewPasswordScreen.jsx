import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { friendlyAuthError, passwordProblem } from '../lib/account.js';
import { Logo } from '../components/Icon.jsx';
import { t } from '../lib/i18n.js';

// Shown after tapping a "reset password" email link.
export default function NewPasswordScreen() {
  const { finishRecovery, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError(t("The two passwords don’t match."));
    const weak = passwordProblem(password, user?.email);
    if (weak) return setError(weak);
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(friendlyAuthError(err));
    finishRecovery();
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <Logo size={76} />
        <h1>{t("Set a new password")}</h1>
        {user?.email && <p>{user.email}</p>}
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label>{t("New password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
        <label>{t("Type it again")}
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? t("Saving…") : t("Save new password")}</button>
      </form>
    </div>
  );
}
