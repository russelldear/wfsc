-- Import, member types and badge editing are admin-only.
-- The committee keeps read access to member types and badges (membership
-- screens and skater progress need them); admins can read them too, so the
-- admin pages work for an admin who is not on the committee.

-- Member types: admins add and rename.
drop policy "committee adds member types" on public.member_type;
drop policy "committee edits member types" on public.member_type;
create policy "admins read member types" on public.member_type
  for select to authenticated using ((select public.is_admin()));
create policy "admins add member types" on public.member_type
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit member types" on public.member_type
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Badges and skills: admins edit.
drop policy "committee edits" on public.badge;
create policy "admins edit" on public.badge
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy "committee adds" on public.badge_skill;
drop policy "committee edits" on public.badge_skill;
drop policy "committee removes" on public.badge_skill;
create policy "admins add" on public.badge_skill
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit" on public.badge_skill
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove" on public.badge_skill
  for delete to authenticated using ((select public.is_admin()));

do $$
declare
  t text;
begin
  foreach t in array array['badge_stream', 'badge', 'badge_skill'] loop
    execute format(
      'create policy "admins read" on public.%I
         for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;

-- Import: admins only. (It also creates people, which needs the committee role.)
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
  if not public.is_admin() then
    raise exception 'Only an admin can import members' using errcode = '42501';
  end if;

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
