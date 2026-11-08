-- Stage 4: access management and a view-only coach role.

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------

create function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.has_role('admin');
$$;

create function public.is_coach()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.has_role('coach');
$$;

-- Everyone who manages the club today can also manage access, so someone can
-- use the new screen.
insert into public.user_role (user_id, role)
select user_id, 'admin' from public.user_role where role = 'committee'
on conflict do nothing;

-- Roles are visible to their holder and to admins (no longer to committee).
drop policy "read own roles, committee reads all" on public.user_role;
create policy "read own roles, admins read all" on public.user_role
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Invitations: a role waiting for someone to sign in with that email.
-- ---------------------------------------------------------------------------

create table public.role_invite (
  email text not null check (email = lower(btrim(email)) and email like '%@%'),
  role public.app_role not null,
  invited_by uuid default auth.uid(),
  invited_at timestamptz not null default now(),
  primary key (email, role)
);

alter table public.role_invite enable row level security;
grant select, delete on public.role_invite to authenticated;
create policy "admins read invites" on public.role_invite
  for select to authenticated using ((select public.is_admin()));
create policy "admins cancel invites" on public.role_invite
  for delete to authenticated using ((select public.is_admin()));

create trigger role_invite_audit after insert or update or delete on public.role_invite
  for each row execute function public.audit_trigger();

-- When a sign-in account's email is confirmed (Google sign-ins arrive
-- confirmed), turn any invitations for that email into roles.
create function public.apply_role_invites()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.user_role (user_id, role)
  select new.id, i.role from public.role_invite i where i.email = lower(new.email)
  on conflict do nothing;
  delete from public.role_invite where email = lower(new.email);
  return null;
end;
$$;

revoke execute on function public.apply_role_invites() from public, anon, authenticated;

create trigger apply_role_invites
  after insert or update of email_confirmed_at, email on auth.users
  for each row
  when (new.email_confirmed_at is not null and new.email is not null)
  execute function public.apply_role_invites();

-- ---------------------------------------------------------------------------
-- Admin functions. Role changes only happen through these, so the checks
-- cannot be bypassed.
-- ---------------------------------------------------------------------------

create function public.require_admin()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage access' using errcode = '42501';
  end if;
end;
$$;

-- Everyone who has signed in, with their roles (including people with none).
create function public.list_app_users()
returns table (user_id uuid, email text, last_sign_in_at timestamptz, roles public.app_role[])
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
    select u.id, u.email::text, u.last_sign_in_at,
           coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
    from auth.users u
    left join public.user_role r on r.user_id = u.id
    group by u.id, u.email, u.last_sign_in_at
    order by lower(u.email::text);
end;
$$;

create function public.grant_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  insert into public.user_role (user_id, role) values (p_user_id, p_role)
  on conflict do nothing;
end;
$$;

create function public.revoke_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  -- Serialise admin removals so two admins can't remove each other at once.
  perform pg_advisory_xact_lock(hashtext('wfsc.revoke_admin'));
  if p_role = 'admin'
     and exists (select 1 from public.user_role where user_id = p_user_id and role = 'admin')
     and (select count(*) from public.user_role where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin.' using errcode = 'P0001';
  end if;
  delete from public.user_role where user_id = p_user_id and role = p_role;
end;
$$;

-- Invite by email. If someone with that confirmed email has already signed
-- in, they get the role straight away ('granted'); otherwise it waits for
-- their first sign-in ('invited').
create function public.invite_user(p_email text, p_role public.app_role)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  perform public.require_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'That does not look like an email address.' using errcode = 'P0001';
  end if;

  select id into v_user from auth.users
  where lower(email) = v_email and email_confirmed_at is not null
  limit 1;

  if v_user is not null then
    insert into public.user_role (user_id, role) values (v_user, p_role) on conflict do nothing;
    return 'granted';
  end if;

  insert into public.role_invite (email, role) values (v_email, p_role) on conflict do nothing;
  return 'invited';
end;
$$;

revoke execute on function
  public.require_admin(), public.list_app_users(),
  public.grant_role(uuid, public.app_role), public.revoke_role(uuid, public.app_role),
  public.invite_user(text, public.app_role)
  from public, anon;
grant execute on function
  public.is_admin(), public.is_coach(), public.list_app_users(),
  public.grant_role(uuid, public.app_role), public.revoke_role(uuid, public.app_role),
  public.invite_user(text, public.app_role)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Coach access: view-only skate school data.
-- ---------------------------------------------------------------------------

-- Skaters in a term: names and ages only. Dates of birth, contact details and
-- membership data are never returned to coaches; membership numbers are only
-- returned to the committee.
create function public.term_skaters(p_term_id uuid)
returns table (
  person_id uuid,
  class_id uuid,
  first_name text,
  last_name text,
  membership_number text,
  age integer,
  age_at_term_start integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_committee boolean := public.is_committee();
  v_today date := (now() at time zone 'Pacific/Auckland')::date;
begin
  if not (v_committee or public.is_coach()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, e.class_id, p.first_name, p.last_name,
           case when v_committee then p.membership_number end,
           extract(year from pg_catalog.age(v_today, p.date_of_birth))::integer,
           extract(year from pg_catalog.age(t.starts_on, p.date_of_birth))::integer
    from public.enrolment e
    join public.person p on p.id = e.person_id
    join public.term t on t.id = e.term_id
    where e.term_id = p_term_id
    order by lower(p.last_name), lower(p.first_name);
end;
$$;

revoke execute on function public.term_skaters(uuid) from public, anon;
grant execute on function public.term_skaters(uuid) to authenticated;

-- Coaches can read the skate school structure and the badge catalogue.
do $$
declare
  t text;
begin
  foreach t in array array[
    'term', 'skate_class', 'skate_class_badge', 'enrolment',
    'badge_stream', 'badge', 'badge_skill'
  ] loop
    execute format(
      'create policy "coaches read" on public.%I
         for select to authenticated using ((select public.is_coach()))', t);
  end loop;
end;
$$;

-- ...and the progress of skaters who are enrolled in a class (any term).
create policy "coaches read enrolled skaters' progress" on public.skill_achievement
  for select to authenticated
  using ((select public.is_coach())
         and exists (select 1 from public.enrolment e where e.person_id = skill_achievement.person_id));

create policy "coaches read enrolled skaters' passes" on public.badge_pass
  for select to authenticated
  using ((select public.is_coach())
         and exists (select 1 from public.enrolment e where e.person_id = badge_pass.person_id));
