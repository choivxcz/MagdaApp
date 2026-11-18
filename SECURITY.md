# Security

How Sakay Laguna protects riders, drivers and admins, and what the people
who run it must do. The GitHub repository is **public**, so this file and
`supabase/schema.sql` are visible to everyone; the protection comes from
the database rules, not from hiding the code.

## Who can see and change what

| Data | Who can read it | Who can change it |
|---|---|---|
| Jeepney position, seats, trip status | Everyone, **only while on a trip** | That driver (approved only) |
| Driver name, plate, photos | Everyone, for approved drivers on the map | Driver (photos), admin (approval) |
| Driver phone, license, franchise | Admin only | Driver (application) |
| Profile, saved places/trips, earnings log | Only the owner | Only the owner |
| "I'm waiting here" spot | On-duty drivers (no name, rounded ~10 m) | Only the owner |
| Ride reports | Owner and admin | Owner (send), admin (resolve) |
| Community tips | Everyone (author's first name only) | Author, admin (hide) |
| SOS alerts | Driver who sent it, admin | Driver (send), admin (resolve) |

All of this is enforced by **Row Level Security** in Supabase
(`supabase/schema.sql`). Every table has it on; the tests in
`tests/security.test.js` fail if a table is added without it.

## Admins

- Admin powers need **2-step verification** (a code from an authenticator
  app). The database itself checks it (`is_admin()` requires an `aal2`
  session), so a stolen admin password is not enough. Set it up in
  **More → Admin tools**.
- Lost the phone with the authenticator? After confirming it's really them,
  a developer runs `npm run admin:mfa-reset -- --email admin@example.com`.
- Add or remove admins only with `npm run admin:add` (needs the database
  password; there is no way to become admin from the app).
- Approving a driver means riders will trust that jeepney: check the
  license and franchise numbers and the photos first.

## Developers: secrets

| Secret | Where it lives | Never put it in |
|---|---|---|
| Supabase **secret key** (`sb_secret_…`) | `.env.local` only | the app, Vercel, git, chat |
| Database password (`SUPABASE_DB_URL`) | `.env.local` only | the app, Vercel, git, chat |
| `GEMINI_API_KEY` | `.env.local`, Vercel environment variables | anything starting with `VITE_` |
| Android signing key (`*.jks`, `key.properties`) | your computer + a safe backup | git |

- The Supabase **publishable** key and URL in `.env.production` are public
  by design (they are inside the app); the database rules protect the data.
- `.gitignore` and `.vercelignore` keep `.env*`, keystores and certificates out.
- **Rotate now if a secret was ever pasted into a chat, screenshot or
  message:** Supabase → Project Settings → API Keys (create a new secret
  key, delete the old one) and → Database → Reset database password; then
  update `.env.local`.
- Database scripts use an encrypted connection. To also verify the
  server's certificate (recommended on public Wi-Fi), download it from
  Supabase → Project Settings → Database → SSL Configuration, save it as
  `supabase-ca.crt` in the project folder and set
  `SUPABASE_DB_CA=./supabase-ca.crt` in `.env.local`.
- `npm run dev` shares the app on your Wi-Fi (`--host`). Don't run it on
  public Wi-Fi.
- `npm audit --omit=dev` should say 0 vulnerabilities (that's the code that
  ships). Warnings in developer tools (Vercel CLI, build tools) don't reach
  users; update them when new versions come out.

## Supabase dashboard settings (check these once)

These live in the dashboard, not in the code:

1. **Authentication → Providers → Email:** "Confirm email" ON; minimum
   password length **8**; (Pro plan) "Prevent use of leaked passwords" ON.
2. **Authentication → Rate Limits:** keep the defaults or lower.
3. **Authentication → Attack Protection:** turn on CAPTCHA (Cloudflare
   Turnstile is free) if fake sign-ups appear.
4. **Authentication → Multi-Factor:** TOTP enabled (it is by default; admins
   need it).
5. **Authentication → URL Configuration:** only the website and
   `ph.sakaylaguna.app://auth/callback` as redirect URLs; no wildcards.
6. **Storage → photos:** public, JPEG only, 2 MB limit (set by `setup:db`).

## Website and AI server

- Security headers (`vercel.json`): a Content Security Policy that only
  allows the app's own scripts and the services it uses, no framing
  (clickjacking), `nosniff`, HSTS, a strict referrer policy, and no camera
  or microphone access.
- `/api/assistant` (Sakay AI) only accepts the real website and the phone
  apps (`ALLOWED_ORIGINS` adds more, e.g. a preview link), limits each
  address to 12 questions a minute and 150 a day, all users together to 240
  a minute, and refuses requests over 64 KB. The Gemini key never leaves the
  server, and riders' locations are used on the server but never sent to
  Gemini.

## Android app

- No cloud backup of app data (`allowBackup="false"`), so sign-in sessions
  aren't copied to backups.
- Email links open the app through `ph.sakaylaguna.app://auth/callback`. A
  custom scheme like this could in theory be claimed by another app on the
  same phone. A stronger option for later is Android App Links (a verified
  `https://` link, needs `/.well-known/assetlinks.json` on the website with
  the app's signing certificate).

## Reporting a problem

Found a security problem? Don't post it publicly (the repository is
public). Tell the project team directly.
