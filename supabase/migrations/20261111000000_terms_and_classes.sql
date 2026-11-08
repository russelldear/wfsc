-- Stage 3b: terms, classes and enrolments.
-- "In skate school" is no longer a stored flag: it means enrolled in a class
-- in the current term.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.term (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.skate_class (
  id uuid primary key default gen_random_uuid(),
  -- A term with classes cannot be deleted; remove its classes first.
  term_id uuid not null references public.term (id),
  name text not null check (btrim(name) <> ''),
  starts_at time,
  ends_at time,
  -- Age guidance (e.g. "Adults (age 16+)"). Enrolling outside it warns only.
  min_age smallint check (min_age > 0),
  max_age smallint check (max_age > 0),
  coach_name text,
  created_at timestamptz not null default now(),
  unique (term_id, name),
  unique (id, term_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (max_age is null or min_age is null or max_age >= min_age)
);

create table public.skate_class_badge (
  class_id uuid not null references public.skate_class (id) on delete cascade,
  badge_id smallint not null references public.badge (id),
  primary key (class_id, badge_id)
);

create table public.enrolment (
  class_id uuid not null,
  -- Copied from the class by trigger, so "one class per term" can be a
  -- plain unique constraint.
  term_id uuid not null,
  person_id uuid not null references public.person (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (class_id, person_id),
  foreign key (class_id, term_id)
    references public.skate_class (id, term_id)
    on delete cascade on update cascade,
  unique (person_id, term_id)
);

create index enrolment_term_idx on public.enrolment (term_id);

create function public.enrolment_set_term()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select c.term_id into new.term_id from public.skate_class c where c.id = new.class_id;
  return new;
end;
$$;

create trigger enrolment_set_term
  before insert or update of class_id on public.enrolment
  for each row execute function public.enrolment_set_term();

-- The latest term that has started (in New Zealand time). Between terms this
-- is the one just finished, so skaters don't drop out over the holidays.
create function public.current_term_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select id from public.term
  where starts_on <= (now() at time zone 'Pacific/Auckland')::date
  order by starts_on desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Replace the stored "in skate school" flag
-- ---------------------------------------------------------------------------

drop view public.member_summary;

alter table public.person drop column in_skate_school;

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
  exists (
    select 1 from public.enrolment e
    where e.person_id = p.id and e.term_id = public.current_term_id()
  ) as in_skate_school,
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

grant select on public.member_summary to authenticated;

-- save_person, without the removed column.
create or replace function public.save_person(
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
      member_since, coc_agreed_on, waiver_agreed_on, nzifsa_share_agreed_on
    ) values (
      v_row.membership_number, v_row.first_name, v_row.last_name,
      v_row.date_of_birth, v_row.gender_code, v_row.address_line,
      v_row.town_city, v_row.postcode, v_row.country, v_row.email, v_row.phone,
      v_row.member_since, v_row.coc_agreed_on, v_row.waiver_agreed_on,
      v_row.nzifsa_share_agreed_on
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
      member_since = v_row.member_since,
      coc_agreed_on = v_row.coc_agreed_on,
      waiver_agreed_on = v_row.waiver_agreed_on,
      nzifsa_share_agreed_on = v_row.nzifsa_share_agreed_on
    where id = v_id;
    if not found then
      raise exception 'Person not found' using errcode = 'P0002';
    end if;
  end if;

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

  delete from public.person_ethnicity
  where person_id = v_id and ethnicity_code <> all (p_ethnicities);

  insert into public.person_ethnicity (person_id, ethnicity_code)
  select v_id, e from unnest(p_ethnicities) e
  on conflict do nothing;

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

-- ---------------------------------------------------------------------------
-- Audit, privileges, row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['term', 'skate_class', 'skate_class_badge', 'enrolment'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()',
      t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
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
    execute format(
      'create policy "committee removes" on public.%I
         for delete to authenticated using ((select public.is_committee()))', t);
  end loop;
end;
$$;

grant execute on function public.current_term_id() to authenticated;
