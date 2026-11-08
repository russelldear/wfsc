-- Stage 2: import and family linking.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'committee@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'no-role@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'committee-only@example.test');
insert into public.user_role (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'committee'),
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('33333333-3333-3333-3333-333333333333', 'committee');
insert into public.member_type (name) values ('Test type') on conflict (name) do nothing;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select throws_ok(
  $$ select public.import_members('[{"line":2,"person":{"first_name":"A","last_name":"B"}}]') $$,
  '42501', null, 'user without a role cannot import');
select throws_ok(
  $$ select public.next_membership_number() $$,
  '42501', null, 'membership numbers are only assigned by the database');

reset role;
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select throws_ok(
  $$ select public.import_members('[{"line":2,"person":{"first_name":"A","last_name":"B"}}]') $$,
  '42501', 'Only an admin can import members', 'committee without admin cannot import');

reset role;
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select is(
  public.import_members(jsonb_build_array(
    jsonb_build_object(
      'line', 2,
      'person', jsonb_build_object('first_name', 'Imported', 'last_name', 'Numberless'),
      'membership', jsonb_build_object('kind', 'family', 'season_start', '2040-10-01')),
    jsonb_build_object(
      'line', 3,
      'person', jsonb_build_object('membership_number', '40/050', 'first_name', 'Imported',
                                   'last_name', 'Numbered', 'date_of_birth', '2012-01-02'),
      'contacts', '[{"name":"Guardian Raw Text 021 000","is_guardian":true}]'::jsonb,
      'ethnicities', '["maori"]'::jsonb,
      'other_clubs', '["Club One","Club Two"]'::jsonb,
      'membership', jsonb_build_object(
        'kind', 'family', 'season_start', '2040-10-01',
        'member_type_id', (select id from public.member_type where name = 'Test type'),
        'card_issued_on', '2040-10-10'))
  )),
  2, 'import returns the number of people imported');

select is(
  (select membership_number from public.person where last_name = 'Numberless'),
  to_char(now() at time zone 'Pacific/Auckland', 'YY') || '/051',
  'people without a number get this year and the next counter after the file''s numbers');

select results_eq(
  $$ select (select count(*) from public.contact c join public.person p on p.id = c.person_id
             where p.membership_number = '40/050'),
            (select count(*) from public.person_other_club c join public.person p on p.id = c.person_id
             where p.membership_number = '40/050'),
            (select card_issued_on from public.membership_member mm join public.person p on p.id = mm.person_id
             where p.membership_number = '40/050') $$,
  $$ values (1::bigint, 2::bigint, '2040-10-10'::date) $$,
  'contacts, other clubs and card date are imported');

select throws_like(
  $$ select public.import_members(jsonb_build_array(
       jsonb_build_object('line', 7, 'person', jsonb_build_object('first_name', 'Fine', 'last_name', 'Row')),
       jsonb_build_object('line', 8, 'person', jsonb_build_object('membership_number', '40/050',
                                                                  'first_name', 'Dup', 'last_name', 'Number')))) $$,
  'Row 8:%', 'a failing row is named in the error');

select is(
  (select count(*) from public.person where last_name = 'Row'),
  0::bigint, 'a failed import saves nothing');

-- ---------------------------------------------------------------------------
-- Linking family members after import
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.join_family_membership(
       (select mm.membership_id from public.membership_member mm
        join public.person p on p.id = mm.person_id where p.membership_number = '40/050'),
       (select id from public.person where last_name = 'Numberless')) $$,
  'a person can be moved onto another family membership in the same season');

select is(
  (select count(distinct mm.membership_id) from public.membership_member mm
   join public.person p on p.id = mm.person_id
   where p.last_name in ('Numbered', 'Numberless')),
  1::bigint, 'both family members now share one membership');

select is(
  (select count(*) from public.membership where season_start = '2040-10-01'),
  1::bigint, 'the solo membership they left is removed');

select throws_ok(
  $$ select public.join_family_membership(
       (select mm.membership_id from public.membership_member mm
        join public.person p on p.id = mm.person_id where p.membership_number = '40/050'),
       (select id from public.person where last_name = 'Numberless')) $$,
  'P0001', 'That person is already on this membership',
  'joining the same membership twice is refused');

-- Someone already sharing a family membership must be removed from it first.
select public.save_person('{"first_name":"Third","last_name":"Person"}'::jsonb);
select public.create_membership('family', '2040-10-01', null,
  jsonb_build_array(jsonb_build_object('person_id',
    (select id from public.person where first_name = 'Third'))));

select throws_ok(
  $$ select public.join_family_membership(
       (select mm.membership_id from public.membership_member mm
        join public.person p on p.id = mm.person_id where p.first_name = 'Third'),
       (select id from public.person where last_name = 'Numberless')) $$,
  'P0001', null, 'a person sharing another family membership is not moved silently');

select public.create_membership('individual', '2041-10-01', null,
  jsonb_build_array(jsonb_build_object('person_id',
    (select id from public.person where first_name = 'Third'))));

select throws_ok(
  $$ select public.join_family_membership(
       (select id from public.membership where season_start = '2041-10-01'),
       (select id from public.person where last_name = 'Numberless')) $$,
  'P0001', 'Only a family membership can cover more than one person',
  'only family memberships can take extra people');

-- ---------------------------------------------------------------------------
-- Number format
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.save_person('{"membership_number":"22-006","first_name":"Bad","last_name":"Format"}'::jsonb) $$,
  '23514', null, 'numbers must look like 22/006');

select throws_ok(
  $$ select public.save_person('{"membership_number":"22/6","first_name":"Bad","last_name":"Format"}'::jsonb) $$,
  '23514', null, 'the counter needs at least three digits');

-- The counter runs on across years, past 999.
select public.save_person('{"membership_number":"20/999","first_name":"High","last_name":"Number"}'::jsonb);
select public.save_person('{"first_name":"After","last_name":"High"}'::jsonb);
select public.create_membership('individual', '2042-10-01', null,
  jsonb_build_array(jsonb_build_object('person_id',
    (select id from public.person where first_name = 'After' and last_name = 'High'))));

select is(
  (select membership_number from public.person where first_name = 'After' and last_name = 'High'),
  to_char(now() at time zone 'Pacific/Auckland', 'YY') || '/1000',
  'new numbers continue the running counter, past 999');

reset role;

select is(
  (select count(*) from public.person where membership_number !~ '^[0-9]{2}/[0-9]{3,}$'),
  0::bigint, 'every stored number is in the club format');

select * from finish();
rollback;
