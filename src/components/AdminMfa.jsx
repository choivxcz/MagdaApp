// 2-step verification for admins. Admin powers only work in a session
// verified with a 6-digit code from an authenticator app (Google
// Authenticator, Microsoft Authenticator, Authy...), so a stolen password
// alone can't approve drivers or read reports. The database checks this too
// (is_admin() needs "aal2"); this screen just gets the admin there.
import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { supabase } from '../lib/supabase.js';
import { Skeleton } from './ui.jsx';

// 'checking' | 'verified' | 'needs-code' | 'needs-setup'
export function useAdminAssurance() {
  const [state, setState] = useState('checking');
  const check = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) { setState('needs-setup'); return; }
    if (data.currentLevel === 'aal2') setState('verified');
    else if (data.nextLevel === 'aal2') setState('needs-code');
    else setState('needs-setup');
  }, []);
  useEffect(() => { check(); }, [check]);
  return [state, check];
}

const cleanCode = (v) => v.replace(/\D/g, '').slice(0, 6);

export default function AdminMfa({ state, onVerified }) {
  const [code, setCode] = useState('');
  const [enroll, setEnroll] = useState(null); // { id, qr, secret }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify(factorId) {
    setBusy(true);
    setError('');
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (e) { setError(/invalid|expired/i.test(e.message) ? 'Wrong or expired code. Check the time on your phone and try the newest code.' : e.message); setCode(''); return; }
    onVerified();
  }

  async function submitCode(e) {
    e.preventDefault();
    if (enroll) return verify(enroll.id);
    const { data, error: e2 } = await supabase.auth.mfa.listFactors();
    if (e2) return setError(e2.message);
    const factor = data.totp.find((f) => f.status === 'verified');
    if (!factor) return setError('No authenticator found. Set one up below.');
    return verify(factor.id);
  }

  async function startSetup() {
    setBusy(true);
    setError('');
    // Remove half-finished setups first (Supabase allows one name per factor).
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Sakay Laguna admin ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (e) return setError(e.message);
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  if (state === 'checking') return <Skeleton rows={2} />;

  return (
    <div className="card form mfa-card">
      <div className="mfa-head">
        <span className="mfa-icon"><Icon name="shield" size={24} /></span>
        <div>
          <b>{state === 'needs-code' ? 'Enter your verification code' : 'Turn on 2-step verification'}</b>
          <span className="sub">
            {state === 'needs-code'
              ? 'Open your authenticator app and type the 6-digit code for Sakay Laguna.'
              : 'Admin tools need a code from an authenticator app, so a stolen password alone can’t be used.'}
          </span>
        </div>
      </div>

      {state === 'needs-setup' && !enroll && (
        <>
          <ol className="mfa-steps">
            <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or Authy).</li>
            <li>Tap the button below and scan the QR code with that app.</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          <button className="btn primary wide" onClick={startSetup} disabled={busy}>{busy ? 'Preparing…' : 'Set up 2-step verification'}</button>
        </>
      )}

      {enroll && (
        <div className="mfa-qr">
          <img src={enroll.qr} alt="QR code for your authenticator app" width="200" height="200" />
          <span className="sub">Can’t scan? Enter this key in the app:</span>
          <code className="mfa-secret">{enroll.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        </div>
      )}

      {(state === 'needs-code' || enroll) && (
        <form className="mfa-form" onSubmit={submitCode}>
          <input
            className="mfa-code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} inputMode="numeric"
            autoComplete="one-time-code" placeholder="123456" aria-label="6-digit code" autoFocus
          />
          <button className="btn primary wide" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
        </form>
      )}
      {error && <p className="warn">{error}</p>}
      <p className="fineprint">
        Lost your phone? A developer can reset your 2-step verification with <code>npm run admin:mfa-reset</code>.
      </p>
    </div>
  );
}
