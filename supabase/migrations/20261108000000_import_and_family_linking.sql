-- Stage 2: importing existing members, and linking family members afterwards.

-- ---------------------------------------------------------------------------
-- Keep the membership number sequence ahead of every number in use.
-- p_at_least lets the import reserve numbers it is about to insert.
-- security definer: callers have no rights on the sequence itself.
-- ---------------------------------------------------------------------------

create function public.sync_membership_number_seq(p_at_least integer default 0)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_target integer;
  v_current integer;
begin
  if not public.is_committee() then
    raise exception 'Only the committee can do that' using errcode = '42501';
  end if;

  select greatest(coalesce(max(membership_number), 0), coalesce(p_at_least, 0))
  into v_target
  from public.person;

  select case when is_called then last_value else 0 end
  into v_current
  from public.membership_number_seq;

  if v_target > v_current then
    perform setval('public.membership_number_seq', v_target, true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Move a person onto a family membership.
-- If they already hold a membership for that season on their own (as after an
-- import, where each family member arrives separately), that membership is
-- replaced. Their member type and card date carry over unless given.
-- ---------------------------------------------------------------------------

create function public.join_family_membership(
  p_membership_id uuid,
  p_person_id uuid,
  p_member_type_id smallint default null
)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_target public.membership;
  v_existing_id uuid;
  v_existing_type smallint;
  v_existing_card date;
  v_count integer;
begin
  select * into v_target from public.membership where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if v_target.kind <> 'family' then
    raise exception 'Only a family membership can cover more than one person'
      using errcode = 'P0001';
  end if;

  select mm.membership_id, mm.member_type_id, mm.card_issued_on
  into v_existing_id, v_existing_type, v_existing_card
  from public.membership_member mm
  where mm.person_id = p_person_id and mm.season_start = v_target.season_start;

  if v_existing_id = p_membership_id then
    raise exception 'That person is already on this membership' using errcode = 'P0001';
  end if;

  if v_existing_id is not null then
    select count(*) into v_count
    from public.membership_member
    where membership_id = v_existing_id;
    if v_count > 1 then
      raise exception 'That person is on another family membership for this season. Remove them from it first.'
        using errcode = 'P0001';
    end if;
    delete from public.membership where id = v_existing_id;
  end if;

  insert into public.membership_member (membership_id, person_id, member_type_id, card_issued_on)
  values (
    p_membership_id,
    p_person_id,
    coalesce(p_member_type_id, v_existing_type),
    v_existing_card
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Import people, all or nothing. If any row fails, nothing is saved and the
-- error names the row.
--
-- p_rows: array of
--   {
--     "line": 2,                          -- spreadsheet row, for error messages
--     "person": { ...person columns... },
--     "contacts": [ ... ], "ethnicities": [ ... ], "other_clubs": [ ... ],
--     "membership": null | {
--       "kind": "individual" | "family", "season_start": "2026-10-01",
--       "paid_on": null, "member_type_id": 1, "card_issued_on": null
--     }
--   }
-- ---------------------------------------------------------------------------

create function public.import_members(p_rows jsonb)
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
  -- Reserve every number in the file first, so people without a number are
  -- not given one that a later row needs.
  perform public.sync_membership_number_seq(
    (select max((r -> 'person' ->> 'membership_number')::integer)
     from jsonb_array_elements(p_rows) r)
  );

  for v_row in select * from jsonb_array_elements(p_rows) loop
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

revoke execute on function
  public.sync_membership_number_seq(integer),
  public.join_family_membership(uuid, uuid, smallint),
  public.import_members(jsonb)
  from public, anon;

grant execute on function
  public.sync_membership_number_seq(integer),
  public.join_family_membership(uuid, uuid, smallint),
  public.import_members(jsonb)
  to authenticated;
