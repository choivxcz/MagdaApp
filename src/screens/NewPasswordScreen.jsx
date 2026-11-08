import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { friendlyAuthError } from '../lib/account.js';
import { Logo } from '../components/Icon.jsx';

// Shown after tapping a "reset password" email link.
export default function NewPasswordScreen() {
  const { finishRecovery, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords don’t match.');
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
        <h1>Set a new password</h1>
        {user?.email && <p>{user.email}</p>}
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label>New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
        </label>
        <label>Type it again
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password" />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
