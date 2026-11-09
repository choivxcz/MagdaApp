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
