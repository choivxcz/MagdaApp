# Sakay Laguna

Live jeepney tracker for the **Magdalena – Santa Cruz, Laguna** route.

- **Riders** see jeepneys moving on the map, colored by direction
  (blue = to Santa Cruz, orange = to Magdalena), how many seats are free,
  arrival estimates, and the fare from their pickup to their drop-off stop
  (regular and Student/Senior/PWD).
- **Drivers** sign in, press **Start trip**, and their phone shares its GPS
  location every 10 seconds until they press **End trip**. The konduktor taps
  **+ / −** as passengers get on and off. The direction switches by itself at
  each terminal, and seats reset to empty there.

## App flow

1. **First launch:** three welcome slides → choose fare type (Regular or
   Student/Senior/PWD).
2. **Sign in / Create account** (email + password), or **Continue as guest**.
   Guests can see jeepneys, seats and fares. Accounts can also save trips
   and send ride reports.
3. **Bottom tabs:**
   - **Map**: live jeepneys, From/To stops (or GPS / tap the map), fare for
     your fare type, arrival times, free seats, **Save** trip.
   - **Routes**: the route, its streets, every stop with distance and fare,
     "Ride from here".
   - **Saved**: your saved trips; tap one to open it on the map.
   - **Drive** (approved drivers only): start/end trip, direction,
     passenger counter. Keeps running while the driver checks other tabs.
   - **More**: profile, fare guide & calculator, report a ride, emergency
     911, preferences (fare type, light/dark theme), about, privacy,
     account & data (edit name, delete account), sign out.

## The route

- **To Santa Cruz:** Magdalena Plaza Terminal → F. T. San Luis Ave → National
  Hwy → DLTB Terminal → Pedro Guevarra Ave (past Pedro Guevara Memorial NHS) →
  Manas St → M. H. del Pilar St → Zulueta St → Pedro Guevarra Ave → Burgos St →
  A. Regidor St → Santa Cruz Plaza
- **To Magdalena:** Santa Cruz Plaza → Pedro Guevarra Ave → National Hwy →
  F. T. San Luis Ave → Magdalena Plaza Terminal

Built with React + Vite, MapLibre (free OpenFreeMap tiles) and Supabase.

## Run it

```bash
npm install
npm run dev
```

Open the address it prints (for example `http://localhost:5173`). To try it
on your phone, connect the phone to the same Wi-Fi and open the
`Network:` address it prints.

Without a database the app runs in **demo mode**: three simulated jeepneys
drive back and forth so you can test the rider screen.

## Connect the database (Supabase, free)

1. Create a free project at [supabase.com](https://supabase.com)
   (region: Southeast Asia / Singapore). Save the database password.
2. Copy `.env.local.example` to `.env.local` and fill in the 4 values.
   The file explains where each one is in the Supabase dashboard.
   `.env.local` is git-ignored; never share the secret key or password.
3. Run:

   ```bash
   npm run setup:db      # creates tables, security rules, triggers (safe to re-run)
   npm run check         # end-to-end test of the backend with a temporary driver
   ```

4. Restart `npm run dev`. The "Demo" badge disappears.

### Drivers and admins

**In the app (normal way):**
1. The driver creates a normal account, then goes to **More → Become a driver**
   and sends their name, plate, seats (and optional phone, license and
   franchise numbers). It shows **Pending**.
2. An admin opens **More → Admin tools → Drivers** and taps **Approve**
   (or **Don’t approve**, with a reason the driver can read).
3. The driver gets the **Drive** tab. Admins can **Turn off** a driver later.

Admin tools also lists **Ride reports** to mark as resolved.

**Make someone an admin** (they must have an account first):

```bash
npm run admin:add -- --email you@gmail.com
npm run admin:add -- --list
npm run admin:add -- --email you@gmail.com --remove
```

**Add a driver directly from the computer** (skips the application):

```bash
npm run driver:add -- --email juan@example.com --password "secret123" --name "Juan Dela Cruz" --plate "DXY 123" --seats 20
npm run driver:add -- --email juan@example.com --disable
```

## Sakay AI (chat assistant, free)

The **Ask AI** button on the map opens a chat. Riders can ask in English,
Tagalog or Taglish: "Magkano Magdalena papuntang Santa Cruz?", "May jeep ba
ngayon?", "Kailan darating ang jeep sa Capitol?", "Show DLTB to Biñan on the
map". The AI looks up fares, arrival times and seats with the same code as
the map, so its numbers always match.

- **With a Gemini key** (free tier): Google Gemini understands the question
  and replies naturally. Runs in `api/assistant.js` on Vercel, so the key
  stays secret. If Gemini 2.5 Flash is busy or over its free daily limit, it
  tries Flash-Lite.
- **Without a key, offline, or over the limit**: the app answers common
  questions by itself (`src/lib/assistant/offline.js`), marked "offline answer".

Turn on the AI:

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (sign in with Google → **Create API key**). No credit card needed.
2. For `npm run dev`: add `GEMINI_API_KEY=...` to `.env.local`.
3. For the website and Android app: `npx vercel env add GEMINI_API_KEY production`,
   paste the key, then `npm run deploy:web`.

Never put `VITE_` in front of it: that would ship the key inside the app.
Google may use free-tier prompts to improve its products, so the app tells
riders not to type personal details.

## Website (iPhone and computers)

Live at **https://sakay-laguna.vercel.app** (free Vercel hosting). iPhone users
open it in Safari → Share → **Add to Home Screen**.

Publish changes:

```bash
npm run deploy:web
```

Only the public Supabase URL and publishable key (in `.env.production`) go
online; `.vercelignore` keeps `.env.local` and other secrets out.

## Android app

```bash
npm run android       # builds the web app, copies it into android/, opens Android Studio
```

In Android Studio press **Run ▶** with a phone plugged in (USB debugging on),
or **Build → Generate Signed App Bundle** for Google Play.

### Sign-up emails (free, through Gmail)

Supabase's built-in email only sends ~2 emails per hour. To send up to ~500 a
day for free, let Supabase send through a Gmail account:

1. Turn on 2-Step Verification for the Gmail account, then create an
   **App password** at https://myaccount.google.com/apppasswords.
2. Supabase → Authentication → Emails → **SMTP Settings** → enable custom SMTP:
   host `smtp.gmail.com`, port `465`, username = the Gmail address,
   password = the 16-letter app password, sender = the same Gmail address.
3. Paste the templates in `supabase/email-templates/` into
   Authentication → Emails → Templates (Confirm signup, Reset password).

Or turn **off** "Confirm email" (Authentication → Sign In / Providers →
Email) to skip emails entirely.

### Email links (confirm sign-up, reset password)

Links in Supabase emails open the app at `ph.sakaylaguna.app://auth/callback`
(phone) or the website address (browser). Both must be listed in Supabase →
Authentication → URL Configuration → Redirect URLs. Check with:

```bash
npm run check:links
```

## How the live tracking works

- Each driver has **one row** in `jeepney_locations` that gets overwritten, so
  the table never grows.
- Riders **poll** (re-check) that table every 5 seconds instead of holding a
  live connection, so Supabase's free limit of 200 live connections at once
  does not apply.
- Jeepneys that have not sent an update for 2 minutes are hidden.
- Polling pauses when the app is in the background to save data.

## Things to verify before release

- **Route line**: `src/data/route-magdalena-santa-cruz.json` holds both
  directions, traced on OpenStreetMap roads from the route description.
  Ride it once and check it matches.
- **Stops**: edit `stops` in that file to add real loading points. Each stop
  is matched to the directions it is near automatically.
- **Fares**: `src/lib/fare.js` uses ₱13 for the first 4 km and ₱1.80 per km
  after, with 20% discount. Check the latest LTFRB fare matrix.

## Project layout

| Path | What it is |
|---|---|
| `src/App.jsx` | App shell: first launch → sign in → tabs |
| `src/screens/` | Onboarding, Auth, Map, Routes, Saved, Drive, More |
| `src/lib/auth.jsx` | Signed-in user, profile, driver status |
| `src/lib/account.js` | Profile, saved trips, reports, delete account |
| `src/lib/prefs.js` | Settings stored on the phone |
| `src/components/MapView.jsx` | The map and its markers |
| `src/lib/locations.js` | Reads and writes jeepney positions |
| `src/lib/geo.js` | Distance and "how far along the route" math |
| `src/lib/fare.js` | Fare rules |
| `src/lib/directions.js` | Direction names/colors and seat levels |
| `src/lib/demo.js` | Simulated jeepneys for demo mode |
| `supabase/schema.sql` | Database tables and security rules |
| `scripts/` | setup:db, driver:add, check |

## Next steps

- Publish to Google Play (closed test with 12 testers for 14 days first).
- Keep the driver's location sharing alive when the screen turns off
  (needs a background-location plugin and Google Play's location review).
- Rider route recording so commuters can help map more routes.
