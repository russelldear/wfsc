-- Stage 1: people, memberships, contacts, roles and an audit log.
--
-- Model:
--   person             one row per human. Members, and later skaters, are people.
--   membership         one paid membership for one season (1 Oct to 30 Sep),
--                      either individual or family.
--   membership_member  which people a membership covers. Each person has at
--                      most one membership per season.
--   contact            guardians and emergency contacts for a person.
--
-- Security: every table has row level security. In this stage only users with
-- the 'committee' role can read or change anything. Signing in alone grants
-- nothing.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('committee');

create table public.user_role (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- security definer so policies can call it without recursing into
-- user_role's own policies.
create function public.has_role(p_role public.app_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_role
    where user_id = (select auth.uid()) and role = p_role
  );
$$;

create function public.is_committee()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.has_role('committee');
$$;

-- ---------------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------------

-- Gender and ethnicity are collected for NZIFSA and Sport NZ reporting.
-- Both are optional and both offer "Prefer not to say".
create table public.gender (
  code text primary key,
  label text not null unique,
  sort_order smallint not null default 0
);

insert into public.gender (code, label, sort_order) values
  ('female', 'Female', 1),
  ('male', 'Male', 2),
  ('another', 'Another gender', 3),
  ('not_stated', 'Prefer not to say', 4);

-- Stats NZ level 1 ethnic groups. A person may select more than one.
create table public.ethnicity (
  code text primary key,
  label text not null unique,
  sort_order smallint not null default 0
);

insert into public.ethnicity (code, label, sort_order) values
  ('european', 'European', 1),
  ('maori', 'Māori', 2),
  ('pacific', 'Pacific Peoples', 3),
  ('asian', 'Asian', 4),
  ('melaa', 'Middle Eastern / Latin American / African', 5),
  ('other', 'Other ethnicity', 6),
  ('not_stated', 'Prefer not to say', 7);

-- Membership types are club data, so the committee manages them in the app.
create table public.member_type (
  id smallint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- New membership numbers continue from the highest existing one.
-- After importing existing members, run:
--   select setval('public.membership_number_seq',
--                 (select max(membership_number) from public.person));
create sequence public.membership_number_seq;

create table public.person (
  id uuid primary key default gen_random_uuid(),
  -- Assigned automatically when the person first joins a membership.
  membership_number integer unique check (membership_number > 0),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  date_of_birth date check (date_of_birth >= date '1900-01-01'),
  gender_code text references public.gender (code),
  address_line text,
  town_city text,
  postcode text,
  country text,
  email text,
  phone text,
  -- Whether they are also in the skate school. Replaced by real skate school
  -- records in a later stage.
  in_skate_school boolean not null default false,
  member_since date,
  coc_agreed_on date,
  waiver_agreed_on date,
  nzifsa_share_agreed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index person_name_idx on public.person (lower(last_name), lower(first_name));

create table public.person_ethnicity (
  person_id uuid not null references public.person (id) on delete cascade,
  ethnicity_code text not null references public.ethnicity (code),
  primary key (person_id, ethnicity_code)
);

create table public.person_other_club (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  club_name text not null check (btrim(club_name) <> ''),
  unique (person_id, club_name)
);

create table public.contact (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  relationship text,
  phone text,
  email text,
  is_guardian boolean not null default false,
  created_at timestamptz not null default now()
);

create index contact_person_idx on public.contact (person_id);

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------

create type public.membership_kind as enum ('individual', 'family');

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  kind public.membership_kind not null,
  season_start date not null
    check (extract(month from season_start) = 10 and extract(day from season_start) = 1),
  expires_on date generated always as
    ((season_start + interval '1 year' - interval '1 day')::date) stored,
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets membership_member carry the season, so "one membership per person
  -- per season" can be a plain unique constraint.
  unique (id, season_start)
);

create table public.membership_member (
  membership_id uuid not null,
  -- Copied from the membership by trigger; callers do not need to send it.
  season_start date not null,
  person_id uuid not null references public.person (id),
  member_type_id smallint references public.member_type (id),
  card_issued_on date,
  primary key (membership_id, person_id),
  foreign key (membership_id, season_start)
    references public.membership (id, season_start)
    on delete cascade on update cascade,
  unique (person_id, season_start)
);

create index membership_member_person_idx on public.membership_member (person_id);

create function public.membership_member_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select m.season_start into new.season_start
  from public.membership m
  where m.id = new.membership_id;
  return new;
end;
$$;

create trigger membership_member_set_season
  before insert on public.membership_member
  for each row execute function public.membership_member_before_insert();

-- An individual membership covers exactly one person.
create function public.membership_member_check_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select kind from public.membership where id = new.membership_id) = 'individual'
     and (select count(*) from public.membership_member
          where membership_id = new.membership_id) > 1 then
    raise exception 'An individual membership can only cover one person'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger membership_member_kind_check
  after insert or update on public.membership_member
  for each row execute function public.membership_member_check_kind();

-- Give a person a membership number the first time they join a membership.
create function public.membership_member_assign_number()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.person
  set membership_number = nextval('public.membership_number_seq')
  where id = new.person_id and membership_number is null;
  return null;
end;
$$;

create trigger membership_member_assign_number
  after insert on public.membership_member
  for each row execute function public.membership_member_assign_number();

-- The membership season that contains today, in New Zealand time.
create function public.current_season_start()
returns date
language sql stable
set search_path = ''
as $$
  select make_date(
    extract(year from local_now)::int
      - case when extract(month from local_now) < 10 then 1 else 0 end,
    10, 1)
  from (select now() at time zone 'Pacific/Auckland' as local_now) t;
$$;

-- Each person with their most recent membership.
create view public.member_summary
with (security_invoker = true)
as
select
  p.id,
  p.membership_number,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  p.date_of_birth,
  p.in_skate_school,
  latest.membership_id,
  latest.kind,
  latest.season_start,
  latest.expires_on,
  latest.member_type,
  coalesce(latest.expires_on >= (now() at time zone 'Pacific/Auckland')::date, false)
    as is_current
from public.person p
left join lateral (
  select
    m.id as membership_id,
    m.kind,
    m.season_start,
    m.expires_on,
    mt.name as member_type
  from public.membership_member mm
  join public.membership m on m.id = mm.membership_id
  left join public.member_type mt on mt.id = mm.member_type_id
  where mm.person_id = p.id
  order by m.season_start desc
  limit 1
) latest on true;

-- ---------------------------------------------------------------------------
-- Write operations that touch several tables, done atomically.
-- security invoker: row level security still applies to the caller.
-- ---------------------------------------------------------------------------

-- Create or update a person with their contacts, ethnicities and other clubs.
-- p_person: person columns as JSON, with "id" for an update.
-- p_contacts: array of contact objects; those with "id" are updated, those
--   without are inserted, and existing contacts not listed are deleted.
create function public.save_person(
  p_person jsonb,
  p_contacts jsonb default '[]'::jsonb,
  p_ethnicities text[] default '{}',
  p_other_clubs text[] default '{}'
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_person ->> 'id', '')::uuid;
  v_row public.person;
begin
  v_row := jsonb_populate_record(null::public.person, p_person);

  if v_id is null then
    insert into public.person (
      membership_number, first_name, last_name, date_of_birth, gender_code,
      address_line, town_city, postcode, country, email, phone,
      in_skate_school, member_since, coc_agreed_on, waiver_agreed_on,
      nzifsa_share_agreed_on
    ) values (
      v_row.membership_number, v_row.first_name, v_row.last_name,
      v_row.date_of_birth, v_row.gender_code, v_row.address_line,
      v_row.town_city, v_row.postcode, v_row.country, v_row.email, v_row.phone,
      coalesce(v_row.in_skate_school, false), v_row.member_since,
      v_row.coc_agreed_on, v_row.waiver_agreed_on, v_row.nzifsa_share_agreed_on
    )
    returning id into v_id;
  else
    update public.person set
      membership_number = v_row.membership_number,
      first_name = v_row.first_name,
      last_name = v_row.last_name,
      date_of_birth = v_row.date_of_birth,
      gender_code = v_row.gender_code,
      address_line = v_row.address_line,
      town_city = v_row.town_city,
      postcode = v_row.postcode,
      country = v_row.country,
      email = v_row.email,
      phone = v_row.phone,
      in_skate_school = coalesce(v_row.in_skate_school, false),
      member_since = v_row.member_since,
      coc_agreed_on = v_row.coc_agreed_on,
      waiver_agreed_on = v_row.waiver_agreed_on,
      nzifsa_share_agreed_on = v_row.nzifsa_share_agreed_on
    where id = v_id;
    if not found then
      raise exception 'Person not found' using errcode = 'P0002';
    end if;
  end if;

  -- Contacts
  delete from public.contact c
  where c.person_id = v_id
    and c.id not in (
      select (x ->> 'id')::uuid
      from jsonb_array_elements(p_contacts) x
      where nullif(x ->> 'id', '') is not null
    );

  update public.contact c set
    name = x ->> 'name',
    relationship = nullif(x ->> 'relationship', ''),
    phone = nullif(x ->> 'phone', ''),
    email = nullif(x ->> 'email', ''),
    is_guardian = coalesce((x ->> 'is_guardian')::boolean, false)
  from jsonb_array_elements(p_contacts) x
  where nullif(x ->> 'id', '') is not null
    and c.id = (x ->> 'id')::uuid
    and c.person_id = v_id;

  insert into public.contact (person_id, name, relationship, phone, email, is_guardian)
  select
    v_id,
    x ->> 'name',
    nullif(x ->> 'relationship', ''),
    nullif(x ->> 'phone', ''),
    nullif(x ->> 'email', ''),
    coalesce((x ->> 'is_guardian')::boolean, false)
  from jsonb_array_elements(p_contacts) x
  where nullif(x ->> 'id', '') is null;

  -- Ethnicities
  delete from public.person_ethnicity
  where person_id = v_id and ethnicity_code <> all (p_ethnicities);

  insert into public.person_ethnicity (person_id, ethnicity_code)
  select v_id, e from unnest(p_ethnicities) e
  on conflict do nothing;

  -- Other clubs
  delete from public.person_other_club
  where person_id = v_id
    and club_name <> all (select btrim(c) from unnest(p_other_clubs) c);

  insert into public.person_other_club (person_id, club_name)
  select distinct v_id, btrim(c) from unnest(p_other_clubs) c
  where btrim(c) <> ''
  on conflict do nothing;

  return v_id;
end;
$$;

-- Create a membership covering one or more people.
-- p_members: array of {"person_id": ..., "member_type_id": ...}
create function public.create_membership(
  p_kind public.membership_kind,
  p_season_start date,
  p_paid_on date,
  p_members jsonb
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if jsonb_array_length(p_members) = 0 then
    raise exception 'A membership must cover at least one person' using errcode = 'P0001';
  end if;

  insert into public.membership (kind, season_start, paid_on)
  values (p_kind, p_season_start, p_paid_on)
  returning id into v_id;

  insert into public.membership_member (membership_id, person_id, member_type_id)
  select v_id, (x ->> 'person_id')::uuid, nullif(x ->> 'member_type_id', '')::smallint
  from jsonb_array_elements(p_members) x;

  return v_id;
end;
$$;

-- Renew a membership: same kind, same people, same member types.
-- The new season is the one after the old membership's season, or the
-- current season if the old one lapsed more than a season ago.
create function public.renew_membership(
  p_membership_id uuid,
  p_paid_on date default null
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_old public.membership;
  v_season date;
  v_id uuid;
begin
  select * into v_old from public.membership where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  v_season := greatest(
    (v_old.season_start + interval '1 year')::date,
    public.current_season_start()
  );

  insert into public.membership (kind, season_start, paid_on)
  values (
    v_old.kind,
    v_season,
    coalesce(p_paid_on, (now() at time zone 'Pacific/Auckland')::date)
  )
  returning id into v_id;

  insert into public.membership_member (membership_id, person_id, member_type_id)
  select v_id, person_id, member_type_id
  from public.membership_member
  where membership_id = p_membership_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger person_updated_at before update on public.person
  for each row execute function public.set_updated_at();
create trigger membership_updated_at before update on public.membership
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log: who changed what, and when.
-- Written only by trigger. Nobody can edit or delete entries through the API.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index audit_log_record_idx on public.audit_log (table_name, record_id);

create function public.audit_trigger()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'person_id', v_row ->> 'user_id'),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    (select auth.uid())
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'person', 'person_ethnicity', 'person_other_club', 'contact',
    'membership', 'membership_member', 'member_type', 'user_role'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()',
      t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Explicit, rather than relying on Supabase's defaults.
-- ---------------------------------------------------------------------------

-- Future tables and functions get no access by default either: each migration
-- must grant what it needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.gender, public.ethnicity to authenticated;
grant select, insert, update on public.member_type to authenticated;
grant select on public.user_role to authenticated;
grant select, insert, update on public.person to authenticated;
grant select, insert, update, delete on
  public.person_ethnicity, public.person_other_club, public.contact,
  public.membership, public.membership_member
  to authenticated;
grant select on public.member_summary to authenticated;
grant select on public.audit_log to authenticated;

grant execute on function
  public.has_role(public.app_role),
  public.is_committee(),
  public.current_season_start(),
  public.save_person(jsonb, jsonb, text[], text[]),
  public.create_membership(public.membership_kind, date, date, jsonb),
  public.renew_membership(uuid, date)
  to authenticated;

-- Trigger functions run via triggers; they need no direct grants.

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.user_role enable row level security;
alter table public.gender enable row level security;
alter table public.ethnicity enable row level security;
alter table public.member_type enable row level security;
alter table public.person enable row level security;
alter table public.person_ethnicity enable row level security;
alter table public.person_other_club enable row level security;
alter table public.contact enable row level security;
alter table public.membership enable row level security;
alter table public.membership_member enable row level security;
alter table public.audit_log enable row level security;

-- A signed-in user can see their own roles (so the app knows what to show).
-- Roles are granted with SQL by an administrator, not through the app.
create policy "read own roles, committee reads all" on public.user_role
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_committee()));

create policy "signed-in users read genders" on public.gender
  for select to authenticated using (true);
create policy "signed-in users read ethnicities" on public.ethnicity
  for select to authenticated using (true);

create policy "committee reads member types" on public.member_type
  for select to authenticated using ((select public.is_committee()));
create policy "committee adds member types" on public.member_type
  for insert to authenticated with check ((select public.is_committee()));
create policy "committee edits member types" on public.member_type
  for update to authenticated
  using ((select public.is_committee())) with check ((select public.is_committee()));

do $$
declare
  t text;
begin
  -- Tables where the committee can read, add and edit.
  foreach t in array array[
    'person', 'person_ethnicity', 'person_other_club', 'contact',
    'membership', 'membership_member'
  ] loop
    execute format(
      'create policy "committee reads" on public.%I
         for select to authenticated using ((select public.is_committee()))', t);
    execute format(
      'create policy "committee adds" on public.%I
         for insert to authenticated with check ((select public.is_committee()))', t);
    execute format(
      'create policy "committee edits" on public.%I
         for update to authenticated
         using ((select public.is_committee()))
         with check ((select public.is_committee()))', t);
  end loop;

  -- People cannot be deleted in this stage (no delete grant on person).
  -- Child records and memberships can be removed by the committee.
  foreach t in array array[
    'person_ethnicity', 'person_other_club', 'contact',
    'membership', 'membership_member'
  ] loop
    execute format(
      'create policy "committee removes" on public.%I
         for delete to authenticated using ((select public.is_committee()))', t);
  end loop;
end;
$$;

create policy "committee reads audit log" on public.audit_log
  for select to authenticated using ((select public.is_committee()));
