// Sends a password-reset email to an existing account to test email sending.
// Usage: npm run check:email -- you@gmail.com
import { need } from './env.mjs';

const env = need('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY');
const email = process.argv[2];
if (!email) {
  console.log('Usage: npm run check:email -- you@gmail.com   (must be an existing account)');
  process.exit(1);
}
// Same destination as real reset emails from the app.
const redirect = encodeURIComponent('ph.sakaylaguna.app://auth/callback');
const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/recover?redirect_to=${redirect}`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
const body = await res.json().catch(() => ({}));
if (res.ok) {
  console.log(`✓ Email sent to ${email}. Check the inbox (and Spam).`);
} else if (/rate limit/i.test(body.msg ?? '')) {
  console.log('✗ Hourly email limit reached, or you tested less than a minute ago. Wait and try again.');
} else if (/error sending/i.test(body.msg ?? '')) {
  console.log('✗ Supabase could not send through your email server (Gmail rejected it).');
  console.log('  Check Authentication → Emails → SMTP Settings: app password (no spaces), full Gmail as username and sender, port 465.');
} else {
  console.log(`✗ HTTP ${res.status}: ${body.msg ?? JSON.stringify(body)}`);
}
process.exitCode = res.ok ? 0 : 1;
