-- Membership numbers are text in the club's format: two-digit year of joining,
-- a slash, and a counter that runs on across years, e.g. 22/006.

-- The view depends on the column, so it is dropped and recreated around the change.
drop view public.member_summary;

alter table public.person drop constraint person_membership_number_check;

-- Existing numbers (only made-up staging data at this point) become
-- <current year>/<number padded to three digits>.
alter table public.person
  alter column membership_number type text
  using case
    when membership_number is null then null
    else to_char(now() at time zone 'Pacific/Auckland', 'YY') || '/'
         || lpad(membership_number::text, greatest(3, length(membership_number::text)), '0')
  end;

alter table public.person
  add constraint person_membership_number_format
  check (membership_number ~ '^[0-9]{2}/[0-9]{3,}$');

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

grant select on public.member_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Next number: this year's two digits and one more than the highest counter
-- in use. The lock stops two simultaneous additions getting the same number.
-- security definer so it sees every person regardless of the caller.
-- ---------------------------------------------------------------------------

create function public.next_membership_number()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('wfsc.membership_number'));
  select coalesce(max(split_part(membership_number, '/', 2)::integer), 0) + 1
  into v_next
  from public.person
  where membership_number is not null;
  return to_char(now() at time zone 'Pacific/Auckland', 'YY') || '/'
         || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;

revoke execute on function public.next_membership_number() from public, anon, authenticated;

create or replace function public.membership_member_assign_number()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.person
  set membership_number = public.next_membership_number()
  where id = new.person_id and membership_number is null;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Import: rows that bring their own number go first, so numbers generated for
-- the rest come after every number in the file.
-- ---------------------------------------------------------------------------

create or replace function public.import_members(p_rows jsonb)
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_person_id uuid;
  v_membership_id uuid;
  v_count integer := 0;
  v_line text;
begin
  for v_row in
    select r from jsonb_array_elements(p_rows) with ordinality as t(r, n)
    order by nullif(r -> 'person' ->> 'membership_number', '') is null, n
  loop
    v_line := coalesce(v_row ->> 'line', (v_count + 1)::text);
    begin
      v_person_id := public.save_person(
        v_row -> 'person',
        coalesce(v_row -> 'contacts', '[]'::jsonb),
        coalesce(array(select jsonb_array_elements_text(v_row -> 'ethnicities')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_row -> 'other_clubs')), '{}')
      );

      if jsonb_typeof(v_row -> 'membership') = 'object' then
        v_membership_id := public.create_membership(
          (v_row -> 'membership' ->> 'kind')::public.membership_kind,
          (v_row -> 'membership' ->> 'season_start')::date,
          nullif(v_row -> 'membership' ->> 'paid_on', '')::date,
          jsonb_build_array(jsonb_build_object(
            'person_id', v_person_id,
            'member_type_id', v_row -> 'membership' -> 'member_type_id'))
        );
        if nullif(v_row -> 'membership' ->> 'card_issued_on', '') is not null then
          update public.membership_member
          set card_issued_on = (v_row -> 'membership' ->> 'card_issued_on')::date
          where membership_id = v_membership_id and person_id = v_person_id;
        end if;
      end if;
    exception when others then
      raise exception 'Row %: %', v_line, sqlerrm using errcode = sqlstate;
    end;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- The integer sequence and its helper are no longer used.
drop function public.sync_membership_number_seq(integer);
drop sequence public.membership_number_seq;
