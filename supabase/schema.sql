-- Sakay Laguna database setup.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

-- 1. Approved drivers. The admin adds rows here (Table Editor), so
--    random people cannot sign up and pretend to be a jeepney.
create table if not exists public.drivers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  plate      text not null,
  route_id   text not null default 'magdalena-santa-cruz',
  seat_capacity int not null default 20 check (seat_capacity between 1 and 40),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Latest position of each jeepney. ONE row per driver that gets
--    overwritten, so this table never grows.
create table if not exists public.jeepney_locations (
  driver_id  uuid primary key references public.drivers (user_id) on delete cascade,
  route_id   text not null,
  plate      text not null,
  direction  text not null check (direction in ('to_santa_cruz', 'to_magdalena')),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  heading    real,
  speed      real,
  accuracy   real,
  seats_total int,
  seats_taken int not null default 0 check (seats_taken >= 0),
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Safe to re-run: adds the seat columns if you created the tables
-- with an older version of this file.
alter table public.drivers
  add column if not exists seat_capacity int not null default 20 check (seat_capacity between 1 and 40);
alter table public.jeepney_locations
  add column if not exists seats_total int,
  add column if not exists seats_taken int not null default 0 check (seats_taken >= 0);

create index if not exists jeepney_locations_active_idx
  on public.jeepney_locations (route_id, is_active, updated_at desc);

-- 3. The server fills in time, plate, route and seat capacity itself,
--    so drivers cannot send fake timestamps, another jeepney's plate,
--    or more passengers than the jeepney holds.
create or replace function public.fill_jeepney_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select d.plate, d.route_id, d.seat_capacity
    into new.plate, new.route_id, new.seats_total
    from public.drivers d
   where d.user_id = new.driver_id;
  new.seats_taken := least(greatest(coalesce(new.seats_taken, 0), 0), coalesce(new.seats_total, 0));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fill_jeepney_location on public.jeepney_locations;
create trigger fill_jeepney_location
  before insert or update on public.jeepney_locations
  for each row execute function public.fill_jeepney_location();

-- Table access for the app's API roles. Row Level Security below still
-- decides which rows each role can actually touch.
grant usage on schema public to anon, authenticated;
grant select on public.jeepney_locations to anon, authenticated;
grant insert, update on public.jeepney_locations to authenticated;
grant select on public.drivers to authenticated;

-- 4. Security rules (Row Level Security).
alter table public.drivers enable row level security;
alter table public.jeepney_locations enable row level security;

-- Drivers can read only their own profile.
drop policy if exists "driver reads own profile" on public.drivers;
create policy "driver reads own profile" on public.drivers
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Anyone (riders don't log in) can see jeepney positions.
drop policy if exists "anyone reads locations" on public.jeepney_locations;
create policy "anyone reads locations" on public.jeepney_locations
  for select to anon, authenticated
  using (true);

-- Only approved drivers can write, and only their own row.
create or replace function public.is_approved_driver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.drivers
     where user_id = (select auth.uid()) and approved
  );
$$;

drop policy if exists "driver inserts own location" on public.jeepney_locations;
create policy "driver inserts own location" on public.jeepney_locations
  for insert to authenticated
  with check (driver_id = (select auth.uid()) and public.is_approved_driver());

drop policy if exists "driver updates own location" on public.jeepney_locations;
create policy "driver updates own location" on public.jeepney_locations
  for update to authenticated
  using (driver_id = (select auth.uid()))
  with check (driver_id = (select auth.uid()) and public.is_approved_driver());

grant execute on function public.is_approved_driver() to authenticated;

-- =====================================================================
-- 5. Commuter accounts: profile, saved trips, ride reports.
-- =====================================================================

-- One profile per account, created automatically on sign-up.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  fare_type  text not null default 'regular' check (fare_type in ('regular', 'discounted')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, fare_type)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'fare_type', ''), 'regular')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for accounts that existed before this table.
insert into public.profiles (id, full_name)
select u.id, u.raw_user_meta_data ->> 'full_name' from auth.users u
on conflict (id) do nothing;

-- Trips a commuter saved for quick access.
create table if not exists public.saved_trips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  route_id        text not null default 'magdalena-santa-cruz',
  direction       text not null check (direction in ('to_santa_cruz', 'to_magdalena')),
  pickup_stop_id  text not null,
  dropoff_stop_id text not null,
  created_at      timestamptz not null default now()
);
create index if not exists saved_trips_user_idx on public.saved_trips (user_id, created_at desc);

-- Commuter reports about a ride (overpricing, harassment, reckless driving).
create table if not exists public.ride_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  plate      text check (char_length(plate) <= 20),
  category   text not null check (category in ('overpricing', 'harassment', 'reckless', 'other')),
  details    text check (char_length(details) <= 1000),
  status     text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.saved_trips to authenticated;
grant select, insert on public.ride_reports to authenticated;

alter table public.profiles enable row level security;
alter table public.saved_trips enable row level security;
alter table public.ride_reports enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "own saved trips" on public.saved_trips;
create policy "own saved trips" on public.saved_trips
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "file own report" on public.ride_reports;
create policy "file own report" on public.ride_reports
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "read own reports" on public.ride_reports;
create policy "read own reports" on public.ride_reports
  for select to authenticated using (user_id = (select auth.uid()));

-- Lets a signed-in user delete their own account (required by Google Play).
-- Saved trips and profile go with it; reports stay but lose the link.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- 6. Driver applications and admins.
--    Drivers apply in the app; an admin approves them in the app.
-- =====================================================================

alter table public.drivers
  add column if not exists status       text not null default 'pending',
  add column if not exists phone        text,
  add column if not exists license_no   text,
  add column if not exists franchise_no text,
  add column if not exists review_note  text,
  add column if not exists applied_at   timestamptz not null default now(),
  add column if not exists reviewed_at  timestamptz;

do $$ begin
  alter table public.drivers add constraint drivers_status_check
    check (status in ('pending', 'approved', 'rejected', 'disabled'));
exception when duplicate_object then null; end $$;

-- Drivers that existed before applications were added.
update public.drivers set status = 'approved' where approved and status = 'pending';

-- Keep "approved" (used by the security rules) in step with "status".
-- Changing either one in the Table Editor works.
create or replace function public.sync_driver_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved and new.status = 'pending' then new.status := 'approved'; end if;
  elsif new.status is not distinct from old.status and new.approved is distinct from old.approved then
    new.status := case when new.approved then 'approved' else 'disabled' end;
  end if;
  new.approved := (new.status = 'approved');
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'pending' then
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_driver_status on public.drivers;
create trigger sync_driver_status
  before insert or update on public.drivers
  for each row execute function public.sync_driver_status();

-- People who can review drivers and reports.
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
grant select on public.app_admins to authenticated;
drop policy if exists "see own admin row" on public.app_admins;
create policy "see own admin row" on public.app_admins
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
grant execute on function public.is_admin() to authenticated;

-- A signed-in user applies (or re-applies) to be a driver.
create or replace function public.apply_as_driver(
  p_full_name text, p_plate text, p_seat_capacity int,
  p_phone text default null, p_license_no text default null, p_franchise_no text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_plate), '') = '' then
    raise exception 'Name and plate number are required.';
  end if;
  if p_seat_capacity is null or p_seat_capacity not between 1 and 40 then
    raise exception 'Seats must be from 1 to 40.';
  end if;

  select status into current_status from public.drivers where user_id = auth.uid();
  if current_status = 'approved' then raise exception 'You are already an approved driver.'; end if;
  if current_status = 'disabled' then raise exception 'Your driver access was turned off. Please contact the admin.'; end if;

  insert into public.drivers (user_id, full_name, plate, seat_capacity, phone, license_no, franchise_no, status, review_note, applied_at)
  values (auth.uid(), left(trim(p_full_name), 60), upper(left(trim(p_plate), 20)), p_seat_capacity,
          nullif(left(trim(p_phone), 30), ''), nullif(left(trim(p_license_no), 40), ''), nullif(left(trim(p_franchise_no), 40), ''),
          'pending', null, now())
  on conflict (user_id) do update set
    full_name = excluded.full_name, plate = excluded.plate, seat_capacity = excluded.seat_capacity,
    phone = excluded.phone, license_no = excluded.license_no, franchise_no = excluded.franchise_no,
    status = 'pending', review_note = null, applied_at = now();
end;
$$;
revoke all on function public.apply_as_driver(text, text, int, text, text, text) from public, anon;
grant execute on function public.apply_as_driver(text, text, int, text, text, text) to authenticated;

-- Admin: list every driver and applicant, with their email and photo versions.
-- (Dropped first because its columns changed; photo_version is in section 7.)
drop function if exists public.admin_list_drivers();
create function public.admin_list_drivers()
returns table (
  user_id uuid, email text, full_name text, plate text, seat_capacity int, phone text,
  license_no text, franchise_no text, status text, review_note text, applied_at timestamptz, reviewed_at timestamptz,
  avatar_v bigint, jeepney_v bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select d.user_id, u.email::text, d.full_name, d.plate, d.seat_capacity, d.phone,
           d.license_no, d.franchise_no, d.status, d.review_note, d.applied_at, d.reviewed_at,
           public.photo_version(d.user_id, 'avatar'), public.photo_version(d.user_id, 'jeepney')
      from public.drivers d join auth.users u on u.id = d.user_id
     order by (d.status = 'pending') desc, d.applied_at desc;
end;
$$;
revoke all on function public.admin_list_drivers() from public, anon;
grant execute on function public.admin_list_drivers() to authenticated;

-- Admin: approve, reject or disable a driver.
create or replace function public.admin_review_driver(p_user_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('approved', 'rejected', 'disabled') then raise exception 'Unknown status.'; end if;
  update public.drivers
     set status = p_status, review_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where user_id = p_user_id;
  if not found then raise exception 'Driver not found.'; end if;
  if p_status <> 'approved' then
    update public.jeepney_locations set is_active = false where driver_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.admin_review_driver(uuid, text, text) from public, anon;
grant execute on function public.admin_review_driver(uuid, text, text) to authenticated;

-- Admin: see and resolve ride reports.
drop policy if exists "admins read reports" on public.ride_reports;
create policy "admins read reports" on public.ride_reports
  for select to authenticated using (public.is_admin());

create or replace function public.admin_set_report_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('open', 'resolved') then raise exception 'Unknown status.'; end if;
  update public.ride_reports set status = p_status where id = p_id;
end;
$$;
revoke all on function public.admin_set_report_status(uuid, text) from public, anon;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;

-- =====================================================================
-- 7. Photos: a profile picture for every account, and a jeepney photo
--    for drivers. Riders see a driver's photos when they tap the jeepney.
--    Files live in one public bucket as <user id>/avatar.jpg and
--    <user id>/jeepney.jpg. The app shrinks photos before uploading,
--    so each one is only about 100-300 KB.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A user may only touch their own two files. Jeepney photos are for
-- drivers and applicants only.
create or replace function public.is_own_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    p_name = (select auth.uid())::text || '/avatar.jpg'
    or (p_name = (select auth.uid())::text || '/jeepney.jpg'
        and exists (select 1 from public.drivers where user_id = (select auth.uid())))
  );
$$;
grant execute on function public.is_own_photo(text) to authenticated;

drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_own_photo(name));
drop policy if exists "own photos upload" on storage.objects;
create policy "own photos upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_own_photo(name));
drop policy if exists "own photos replace" on storage.objects;
create policy "own photos replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_own_photo(name))
  with check (bucket_id = 'photos' and public.is_own_photo(name));
drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_own_photo(name));

-- When a photo was last changed (milliseconds), or null if there is none.
-- The app adds this to the photo link so phones load the new picture.
create or replace function public.photo_version(p_user_id uuid, p_kind text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (extract(epoch from o.updated_at) * 1000)::bigint
    from storage.objects o
   where o.bucket_id = 'photos' and o.name = p_user_id::text || '/' || p_kind || '.jpg';
$$;
revoke all on function public.photo_version(uuid, text) from public, anon, authenticated;

-- The signed-in user's own photos.
create or replace function public.my_photos()
returns table (avatar_v bigint, jeepney_v bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select public.photo_version(auth.uid(), 'avatar'), public.photo_version(auth.uid(), 'jeepney')
   where auth.uid() is not null;
$$;
revoke all on function public.my_photos() from public, anon;
grant execute on function public.my_photos() to authenticated;

-- What a rider sees after tapping a jeepney. Approved drivers only, and
-- only these few fields (no email, phone or license number).
create or replace function public.driver_card(p_driver_id uuid)
returns table (full_name text, plate text, seat_capacity int, avatar_v bigint, jeepney_v bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select d.full_name, d.plate, d.seat_capacity,
         public.photo_version(d.user_id, 'avatar'), public.photo_version(d.user_id, 'jeepney')
    from public.drivers d
   where d.user_id = p_driver_id and d.status = 'approved';
$$;
revoke all on function public.driver_card(uuid) from public;
grant execute on function public.driver_card(uuid) to anon, authenticated;

-- =====================================================================
-- 9. "I'm waiting here": passengers tell on-duty drivers where they are
--    waiting and how many they are. No names are shared, the spot is
--    rounded to about 10 m, and a signal ends by itself after 20 minutes.
-- =====================================================================

create table if not exists public.waiting_signals (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  route_id   text not null,
  direction  text not null check (direction in ('to_santa_cruz', 'to_magdalena')),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  people     smallint not null default 1 check (people between 1 and 6),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.waiting_signals enable row level security;

-- Passengers can see their own signal; changes go through the functions below.
drop policy if exists "own waiting signal" on public.waiting_signals;
create policy "own waiting signal" on public.waiting_signals
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Start (or move / refresh) my signal. Times come from the server clock.
create or replace function public.wait_here(
  p_route_id text, p_direction text, p_lat double precision, p_lng double precision, p_people int default 1
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + interval '20 minutes';
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  -- Old signals are cleaned up whenever someone starts a new one.
  delete from public.waiting_signals where expires_at < now() - interval '1 hour';
  insert into public.waiting_signals (user_id, route_id, direction, lat, lng, people, created_at, expires_at)
  values (auth.uid(), p_route_id, p_direction, p_lat, p_lng, greatest(1, least(6, coalesce(p_people, 1))), now(), v_expires)
  on conflict (user_id) do update
    set route_id = excluded.route_id, direction = excluded.direction, lat = excluded.lat, lng = excluded.lng,
        people = excluded.people, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return v_expires;
end;
$$;
revoke all on function public.wait_here(text, text, double precision, double precision, int) from public, anon;
grant execute on function public.wait_here(text, text, double precision, double precision, int) to authenticated;

create or replace function public.stop_waiting()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.waiting_signals where user_id = (select auth.uid());
$$;
revoke all on function public.stop_waiting() from public, anon;
grant execute on function public.stop_waiting() to authenticated;

-- What an approved driver sees: where people wait and how many. No names, no ids.
create or replace function public.waiting_for_drivers(p_route_id text)
returns table (direction text, lat double precision, lng double precision, people int, minutes_waiting int)
language sql
stable
security definer
set search_path = ''
as $$
  select w.direction,
         round(w.lat::numeric, 4)::double precision,
         round(w.lng::numeric, 4)::double precision,
         w.people::int,
         floor(extract(epoch from now() - w.created_at) / 60)::int
    from public.waiting_signals w
   where w.route_id = p_route_id
     and w.expires_at > now()
     and public.is_approved_driver();
$$;
revoke all on function public.waiting_for_drivers(text) from public, anon;
grant execute on function public.waiting_for_drivers(text) to authenticated;

-- =====================================================================
-- 10. Trip planner: saved places (Home, School, Work...) and saved trips
--     between any two places, not only between stops.
-- =====================================================================

create table if not exists public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null default 'other' check (kind in ('home', 'school', 'work', 'other')),
  label      text not null check (char_length(label) between 1 and 60),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  stop_id    text check (char_length(stop_id) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists saved_places_user_idx on public.saved_places (user_id, created_at);
grant select, insert, update, delete on public.saved_places to authenticated;
alter table public.saved_places enable row level security;
drop policy if exists "own saved places" on public.saved_places;
create policy "own saved places" on public.saved_places
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A trip end is either a stop (pickup/dropoff_stop_id) or a place (label + lat/lng).
alter table public.saved_trips
  alter column direction drop not null,
  alter column pickup_stop_id drop not null,
  alter column dropoff_stop_id drop not null,
  add column if not exists from_label text check (char_length(from_label) <= 80),
  add column if not exists from_lat   double precision check (from_lat between -90 and 90),
  add column if not exists from_lng   double precision check (from_lng between -180 and 180),
  add column if not exists to_label   text check (char_length(to_label) <= 80),
  add column if not exists to_lat     double precision check (to_lat between -90 and 90),
  add column if not exists to_lng     double precision check (to_lng between -180 and 180);

do $$ begin
  alter table public.saved_trips add constraint saved_trips_ends_check check (
    (pickup_stop_id is not null or (from_lat is not null and from_lng is not null))
    and (dropoff_stop_id is not null or (to_lat is not null and to_lng is not null))
  );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 11. Community tips: what local commuters know that maps don't (route
--     changes, where people wait, fares, terminals, road work).
--     Everyone can read; signed-in riders post and vote "helpful";
--     admins hide wrong or abusive tips. All changes go through the
--     functions below, and readers only see the author's first name.
-- =====================================================================

create table if not exists public.community_tips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  route_id   text not null,
  category   text not null check (category in ('route_change', 'boarding', 'fare', 'terminal', 'road', 'other')),
  body       text not null check (char_length(body) between 5 and 280),
  stop_id    text check (char_length(stop_id) <= 40),
  lat        double precision check (lat between -90 and 90),
  lng        double precision check (lng between -180 and 180),
  status     text not null default 'visible' check (status in ('visible', 'hidden')),
  helpful    int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists community_tips_route_idx on public.community_tips (route_id, status, created_at desc);
create index if not exists community_tips_user_idx on public.community_tips (user_id, created_at desc);

create table if not exists public.tip_votes (
  tip_id     uuid not null references public.community_tips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tip_id, user_id)
);

-- No direct table access: everything goes through the functions.
alter table public.community_tips enable row level security;
alter table public.tip_votes enable row level security;
revoke all on public.community_tips from anon, authenticated;
revoke all on public.tip_votes from anon, authenticated;

create or replace function public.list_tips(p_route_id text, p_include_hidden boolean default false)
returns table (
  id uuid, category text, body text, stop_id text, lat double precision, lng double precision,
  helpful int, created_at timestamptz, author text, mine boolean, voted boolean, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.category, t.body, t.stop_id, t.lat, t.lng, t.helpful, t.created_at,
         coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Commuter'),
         coalesce(t.user_id = (select auth.uid()), false),
         exists (select 1 from public.tip_votes v where v.tip_id = t.id and v.user_id = (select auth.uid())),
         t.status
    from public.community_tips t
    left join public.profiles p on p.id = t.user_id
   where t.route_id = p_route_id
     and (t.status = 'visible' or (p_include_hidden and public.is_admin()))
   order by t.created_at desc
   limit 200;
$$;
revoke all on function public.list_tips(text, boolean) from public;
grant execute on function public.list_tips(text, boolean) to anon, authenticated;

create or replace function public.post_tip(
  p_route_id text, p_category text, p_body text,
  p_stop_id text default null, p_lat double precision default null, p_lng double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to share a tip.'; end if;
  if (select count(*) from public.community_tips
       where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have shared 10 tips today. Please try again tomorrow.';
  end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Location needs both latitude and longitude.'; end if;
  insert into public.community_tips (user_id, route_id, category, body, stop_id, lat, lng)
  values (auth.uid(), left(p_route_id, 60), p_category, trim(p_body), nullif(p_stop_id, ''), p_lat, p_lng)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.post_tip(text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.post_tip(text, text, text, text, double precision, double precision) to authenticated;

-- Authors delete their own tips; admins can delete any.
create or replace function public.delete_tip(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_tips
   where id = p_id and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Tip not found, or it is not yours.'; end if;
end;
$$;
revoke all on function public.delete_tip(uuid) from public, anon;
grant execute on function public.delete_tip(uuid) to authenticated;

-- "Helpful": one vote per rider, tap again to undo. Not on your own tip.
create or replace function public.toggle_tip_vote(p_id uuid)
returns table (helpful int, voted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voted boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to vote.'; end if;
  if not exists (select 1 from public.community_tips t where t.id = p_id and t.status = 'visible' and t.user_id <> auth.uid()) then
    raise exception 'You cannot vote on this tip.';
  end if;
  delete from public.tip_votes v where v.tip_id = p_id and v.user_id = auth.uid();
  v_voted := not found;
  if v_voted then
    insert into public.tip_votes (tip_id, user_id) values (p_id, auth.uid());
  end if;
  update public.community_tips t
     set helpful = (select count(*) from public.tip_votes v where v.tip_id = p_id)
   where t.id = p_id;
  return query select t.helpful, v_voted from public.community_tips t where t.id = p_id;
end;
$$;
revoke all on function public.toggle_tip_vote(uuid) from public, anon;
grant execute on function public.toggle_tip_vote(uuid) to authenticated;

create or replace function public.admin_set_tip_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('visible', 'hidden') then raise exception 'Unknown status.'; end if;
  update public.community_tips set status = p_status where id = p_id;
end;
$$;
revoke all on function public.admin_set_tip_status(uuid, text) from public, anon;
grant execute on function public.admin_set_tip_status(uuid, text) to authenticated;

-- =====================================================================
-- 12. Driver tools: trip status (loading at the terminal, break,
--     refueling, breakdown, last trip), a private earnings log for the
--     boundary system, and SOS alerts the admin can see.
-- =====================================================================

alter table public.jeepney_locations
  add column if not exists trip_status text not null default 'on_trip',
  add column if not exists last_trip   boolean not null default false;

do $$ begin
  alter table public.jeepney_locations add constraint jeepney_locations_trip_status_check
    check (trip_status in ('on_trip', 'loading', 'break', 'refueling', 'breakdown'));
exception when duplicate_object then null; end $$;

-- One row per driver per day. Only the driver can see it.
create table if not exists public.driver_earnings (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day        date not null,
  gross      numeric(9, 2) not null default 0 check (gross between 0 and 100000),
  fuel       numeric(9, 2) not null default 0 check (fuel between 0 and 100000),
  boundary   numeric(9, 2) not null default 0 check (boundary between 0 and 100000),
  other      numeric(9, 2) not null default 0 check (other between 0 and 100000),
  trips      int not null default 0 check (trips between 0 and 200),
  km         numeric(7, 1) not null default 0 check (km between 0 and 2000),
  minutes    int not null default 0 check (minutes between 0 and 1440),
  note       text check (char_length(note) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
grant select, insert, update, delete on public.driver_earnings to authenticated;
alter table public.driver_earnings enable row level security;
drop policy if exists "own earnings" on public.driver_earnings;
create policy "own earnings" on public.driver_earnings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- SOS: an approved driver's emergency alert with their location.
create table if not exists public.sos_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plate       text,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists sos_alerts_status_idx on public.sos_alerts (status, created_at desc);
grant select, insert on public.sos_alerts to authenticated;
alter table public.sos_alerts enable row level security;

drop policy if exists "driver sends sos" on public.sos_alerts;
create policy "driver sends sos" on public.sos_alerts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_approved_driver() and status = 'open');
drop policy if exists "read own or admin sos" on public.sos_alerts;
create policy "read own or admin sos" on public.sos_alerts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- The plate comes from the driver's record, not from the phone.
create or replace function public.fill_sos_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select d.plate into new.plate from public.drivers d where d.user_id = new.user_id;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists fill_sos_alert on public.sos_alerts;
create trigger fill_sos_alert
  before insert on public.sos_alerts
  for each row execute function public.fill_sos_alert();

-- Admin view: alerts with the driver's name and phone, so the admin can call.
create or replace function public.admin_list_sos()
returns table (
  id uuid, plate text, lat double precision, lng double precision, status text,
  created_at timestamptz, resolved_at timestamptz, full_name text, phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.plate, a.lat, a.lng, a.status, a.created_at, a.resolved_at, d.full_name, d.phone
    from public.sos_alerts a
    left join public.drivers d on d.user_id = a.user_id
   where public.is_admin()
   order by a.created_at desc
   limit 100;
$$;
revoke all on function public.admin_list_sos() from public, anon;
grant execute on function public.admin_list_sos() to authenticated;

create or replace function public.admin_resolve_sos(p_id uuid, p_status text default 'resolved')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('open', 'resolved') then raise exception 'Unknown status.'; end if;
  update public.sos_alerts
     set status = p_status, resolved_at = case when p_status = 'resolved' then now() else null end
   where id = p_id;
end;
$$;
revoke all on function public.admin_resolve_sos(uuid, text) from public, anon;
grant execute on function public.admin_resolve_sos(uuid, text) to authenticated;

-- =====================================================================
-- 13. Data saving: live jeepney updates in a compact form, and only the
--     jeepneys that changed since the rider's last check.
--     Each row: [driver id, plate, direction, lat, lng, seats total,
--                seats taken, trip status, last trip, active, updated (s)]
--     Coordinates are rounded to 5 decimals (about 1 m).
-- =====================================================================

create or replace function public.live_jeeps(p_route_id text, p_since timestamptz default null)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'now', floor(extract(epoch from now()) * 1000),
    'rows', coalesce(json_agg(json_build_array(
      l.driver_id, l.plate, l.direction,
      round(l.lat::numeric, 5), round(l.lng::numeric, 5),
      l.seats_total, l.seats_taken, l.trip_status, l.last_trip, l.is_active,
      floor(extract(epoch from l.updated_at))
    )), '[]'::json)
  )
  from public.jeepney_locations l
  where l.route_id = p_route_id
    and l.updated_at > coalesce(p_since, now() - interval '2 minutes')
    -- A first (full) check only needs jeepneys on a trip; later checks also
    -- need the ones that just ended, so the app can remove them.
    and (p_since is not null or l.is_active);
$$;
revoke all on function public.live_jeeps(text, timestamptz) from public;
grant execute on function public.live_jeeps(text, timestamptz) to anon, authenticated;

-- =====================================================================
-- 14. Security hardening (review of 2026-11-18)
-- =====================================================================

-- 14a. Drivers' privacy: a jeepney's position is public only while it is
--      on a trip. Before, anyone could read where each driver ENDED their
--      last trip (often their home). Drivers can still read their own row.
drop policy if exists "anyone reads locations" on public.jeepney_locations;
drop policy if exists "anyone reads live locations" on public.jeepney_locations;
create policy "anyone reads live locations" on public.jeepney_locations
  for select to anon, authenticated
  using (is_active and updated_at > now() - interval '2 minutes');
drop policy if exists "driver reads own location" on public.jeepney_locations;
create policy "driver reads own location" on public.jeepney_locations
  for select to authenticated
  using (driver_id = (select auth.uid()));

-- 14b. Live updates: never look further back than 5 minutes (a made-up
--      old "since" used to return old positions), and send no position or
--      plate for trips that ended (the app only needs to remove them).
create or replace function public.live_jeeps(p_route_id text, p_since timestamptz default null)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'now', floor(extract(epoch from now()) * 1000),
    'rows', coalesce(json_agg(case when l.is_active then json_build_array(
      l.driver_id, l.plate, l.direction,
      round(l.lat::numeric, 5), round(l.lng::numeric, 5),
      l.seats_total, l.seats_taken, l.trip_status, l.last_trip, true,
      floor(extract(epoch from l.updated_at))
    ) else json_build_array(
      l.driver_id, null, null, null, null, null, null, null, null, false,
      floor(extract(epoch from l.updated_at))
    ) end), '[]'::json)
  )
  from public.jeepney_locations l
  where l.route_id = p_route_id
    and l.updated_at > greatest(coalesce(p_since, now() - interval '2 minutes'), now() - interval '5 minutes')
    and (p_since is not null or l.is_active);
$$;
revoke all on function public.live_jeeps(text, timestamptz) from public;
grant execute on function public.live_jeeps(text, timestamptz) to anon, authenticated;

-- 14c. Limits against spam and runaway apps. Errors are in plain words
--      because the app shows them to the user.
create or replace function public.limit_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if tg_table_name = 'ride_reports' then
    select count(*) into v_count from public.ride_reports
     where user_id = new.user_id and created_at > now() - interval '1 day';
    if v_count >= 10 then raise exception 'You have sent 10 reports today. Please try again tomorrow, or call 911 if this is an emergency.'; end if;
  elsif tg_table_name = 'sos_alerts' then
    select count(*) into v_count from public.sos_alerts
     where user_id = new.user_id and created_at > now() - interval '1 hour';
    if v_count >= 10 then raise exception 'Too many SOS alerts in the last hour. Call 911 directly.'; end if;
  elsif tg_table_name = 'saved_places' then
    select count(*) into v_count from public.saved_places where user_id = new.user_id;
    if v_count >= 50 then raise exception 'You can save up to 50 places. Remove one first.'; end if;
  elsif tg_table_name = 'saved_trips' then
    select count(*) into v_count from public.saved_trips where user_id = new.user_id;
    if v_count >= 100 then raise exception 'You can save up to 100 trips. Remove one first.'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists limit_rows on public.ride_reports;
create trigger limit_rows before insert on public.ride_reports for each row execute function public.limit_rows();
drop trigger if exists limit_rows on public.sos_alerts;
create trigger limit_rows before insert on public.sos_alerts for each row execute function public.limit_rows();
drop trigger if exists limit_rows on public.saved_places;
create trigger limit_rows before insert on public.saved_places for each row execute function public.limit_rows();
drop trigger if exists limit_rows on public.saved_trips;
create trigger limit_rows before insert on public.saved_trips for each row execute function public.limit_rows();

-- 14d. Length limits on text people can type.
do $$ begin
  alter table public.profiles add constraint profiles_full_name_len check (char_length(full_name) <= 80) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.waiting_signals add constraint waiting_signals_route_len check (char_length(route_id) <= 60) not valid;
exception when duplicate_object then null; end $$;

-- A new account's name comes from the sign-up form; keep it short.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, fare_type)
  values (
    new.id,
    nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 60), ''),
    case when new.raw_user_meta_data ->> 'fare_type' = 'discounted' then 'discounted' else 'regular' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 14e. Admins need 2-step verification. Admin powers (approving drivers,
--      reading reports and SOS alerts, hiding tips) work only in a session
--      verified with an authenticator-app code ("aal2"). A stolen admin
--      password alone is not enough. Set it up in the app: More → Admin tools.
--      Lost the authenticator? A developer runs: npm run admin:mfa-reset -- --email ...
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()))
     and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;
grant execute on function public.is_admin() to authenticated;


-- =====================================================================
-- 15. Community (like DavaoGo): commuters add tricycle / e-trike routes
--     and terminals that aren't on the map, vote and confirm them
--     ("I've ridden this"), comment, and chat. An admin approves new
--     routes and terminals before everyone sees them.
--
--     Safety: readers see only a first name (or "Anonymous commuter"),
--     never account ids. Anyone can report a post, comment or chat
--     message; after 3 reports it hides until an admin looks at it.
--     People can block each other, and admins can ban spammers (all their
--     content disappears). Chat messages show for 1 hour and are deleted
--     after a day.
-- =====================================================================

alter table public.profiles add column if not exists banned_at timestamptz;

create table if not exists public.community_posts (
  id           uuid primary key default gen_random_uuid(),
  -- Approved routes stay when the account is deleted (without the name),
  -- so other commuters can still use them.
  user_id      uuid default auth.uid() references auth.users (id) on delete set null,
  route_id     text not null check (char_length(route_id) <= 60),
  kind         text not null check (kind in ('terminal', 'local_route')),
  name         text not null check (char_length(name) between 3 and 80),
  note         text check (char_length(note) <= 500),
  vehicles     text[] not null check (cardinality(vehicles) between 1 and 4
                 and vehicles <@ array['tricycle', 'etrike', 'pedicab', 'jeepney', 'van', 'bus', 'habal']::text[]),
  fare_default numeric(6, 2) check (fare_default between 0 and 999),
  fare_solo    numeric(6, 2) check (fare_solo between 0 and 999),
  fare_shared  numeric(6, 2) check (fare_shared between 0 and 999),
  hours        text check (char_length(hours) <= 80),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  path         jsonb check (path is null or (jsonb_typeof(path) = 'array' and jsonb_array_length(path) between 2 and 400)),
  status       text not null default 'review' check (status in ('review', 'approved', 'rejected', 'hidden')),
  review_note  text check (char_length(review_note) <= 200),
  anonymous    boolean not null default false,
  up           int not null default 0,
  down         int not null default 0,
  confirms     int not null default 0,
  comments     int not null default 0,
  reports      int not null default 0,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists community_posts_feed_idx on public.community_posts (route_id, status, created_at desc);
create index if not exists community_posts_user_idx on public.community_posts (user_id, created_at desc);

create table if not exists public.post_votes (
  post_id    uuid not null references public.community_posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_confirms (
  post_id    uuid not null references public.community_posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Comments on a post or on a tip.
create table if not exists public.community_comments (
  id          uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('post', 'tip')),
  target_id   uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  status      text not null default 'visible' check (status in ('visible', 'hidden')),
  reports     int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists community_comments_target_idx on public.community_comments (target_kind, target_id, created_at);
create index if not exists community_comments_user_idx on public.community_comments (user_id, created_at desc);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  route_id   text not null check (char_length(route_id) <= 60),
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  anonymous  boolean not null default false,
  status     text not null default 'visible' check (status in ('visible', 'hidden')),
  reports    int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_route_idx on public.chat_messages (route_id, id);
create index if not exists chat_messages_time_idx on public.chat_messages (created_at);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at desc);

create table if not exists public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('post', 'tip', 'comment', 'chat')),
  target_id   text not null check (char_length(target_id) <= 40),
  reporter    uuid default auth.uid() references auth.users (id) on delete set null,
  reason      text not null check (reason in ('spam', 'harassment', 'false_info', 'inappropriate', 'other')),
  note        text check (char_length(note) <= 300),
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at  timestamptz not null default now(),
  unique (target_kind, target_id, reporter)
);
create index if not exists content_reports_open_idx on public.content_reports (status, created_at desc);

create table if not exists public.user_blocks (
  blocker    uuid not null references auth.users (id) on delete cascade,
  blocked    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- No direct table access: everything goes through the functions below.
alter table public.community_posts enable row level security;
alter table public.post_votes enable row level security;
alter table public.post_confirms enable row level security;
alter table public.community_comments enable row level security;
alter table public.chat_messages enable row level security;
alter table public.content_reports enable row level security;
alter table public.user_blocks enable row level security;
revoke all on public.community_posts, public.post_votes, public.post_confirms, public.community_comments,
  public.chat_messages, public.content_reports, public.user_blocks from anon, authenticated;

-- ----- helpers -----

-- What readers see as the name: first name only, or "Anonymous commuter".
create or replace function public.public_name(p_user_id uuid, p_anonymous boolean default false)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_anonymous or p_user_id is null then 'Anonymous commuter'
              else coalesce((select nullif(split_part(trim(p.full_name), ' ', 1), '') from public.profiles p where p.id = p_user_id), 'Commuter') end;
$$;
revoke all on function public.public_name(uuid, boolean) from public, anon, authenticated;

-- True when the signed-in user may see this author's content: not banned,
-- and neither has blocked the other.
create or replace function public.can_see_author(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_author is null or (
    not exists (select 1 from public.profiles p where p.id = p_author and p.banned_at is not null)
    and ((select auth.uid()) is null or not exists (
      select 1 from public.user_blocks b
       where (b.blocker = (select auth.uid()) and b.blocked = p_author)
          or (b.blocker = p_author and b.blocked = (select auth.uid()))))
  );
$$;
revoke all on function public.can_see_author(uuid) from public, anon, authenticated;

create or replace function public.is_driver_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.drivers d where d.user_id = p_user_id and d.approved);
$$;
revoke all on function public.is_driver_account(uuid) from public, anon, authenticated;

-- Signed in, not banned. Raises a plain-words error otherwise.
create or replace function public.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned_at is not null) then
    raise exception 'Your account can no longer post in Community. Contact the admin if you think this is a mistake.';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.require_member() from public, anon, authenticated;

-- Who wrote a post, tip, comment or chat message (never sent to the app).
create or replace function public.content_author(p_kind text, p_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'post' then (select user_id from public.community_posts where id::text = p_id)
    when 'tip' then (select user_id from public.community_tips where id::text = p_id)
    when 'comment' then (select user_id from public.community_comments where id::text = p_id)
    when 'chat' then (select user_id from public.chat_messages where id::text = p_id)
  end;
$$;
revoke all on function public.content_author(text, text) from public, anon, authenticated;

-- ----- the feed: routes, terminals and tips together -----

create or replace function public.community_feed(p_route_id text)
returns table (
  kind text, id uuid, category text, name text, body text, vehicles text[],
  fare_default numeric, fare_solo numeric, fare_shared numeric, hours text,
  lat double precision, lng double precision, path jsonb, stop_id text,
  status text, review_note text, up int, down int, confirms int, comments int,
  author text, author_driver boolean, mine boolean, my_vote int, my_confirm boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  (select p.kind, p.id, null::text, p.name, p.note, p.vehicles, p.fare_default, p.fare_solo, p.fare_shared, p.hours,
          p.lat, p.lng, p.path, null::text, p.status,
          case when p.user_id = (select auth.uid()) then p.review_note end,
          p.up, p.down, p.confirms, p.comments,
          public.public_name(p.user_id, p.anonymous), not p.anonymous and public.is_driver_account(p.user_id),
          coalesce(p.user_id = (select auth.uid()), false),
          coalesce((select v.value::int from public.post_votes v where v.post_id = p.id and v.user_id = (select auth.uid())), 0),
          exists (select 1 from public.post_confirms c where c.post_id = p.id and c.user_id = (select auth.uid())),
          p.created_at
     from public.community_posts p
    where p.route_id = p_route_id
      and (p.status = 'approved' or (p.user_id = (select auth.uid()) and p.status in ('review', 'rejected')))
      and public.can_see_author(p.user_id)
    order by p.created_at desc
    limit 200)
  union all
  (select 'tip', t.id, t.category, null, t.body, null, null, null, null, null,
          t.lat, t.lng, null, t.stop_id, t.status, null,
          t.helpful, 0, 0, (select count(*)::int from public.community_comments c where c.target_kind = 'tip' and c.target_id = t.id and c.status = 'visible'),
          public.public_name(t.user_id), public.is_driver_account(t.user_id),
          coalesce(t.user_id = (select auth.uid()), false),
          case when exists (select 1 from public.tip_votes v where v.tip_id = t.id and v.user_id = (select auth.uid())) then 1 else 0 end,
          false, t.created_at
     from public.community_tips t
    where t.route_id = p_route_id and t.status = 'visible' and public.can_see_author(t.user_id)
    order by t.created_at desc
    limit 200);
$$;
revoke all on function public.community_feed(text) from public;
grant execute on function public.community_feed(text) to anon, authenticated;

-- Tips everywhere else in the app (map, AI) also skip banned and blocked people.
create or replace function public.list_tips(p_route_id text, p_include_hidden boolean default false)
returns table (
  id uuid, category text, body text, stop_id text, lat double precision, lng double precision,
  helpful int, created_at timestamptz, author text, mine boolean, voted boolean, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.category, t.body, t.stop_id, t.lat, t.lng, t.helpful, t.created_at,
         public.public_name(t.user_id),
         coalesce(t.user_id = (select auth.uid()), false),
         exists (select 1 from public.tip_votes v where v.tip_id = t.id and v.user_id = (select auth.uid())),
         t.status
    from public.community_tips t
   where t.route_id = p_route_id
     and (t.status = 'visible' or (p_include_hidden and public.is_admin()))
     and (public.can_see_author(t.user_id) or (p_include_hidden and public.is_admin()))
   order by t.created_at desc
   limit 200;
$$;

-- Approved tricycle routes and terminals, small enough for the map and
-- the trip planner (no votes or names).
create or replace function public.community_places(p_route_id text)
returns table (id uuid, kind text, name text, vehicles text[], fare_default numeric, fare_solo numeric, fare_shared numeric,
               hours text, lat double precision, lng double precision, path jsonb, confirms int)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.kind, p.name, p.vehicles, p.fare_default, p.fare_solo, p.fare_shared, p.hours, p.lat, p.lng, p.path, p.confirms
    from public.community_posts p
   where p.route_id = p_route_id and p.status = 'approved'
     and not exists (select 1 from public.profiles b where b.id = p.user_id and b.banned_at is not null)
   order by p.created_at desc
   limit 300;
$$;
revoke all on function public.community_places(text) from public;
grant execute on function public.community_places(text) to anon, authenticated;

create or replace function public.create_post(
  p_route_id text, p_kind text, p_name text, p_note text, p_vehicles text[],
  p_fare_default numeric, p_fare_solo numeric, p_fare_shared numeric, p_hours text,
  p_lat double precision, p_lng double precision, p_path jsonb, p_anonymous boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_id uuid;
  v_pt jsonb;
begin
  if (select count(*) from public.community_posts where user_id = v_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have added 5 routes or terminals today. Please try again tomorrow.';
  end if;
  if p_kind = 'local_route' then
    if p_path is null or jsonb_typeof(p_path) <> 'array' or jsonb_array_length(p_path) < 2 then
      raise exception 'Draw the route on the map (at least 2 points).';
    end if;
    for v_pt in select * from jsonb_array_elements(p_path) loop
      if jsonb_typeof(v_pt) <> 'array' or jsonb_array_length(v_pt) <> 2
         or jsonb_typeof(v_pt -> 0) <> 'number' or jsonb_typeof(v_pt -> 1) <> 'number'
         or abs((v_pt ->> 0)::float) > 180 or abs((v_pt ->> 1)::float) > 90 then
        raise exception 'The route drawing is not valid.';
      end if;
    end loop;
  elsif p_kind = 'terminal' then
    p_path := null;
  else
    raise exception 'Choose a route or a terminal.';
  end if;
  insert into public.community_posts (user_id, route_id, kind, name, note, vehicles, fare_default, fare_solo, fare_shared,
                                      hours, lat, lng, path, anonymous)
  values (v_user, left(p_route_id, 60), p_kind, trim(p_name), nullif(trim(p_note), ''), p_vehicles,
          p_fare_default, p_fare_solo, p_fare_shared, nullif(trim(p_hours), ''),
          round(p_lat::numeric, 6), round(p_lng::numeric, 6), p_path, coalesce(p_anonymous, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_post(text, text, text, text, text[], numeric, numeric, numeric, text, double precision, double precision, jsonb, boolean) from public, anon;
grant execute on function public.create_post(text, text, text, text, text[], numeric, numeric, numeric, text, double precision, double precision, jsonb, boolean) to authenticated;

create or replace function public.delete_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_posts where id = p_id and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Post not found, or it is not yours.'; end if;
  delete from public.community_comments where target_kind = 'post' and target_id = p_id;
end;
$$;
revoke all on function public.delete_post(uuid) from public, anon;
grant execute on function public.delete_post(uuid) to authenticated;

-- Up (1), down (-1) or take back (0). Not on your own post.
create or replace function public.vote_post(p_id uuid, p_value int)
returns table (up int, down int, my_vote int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
begin
  if not exists (select 1 from public.community_posts p where p.id = p_id and p.status = 'approved' and p.user_id is distinct from v_user) then
    raise exception 'You cannot vote on this.';
  end if;
  delete from public.post_votes v where v.post_id = p_id and v.user_id = v_user;
  if p_value in (-1, 1) then
    insert into public.post_votes (post_id, user_id, value) values (p_id, v_user, p_value);
  end if;
  update public.community_posts p
     set up = (select count(*) from public.post_votes v where v.post_id = p_id and v.value = 1),
         down = (select count(*) from public.post_votes v where v.post_id = p_id and v.value = -1)
   where p.id = p_id;
  return query select p.up, p.down, case when p_value in (-1, 1) then p_value else 0 end
    from public.community_posts p where p.id = p_id;
end;
$$;
revoke all on function public.vote_post(uuid, int) from public, anon;
grant execute on function public.vote_post(uuid, int) to authenticated;

-- "I've ridden this" / "I've been here": tap again to undo.
create or replace function public.confirm_post(p_id uuid)
returns table (confirms int, my_confirm boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_on boolean;
begin
  if not exists (select 1 from public.community_posts p where p.id = p_id and p.status = 'approved') then
    raise exception 'You cannot confirm this.';
  end if;
  delete from public.post_confirms c where c.post_id = p_id and c.user_id = v_user;
  v_on := not found;
  if v_on then insert into public.post_confirms (post_id, user_id) values (p_id, v_user); end if;
  update public.community_posts p set confirms = (select count(*) from public.post_confirms c where c.post_id = p_id) where p.id = p_id;
  return query select p.confirms, v_on from public.community_posts p where p.id = p_id;
end;
$$;
revoke all on function public.confirm_post(uuid) from public, anon;
grant execute on function public.confirm_post(uuid) to authenticated;

-- ----- comments -----

create or replace function public.list_comments(p_kind text, p_id uuid)
returns table (id uuid, body text, author text, author_driver boolean, mine boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.body, public.public_name(c.user_id), public.is_driver_account(c.user_id),
         c.user_id = (select auth.uid()), c.created_at
    from public.community_comments c
   where c.target_kind = p_kind and c.target_id = p_id and c.status = 'visible'
     and public.can_see_author(c.user_id)
   order by c.created_at
   limit 200;
$$;
revoke all on function public.list_comments(text, uuid) from public;
grant execute on function public.list_comments(text, uuid) to anon, authenticated;

create or replace function public.add_comment(p_kind text, p_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_id uuid;
begin
  if p_kind = 'post' and not exists (select 1 from public.community_posts where id = p_id and status = 'approved') then
    raise exception 'You can comment once this is approved.';
  elsif p_kind = 'tip' and not exists (select 1 from public.community_tips where id = p_id and status = 'visible') then
    raise exception 'This tip is gone.';
  elsif p_kind not in ('post', 'tip') then
    raise exception 'Unknown post.';
  end if;
  if exists (select 1 from public.community_comments where user_id = v_user and created_at > now() - interval '10 seconds') then
    raise exception 'Please wait a moment before commenting again.';
  end if;
  if (select count(*) from public.community_comments where user_id = v_user and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You have written 30 comments today. Please try again tomorrow.';
  end if;
  insert into public.community_comments (target_kind, target_id, user_id, body)
  values (p_kind, p_id, v_user, trim(p_body))
  returning id into v_id;
  if p_kind = 'post' then
    update public.community_posts set comments = comments + 1 where id = p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_comment(text, uuid, text) from public, anon;
grant execute on function public.add_comment(text, uuid, text) to authenticated;

create or replace function public.delete_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_target uuid;
begin
  delete from public.community_comments where id = p_id and (user_id = auth.uid() or public.is_admin())
  returning target_kind, target_id into v_kind, v_target;
  if not found then raise exception 'Comment not found, or it is not yours.'; end if;
  if v_kind = 'post' then
    update public.community_posts set comments = greatest(0, comments - 1) where id = v_target;
  end if;
end;
$$;
revoke all on function public.delete_comment(uuid) from public, anon;
grant execute on function public.delete_comment(uuid) to authenticated;

-- ----- chat -----

-- Messages of the last hour after message number p_after (0 = all).
create or replace function public.list_chat(p_route_id text, p_after bigint default 0)
returns table (id bigint, body text, author text, author_driver boolean, mine boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.body, public.public_name(m.user_id, m.anonymous), not m.anonymous and public.is_driver_account(m.user_id),
         m.user_id = (select auth.uid()), m.created_at
    from public.chat_messages m
   where m.route_id = p_route_id and m.id > coalesce(p_after, 0)
     and m.created_at > now() - interval '1 hour' and m.status = 'visible'
     and public.can_see_author(m.user_id)
   order by m.id
   limit 200;
$$;
revoke all on function public.list_chat(text, bigint) from public;
grant execute on function public.list_chat(text, bigint) to anon, authenticated;

create or replace function public.send_chat(p_route_id text, p_body text, p_anonymous boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_id bigint;
begin
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message first.'; end if;
  if exists (select 1 from public.chat_messages where user_id = v_user and created_at > now() - interval '3 seconds') then
    raise exception 'Slow down: you can send a message every 3 seconds.';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_user and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'You have sent 60 messages this hour. Take a short break.';
  end if;
  delete from public.chat_messages where created_at < now() - interval '1 day';
  insert into public.chat_messages (route_id, user_id, body, anonymous)
  values (left(p_route_id, 60), v_user, trim(p_body), coalesce(p_anonymous, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.send_chat(text, text, boolean) from public, anon;
grant execute on function public.send_chat(text, text, boolean) to authenticated;

create or replace function public.delete_chat(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chat_messages where id = p_id and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Message not found, or it is not yours.'; end if;
end;
$$;
revoke all on function public.delete_chat(bigint) from public, anon;
grant execute on function public.delete_chat(bigint) to authenticated;

-- ----- reporting, blocking, profiles -----

create or replace function public.report_content(p_kind text, p_id text, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_author uuid := public.content_author(p_kind, p_id);
  v_count int;
begin
  if p_kind not in ('post', 'tip', 'comment', 'chat') then raise exception 'Unknown content.'; end if;
  if v_author is null and not exists (select 1 from public.community_posts where p_kind = 'post' and id::text = p_id) then
    raise exception 'That is already gone.';
  end if;
  if v_author = v_user then raise exception 'You can’t report your own content.'; end if;
  if (select count(*) from public.content_reports where reporter = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent 20 reports today. Thank you. Please try again tomorrow.';
  end if;
  insert into public.content_reports (target_kind, target_id, reporter, reason, note)
  values (p_kind, p_id, v_user, p_reason, nullif(left(trim(coalesce(p_note, '')), 300), ''))
  on conflict (target_kind, target_id, reporter) do nothing;
  select count(*) into v_count from public.content_reports where target_kind = p_kind and target_id = p_id and status = 'open';
  -- Three different people: hide it until an admin reviews it.
  if p_kind = 'post' then
    update public.community_posts set reports = v_count, status = case when v_count >= 3 and status = 'approved' then 'hidden' else status end where id::text = p_id;
  elsif p_kind = 'tip' then
    update public.community_tips set status = case when v_count >= 3 then 'hidden' else status end where id::text = p_id;
  elsif p_kind = 'comment' then
    update public.community_comments set reports = v_count, status = case when v_count >= 3 then 'hidden' else status end where id::text = p_id;
  else
    update public.chat_messages set reports = v_count, status = case when v_count >= 3 then 'hidden' else status end where id::text = p_id;
  end if;
end;
$$;
revoke all on function public.report_content(text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated;

-- Block whoever wrote this (the app never learns who that is).
create or replace function public.block_author(p_kind text, p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_member();
  v_author uuid := public.content_author(p_kind, p_id);
begin
  if v_author is null then raise exception 'We can’t block this person.'; end if;
  if v_author = v_user then raise exception 'That’s you.'; end if;
  if (select count(*) from public.user_blocks where blocker = v_user) >= 500 then raise exception 'You have blocked too many people.'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_user, v_author) on conflict do nothing;
end;
$$;
revoke all on function public.block_author(text, text) from public, anon;
grant execute on function public.block_author(text, text) to authenticated;

create or replace function public.list_blocked()
returns table (blocked uuid, name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked, public.public_name(b.blocked), b.created_at
    from public.user_blocks b where b.blocker = (select auth.uid()) order by b.created_at desc;
$$;
revoke all on function public.list_blocked() from public, anon;
grant execute on function public.list_blocked() to authenticated;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.user_blocks where blocker = (select auth.uid()) and blocked = p_user_id;
$$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- A contributor's public card, opened from one of their posts.
create or replace function public.contributor_card(p_kind text, p_id text)
returns table (name text, is_driver boolean, joined timestamptz, routes int, terminals int, tips int, comments int,
               avatar_v bigint, anonymous boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_author uuid := public.content_author(p_kind, p_id);
  v_anon boolean := case p_kind
    when 'post' then (select x.anonymous from public.community_posts x where x.id::text = p_id)
    when 'chat' then (select x.anonymous from public.chat_messages x where x.id::text = p_id)
    else false end;
begin
  if v_author is null or coalesce(v_anon, false) or not public.can_see_author(v_author) then
    return query select 'Anonymous commuter'::text, false, null::timestamptz, 0, 0, 0, 0, null::bigint, true;
    return;
  end if;
  return query select
    public.public_name(v_author), public.is_driver_account(v_author),
    date_trunc('month', (select p.created_at from public.profiles p where p.id = v_author)),
    (select count(*)::int from public.community_posts x where x.user_id = v_author and x.status = 'approved' and x.kind = 'local_route' and not x.anonymous),
    (select count(*)::int from public.community_posts x where x.user_id = v_author and x.status = 'approved' and x.kind = 'terminal' and not x.anonymous),
    (select count(*)::int from public.community_tips x where x.user_id = v_author and x.status = 'visible'),
    (select count(*)::int from public.community_comments x where x.user_id = v_author and x.status = 'visible'),
    public.photo_version(v_author, 'avatar'),
    false;
end;
$$;
revoke all on function public.contributor_card(text, text) from public;
grant execute on function public.contributor_card(text, text) to anon, authenticated;

-- When an account is deleted: pending and rejected posts go with it;
-- approved routes and terminals stay, without the name.
create or replace function public.before_account_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_posts where user_id = old.id and status <> 'approved';
  update public.community_posts set anonymous = true where user_id = old.id;
  delete from public.community_comments where user_id = old.id;
  return old;
end;
$$;
drop trigger if exists before_account_deleted on auth.users;
create trigger before_account_deleted before delete on auth.users for each row execute function public.before_account_deleted();

-- ----- admin -----

create or replace function public.admin_review_queue()
returns table (id uuid, kind text, name text, note text, vehicles text[], fare_default numeric, fare_solo numeric, fare_shared numeric,
               hours text, lat double precision, lng double precision, path jsonb, author text, author_driver boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query select p.id, p.kind, p.name, p.note, p.vehicles, p.fare_default, p.fare_solo, p.fare_shared, p.hours, p.lat, p.lng, p.path,
                      coalesce((select pr.full_name from public.profiles pr where pr.id = p.user_id), 'Deleted account'),
                      public.is_driver_account(p.user_id), p.created_at
    from public.community_posts p where p.status = 'review' order by p.created_at limit 100;
end;
$$;
revoke all on function public.admin_review_queue() from public, anon;
grant execute on function public.admin_review_queue() to authenticated;

create or replace function public.admin_set_post_status(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('review', 'approved', 'rejected', 'hidden') then raise exception 'Unknown status.'; end if;
  update public.community_posts
     set status = p_status, review_note = nullif(left(trim(coalesce(p_note, '')), 200), ''), reviewed_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.admin_set_post_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_post_status(uuid, text, text) to authenticated;

-- Reported content, one row per post / tip / comment / message.
create or replace function public.admin_content_reports()
returns table (target_kind text, target_id text, snippet text, author text, author_id uuid, author_banned boolean,
               target_status text, reports bigint, reasons text[], notes text[], last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
  select r.target_kind, r.target_id,
         case r.target_kind
           when 'post' then (select x.name || coalesce(': ' || x.note, '') from public.community_posts x where x.id::text = r.target_id)
           when 'tip' then (select x.body from public.community_tips x where x.id::text = r.target_id)
           when 'comment' then (select x.body from public.community_comments x where x.id::text = r.target_id)
           else (select x.body from public.chat_messages x where x.id::text = r.target_id) end,
         coalesce((select pr.full_name from public.profiles pr where pr.id = public.content_author(r.target_kind, r.target_id)), 'Unknown'),
         public.content_author(r.target_kind, r.target_id),
         exists (select 1 from public.profiles pr where pr.id = public.content_author(r.target_kind, r.target_id) and pr.banned_at is not null),
         case r.target_kind
           when 'post' then (select x.status from public.community_posts x where x.id::text = r.target_id)
           when 'tip' then (select x.status from public.community_tips x where x.id::text = r.target_id)
           when 'comment' then (select x.status from public.community_comments x where x.id::text = r.target_id)
           else (select x.status from public.chat_messages x where x.id::text = r.target_id) end,
         count(*), array_agg(distinct r.reason), array_remove(array_agg(r.note), null), max(r.created_at)
    from public.content_reports r
   where r.status = 'open'
   group by r.target_kind, r.target_id
   order by max(r.created_at) desc
   limit 200;
end;
$$;
revoke all on function public.admin_content_reports() from public, anon;
grant execute on function public.admin_content_reports() to authenticated;

-- 'dismiss' = it's fine (shows again), 'hide' = keep it hidden, 'delete' = remove it.
create or replace function public.admin_resolve_content(p_kind text, p_id text, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_action not in ('dismiss', 'hide', 'delete') then raise exception 'Unknown action.'; end if;
  if p_action = 'delete' then
    if p_kind = 'post' then delete from public.community_posts where id::text = p_id;
    elsif p_kind = 'tip' then delete from public.community_tips where id::text = p_id;
    elsif p_kind = 'comment' then delete from public.community_comments where id::text = p_id;
    else delete from public.chat_messages where id::text = p_id; end if;
  else
    if p_kind = 'post' then
      update public.community_posts set status = case when p_action = 'hide' then 'hidden' when status = 'hidden' then 'approved' else status end, reports = 0 where id::text = p_id;
    elsif p_kind = 'tip' then
      update public.community_tips set status = case when p_action = 'hide' then 'hidden' else 'visible' end where id::text = p_id;
    elsif p_kind = 'comment' then
      update public.community_comments set status = case when p_action = 'hide' then 'hidden' else 'visible' end, reports = 0 where id::text = p_id;
    else
      update public.chat_messages set status = case when p_action = 'hide' then 'hidden' else 'visible' end, reports = 0 where id::text = p_id;
    end if;
  end if;
  update public.content_reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end
   where target_kind = p_kind and target_id = p_id and status = 'open';
end;
$$;
revoke all on function public.admin_resolve_content(text, text, text) from public, anon;
grant execute on function public.admin_resolve_content(text, text, text) to authenticated;

create or replace function public.admin_ban_user(p_user_id uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_user_id = auth.uid() then raise exception 'You can’t ban yourself.'; end if;
  update public.profiles set banned_at = case when p_banned then now() else null end where id = p_user_id;
end;
$$;
revoke all on function public.admin_ban_user(uuid, boolean) from public, anon;
grant execute on function public.admin_ban_user(uuid, boolean) to authenticated;

create or replace function public.admin_list_banned()
returns table (user_id uuid, name text, banned_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query select p.id, coalesce(p.full_name, 'No name'), p.banned_at from public.profiles p where p.banned_at is not null order by p.banned_at desc;
end;
$$;
revoke all on function public.admin_list_banned() from public, anon;
grant execute on function public.admin_list_banned() to authenticated;

-- ----- ride reports: more reasons, and route problems -----
alter table public.ride_reports add column if not exists vehicle text check (char_length(vehicle) <= 80);
alter table public.ride_reports add column if not exists context text check (char_length(context) <= 300);
alter table public.ride_reports drop constraint if exists ride_reports_category_check;
alter table public.ride_reports add constraint ride_reports_category_check
  check (category in ('overpricing', 'harassment', 'reckless', 'rude', 'other', 'missing_route', 'wrong_route', 'route_problem'));


-- =====================================================================
-- 16. App settings the admin sets in the app: usual first and last trip
--     times for each direction, and contact / support details shown in
--     More. Everyone can read them; only admins can change them. Also:
--     admins can fix approved Community routes and terminals, and riders
--     can send feedback.
-- =====================================================================

create table if not exists public.app_settings (
  key        text primary key check (key in ('service_hours', 'contact')),
  value      jsonb not null check (pg_column_size(value) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.get_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.app_settings s;
$$;
revoke all on function public.get_app_settings() from public;
grant execute on function public.get_app_settings() to anon, authenticated;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dir text;
  v_t text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Settings must be an object.'; end if;
  if p_key = 'service_hours' then
    -- { "to_santa_cruz": { "first": "05:00", "last": "20:00" }, ..., "note": "..." }
    for v_dir in select k from jsonb_object_keys(p_value) k where k <> 'note' loop
      if v_dir !~ '^[a-z_]{2,30}$' or jsonb_typeof(p_value -> v_dir) <> 'object' then raise exception 'Unknown direction.'; end if;
      for v_t in select x from jsonb_array_elements_text(jsonb_build_array(p_value -> v_dir ->> 'first', p_value -> v_dir ->> 'last')) x loop
        if v_t is not null and v_t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Times must look like 05:30 or 20:00.'; end if;
      end loop;
    end loop;
    if char_length(coalesce(p_value ->> 'note', '')) > 200 then raise exception 'The note is too long.'; end if;
  elsif p_key = 'contact' then
    -- { "email", "phone", "facebook", "donate" }: short plain text only.
    if exists (select 1 from jsonb_each(p_value) e where e.key not in ('email', 'phone', 'facebook', 'donate') or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 200) then
      raise exception 'Contact details: email, phone, facebook and donate only (short text).';
    end if;
    if coalesce(p_value ->> 'email', '') <> '' and p_value ->> 'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right.'; end if;
    if coalesce(p_value ->> 'facebook', '') <> '' and p_value ->> 'facebook' !~ '^https://(www\.|m\.)?(facebook\.com|fb\.com|m\.me)/' then raise exception 'The Facebook link must start with https://facebook.com/ or https://m.me/'; end if;
  else
    raise exception 'Unknown setting.';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.admin_set_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;

-- Admin: Community routes and terminals of one status (to fix approved ones).
create or replace function public.admin_list_posts(p_status text)
returns table (id uuid, kind text, name text, note text, vehicles text[], fare_default numeric, fare_solo numeric, fare_shared numeric,
               hours text, lat double precision, lng double precision, path jsonb, author text, author_driver boolean, created_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query select p.id, p.kind, p.name, p.note, p.vehicles, p.fare_default, p.fare_solo, p.fare_shared, p.hours, p.lat, p.lng, p.path,
                      coalesce((select pr.full_name from public.profiles pr where pr.id = p.user_id), 'Deleted account'),
                      public.is_driver_account(p.user_id), p.created_at, p.status
    from public.community_posts p where p.status = p_status order by p.created_at desc limit 200;
end;
$$;
revoke all on function public.admin_list_posts(text) from public, anon;
grant execute on function public.admin_list_posts(text) to authenticated;

create or replace function public.admin_update_post(
  p_id uuid, p_name text, p_note text, p_vehicles text[],
  p_fare_default numeric, p_fare_solo numeric, p_fare_shared numeric, p_hours text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.community_posts
     set name = trim(p_name), note = nullif(trim(p_note), ''), vehicles = p_vehicles,
         fare_default = p_fare_default, fare_solo = p_fare_solo, fare_shared = p_fare_shared,
         hours = nullif(trim(p_hours), ''), reviewed_at = now()
   where id = p_id;
  if not found then raise exception 'Post not found.'; end if;
end;
$$;
revoke all on function public.admin_update_post(uuid, text, text, text[], numeric, numeric, numeric, text) from public, anon;
grant execute on function public.admin_update_post(uuid, text, text, text[], numeric, numeric, numeric, text) to authenticated;

-- Feedback from the app goes with the other reports to the admin.
alter table public.ride_reports drop constraint if exists ride_reports_category_check;
alter table public.ride_reports add constraint ride_reports_category_check
  check (category in ('overpricing', 'harassment', 'reckless', 'rude', 'other', 'missing_route', 'wrong_route', 'route_problem', 'feedback'));
