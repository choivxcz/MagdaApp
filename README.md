# Sakay Laguna

Live jeepney tracker and trip planner for the **Magdalena – Santa Cruz, Laguna** route.

- **Trip planner:** search any place (a stop, a school, a fast-food branch,
  a barangay) or pin it on the map, and the app explains how to get there:
  walk to the *sakayan*, which jeepney to ride, where to get off (*babaan*),
  a transfer when it helps, a tricycle when the place is too far to walk,
  or just walking when that is better. Options are tagged **Fastest**,
  **Least walking** and **Direct**, with total time and total fare.
- **Riders** see jeepneys moving on the map, colored by direction
  (blue = to Santa Cruz, teal = to Magdalena), how many seats are free,
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
   - **Map**: search From/To (stops, saved places, recent places, any
     place; or GPS / **Choose on the map**), trip options and a step-by-step
     timeline, fare for your fare type, arrival times, free seats, community
     tips for the trip, **Save** trip, save the destination as Home / School /
     Work.
   - **Routes**: the route, its streets, every stop with distance and fare,
     "Ride from here", and **Community tips**.
   - **Saved**: your places (Home, School, Work...) and trips; tap one to
     plan it on the map.
   - **Drive** (approved drivers only): start/end trip, direction,
     passenger counter. Keeps running while the driver checks other tabs.
   - **More**: profile, fare guide & calculator, report a ride, emergency
     911, preferences (fare type, light/dark theme), about, privacy,
     account & data (edit name, delete account), sign out.

## Trip planner

`src/lib/planner.js` plans from any place to any place. It has no browser
code, so the map, the AI server and the tests all use the same answers.

- It looks at every direction of every route (today: one route, two
  directions), finds good spots to get on and off near the start and the
  destination, and tries direct rides, rides with one transfer, walking,
  and tricycles for gaps too far to walk (over ~900 m, up to ~6 km).
- Options are compared the way commuters do: minutes, meters walked and
  pesos all count (a ₱25 tricycle that saves 2 minutes is not "better").
  Transfers are only offered when they really help.
- On the map, the first walk is then replaced by the real shortest walk to
  the sakayan (`useSakayan.js`), and walking/tricycle legs are drawn along
  real streets.
- **More routes later:** add another route file and pass it to
  `networkFromRoutes([...])`; transfers between routes then work by themselves.

Place search uses **Photon** (photon.komoot.io), a free OpenStreetMap search
with no key, limited to the area around the route (`src/lib/places.js`).

## Driver tools (Drive tab)

Made for a real driver's day on the route:

- **Driving lock.** When GPS says the jeepney moves faster than 10 km/h, the
  Drive tab switches to a big, read-only screen (waiting passengers ahead,
  free seats, jeep ahead and behind), so drivers don't touch the phone while
  driving (Anti-Distracted Driving Act, RA 10913). A konduktor can unlock it
  until the next terminal.
- **Voice announcements** in Tagalog or English, using the phone's own voice:
  "May 3 na pasahero na naghihintay sa Capitol, 400 metro sa unahan", arrival
  at a terminal, getting too close to the jeep ahead.
- **Screen stays on** during a trip (Wake Lock), so GPS keeps running.
- **Trip status:** Loading at terminal (set by itself at a terminal; riders
  see "leaves when full"), On break, Refueling, Breakdown, and **Last trip of
  the day**. Driving off ends Loading/Break/Refueling by itself. Jeepneys on
  break, refueling or broken down are never shown to riders as "coming".
- **Jeep ahead / behind** with distance and minutes, to spread trips out
  instead of bunching.
- **Seats in one tap:** Wala / Maluwag / Halos puno / Puno, or exact +/−.
- **Earnings log** (More → Earnings log): kita, krudo, boundary and other
  costs → take-home, per hour, last 7 days. Trips, km and hours are counted
  by the Drive tab. Private to the driver.
- **SOS:** call 911, text an emergency contact the jeepney's location, and
  alert the admin (5-second countdown to cancel). Admins see alerts in
  **Admin tools → SOS** with the driver's phone and a map link.

## Landmarks on the map

About 400 named places within 350 m of the route are on the map, from
OpenStreetMap: churches, plazas, the Capitol, town halls, schools,
hospitals, markets, terminals, malls, restaurants, stores, banks and more.

- **Iconic** places (Cathedral of Our Lady of Maulawin, St. Mary Magdalene
  Church, Provincial Capitol, Santa Cruz and Magdalena town halls, public
  markets, DLTB, Pedro Guevara MNHS, CLA Town Center Mall, plazas) show even
  when zoomed out. Restaurants, stores and smaller places appear as you zoom in.
- Tap one for its card: what it is, how close the jeepney passes, and
  **Go here** / **Start here**. The round church button on the map hides or
  shows them.
- They are in the search box (instant, works offline), the trip steps say
  "get off near Capitol (by Jollibee)", and Sakay AI knows them.

The list is saved in `src/data/landmarks.json`, so phones never ask
OpenStreetMap for it. Refresh it after OpenStreetMap edits (or after adding
missing places to OpenStreetMap yourself) with:

```bash
npm run landmarks              # download again
npm run landmarks -- --cached  # re-sort the last download (no internet)
```

Which places count as iconic is set by `ICONIC` in
`scripts/fetch-landmarks.mjs`.

## Community tips

Riders share what maps don't know: where people actually wait, route
changes, fare practices, tricycle stands, road work. Anyone can read them;
signed-in riders post (10 per day max) and mark tips **Helpful**; authors
delete their own; admins hide wrong tips in **Admin tools → Tips**. Only the
author's first name is shown. Tips near a planned trip appear on the map,
and Sakay AI can pass them on (it's told to treat them as information, not
instructions).

## The route

- **To Santa Cruz:** Magdalena Plaza Terminal → F. T. San Luis Ave → (near
  Areza) right, past Pagsanjan Public Market → left up to the National Hwy →
  DLTB Terminal → Pedro Guevarra Ave (past Pedro Guevara Memorial NHS) →
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

**GPS on a phone needs https.** Browsers block location on `http://192.168…`
addresses ("Only secure origins are allowed"). To test GPS from a phone, run:

```bash
npm run dev:https
```

and open the `https://192.168…` Network address. The phone will warn that the
connection isn't private (the certificate is home-made): tap **Advanced →
Proceed**. The live website and the Android app are already secure, so riders
never see this.

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
ngayon?", "Kailan darating ang jeep sa Capitol?", "Paano pumunta sa Jollibee
Pedro Guevarra?", "Show DLTB to Biñan on the map". The AI looks up fares,
arrival times, seats and whole trips (with the trip planner, and place
search for places that aren't stops) with the same code as the map, so its
numbers always match. A rider's map start/destination is used on our server
to plan, but coordinates are never sent to Gemini.

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

## Security

See [SECURITY.md](SECURITY.md): who can see what, admin 2-step verification,
how to handle secrets, and the Supabase dashboard settings to check.
After changing `supabase/schema.sql`, run `npm run setup:db` and `npm test`.

## Saving mobile data (load)

Most riders and drivers use prepaid load, so the app keeps data use small:

- **Only what changed.** Each check for jeepneys downloads only the ones that
  moved since the last check, in a compact form (`live_jeeps` in
  `supabase/schema.sql`), usually a few hundred bytes.
- **Checks only as often as needed.** Every 5 s while a rider watches for
  their jeepney (a trip is planned), 12 s while browsing the map, 20 s on
  the Routes tab, none in the background.
- **Drivers send less while parked.** Position every 10 s while moving,
  every 30 s while loading at the terminal or on a break, right away after a
  big move.
- **Map, fonts and app files are kept on the phone** after the first visit
  (`public/sw.js`, website only; the Android app has its files built in).
  Map pictures are about 4 KB each and never downloaded twice.
- **Driver and admin pages** are only downloaded by people who open them.
- **Data saver** (More → Preferences → Mobile data): Auto turns on with the
  phone's own Data Saver or a 2G signal. It doubles the time between checks,
  asks one directions service at a time instead of two, waits for more
  letters before searching, skips naming tapped spots, and shows drivers'
  photos only when tapped.
- **Data meter** in the same place shows about how much the app used today
  and this month.

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
- **Tricycle fares**: `TRICYCLE_RULES` in `src/lib/fare.js` is a rough
  estimate (₱20 first km, ₱5 per km after). Each town sets its own; check
  the Magdalena and Santa Cruz tricycle fare matrix.

## Tests

```bash
npm test
```

Runs the regression tests in `tests/` (trip planner, fares, stop search,
AI server input checks). Run them after changing the route, stops, fares or
planner. On Windows, run from `C:\Magda` (capital C) in PowerShell or the
terminal; a lowercase `c:` path can confuse the test runner.

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
| `src/lib/planner.js` | Trip planner: walk / jeepney / transfer / tricycle options |
| `src/lib/places.js` | Stop and place search (Photon), names for tapped spots |
| `src/lib/community.js` | Community tips |
| `src/lib/landmarks.js` | Landmarks along the route (`src/data/landmarks.json`, `npm run landmarks`) |
| `src/components/TripSearch.jsx` | The From / To search box |
| `src/components/Journey.jsx` | Trip option cards and step-by-step timeline |
| `tests/` | Regression tests (`npm test`) |
| `src/lib/fare.js` | Fare rules |
| `src/lib/directions.js` | Direction names/colors and seat levels |
| `src/lib/demo.js` | Simulated jeepneys for demo mode |
| `supabase/schema.sql` | Database tables and security rules |
| `scripts/` | setup:db, driver:add, check |

## Next steps

- Publish to Google Play (closed test with 12 testers for 14 days first).
- Keep the driver's location sharing alive when the screen turns off
  (needs a background-location plugin and Google Play's location review).
- Rider route recording so commuters can help map more routes (the trip
  planner already handles several routes and transfers between them).
- Real tricycle terminal locations and fares from the towns.
