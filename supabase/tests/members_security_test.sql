-- Row level security and data rules for stage 1.
-- Run with `supabase test db` (CI) or scripts/test-db-plain-postgres.sh.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'committee@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'no-role@example.test');

insert into public.user_role (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'committee');

insert into public.member_type (name) values ('Test type')
  on conflict (name) do nothing;

insert into public.person (id, first_name, last_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Existing', 'Person');

-- Helpers to act as a given user, the way PostgREST does.
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Anonymous visitors get nothing
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok($$ select * from public.person $$, '42501', null,
  'anon cannot read person');
select throws_ok($$ select * from public.member_summary $$, '42501', null,
  'anon cannot read member_summary');
select throws_ok($$ select * from public.contact $$, '42501', null,
  'anon cannot read contacts');
select throws_ok($$ select public.renew_membership(gen_random_uuid()) $$, '42501', null,
  'anon cannot call renew_membership');

reset role;

-- ---------------------------------------------------------------------------
-- Signed in, but no role: sees nothing, changes nothing
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select is((select count(*) from public.person), 0::bigint,
  'user without a role sees no people');
select is((select count(*) from public.member_summary), 0::bigint,
  'user without a role sees no member summary rows');
select is((select count(*) from public.audit_log), 0::bigint,
  'user without a role sees no audit log');
select is((select count(*) from public.member_type), 0::bigint,
  'user without a role sees no member types');
select is(public.is_committee(), false,
  'user without a role is not committee');
select throws_ok(
  $$ insert into public.person (first_name, last_name) values ('Sneaky', 'Insert') $$,
  '42501', null, 'user without a role cannot add a person');
select throws_ok(
  $$ insert into public.user_role (user_id, role)
     values ('22222222-2222-2222-2222-222222222222', 'committee') $$,
  '42501', null, 'user without a role cannot grant themselves committee');
select throws_ok(
  $$ select public.save_person('{"first_name":"Via","last_name":"Function"}'::jsonb) $$,
  '42501', null, 'user without a role cannot add a person via save_person');

-- Updates are filtered by RLS, so they silently affect zero rows.
update public.person set first_name = 'Hacked'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

reset role;

select is(
  (select first_name from public.person where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Existing', 'update by user without a role changed nothing');

-- ---------------------------------------------------------------------------
-- Committee can read, add and edit
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select is(public.is_committee(), true, 'committee user is committee');
select ok(exists (select 1 from public.person
                  where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'committee sees existing people');
select ok(exists (select 1 from public.user_role
                  where user_id = '11111111-1111-1111-1111-111111111111'),
  'committee sees role assignments');

select lives_ok(
  $$ select public.save_person(
       '{"id":"aaaaaaaa-0000-0000-0000-000000000001","first_name":"Edited",
         "last_name":"Person","date_of_birth":"2015-03-04"}'::jsonb,
       '[{"name":"Parent One","relationship":"Mother","is_guardian":true}]'::jsonb,
       array['european','maori'],
       array['Other Club A', 'Other Club B']) $$,
  'committee can edit a person with contacts, ethnicities and clubs');

select is(
  (select first_name from public.person where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Edited', 'committee edit was saved');
select is(
  (select count(*) from public.person_other_club
   where person_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2::bigint, 'a person can belong to several other clubs');

-- Saving again with a shorter list removes what is no longer listed.
select public.save_person(
  '{"id":"aaaaaaaa-0000-0000-0000-000000000001","first_name":"Edited","last_name":"Person"}'::jsonb,
  '[]'::jsonb, array['maori'], array['Other Club B']);

select results_eq(
  $$ select (select count(*) from public.contact
             where person_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
            (select count(*) from public.person_ethnicity
             where person_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
            (select count(*) from public.person_other_club
             where person_id = 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values (0::bigint, 1::bigint, 1::bigint) $$,
  'saving with shorter lists removes contacts, ethnicities and clubs');

select throws_ok(
  $$ delete from public.person where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null, 'nobody can delete a person in this stage');

-- ---------------------------------------------------------------------------
-- Membership rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.membership (kind, season_start) values ('individual', '2030-09-01') $$,
  '23514', null, 'seasons must start on 1 October');

select public.create_membership('family', '2030-10-01', '2030-10-05',
  jsonb_build_array(jsonb_build_object(
    'person_id', 'aaaaaaaa-0000-0000-0000-000000000001',
    'member_type_id', (select id from public.member_type where name = 'Test type'))));

select is(
  (select expires_on from public.membership where season_start = '2030-10-01'),
  '2031-09-30'::date, 'membership expires on 30 September the following year');

select isnt(
  (select membership_number from public.person
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null, 'joining a membership assigns a membership number');

select throws_ok(
  $$ select public.create_membership('individual', '2030-10-01', null,
       '[{"person_id":"aaaaaaaa-0000-0000-0000-000000000001"}]'::jsonb) $$,
  '23505', null, 'a person cannot have two memberships in the same season');

reset role;
insert into public.person (id, first_name, last_name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Second', 'Person');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select throws_ok(
  $$ select public.create_membership('individual', '2032-10-01', null,
       '[{"person_id":"aaaaaaaa-0000-0000-0000-000000000001"},
         {"person_id":"aaaaaaaa-0000-0000-0000-000000000002"}]'::jsonb) $$,
  'P0001', null, 'an individual membership covers only one person');

select lives_ok(
  $$ select public.renew_membership(
       (select id from public.membership where season_start = '2030-10-01')) $$,
  'committee can renew a membership');

select results_eq(
  $$ select m.kind::text, mm.person_id, mm.member_type_id is not null
     from public.membership m
     join public.membership_member mm on mm.membership_id = m.id
     where m.season_start = '2031-10-01' $$,
  $$ values ('family', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, true) $$,
  'renewal copies kind, people and member type into the next season');

select is(
  (select is_current from public.member_summary
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  true, 'member summary shows the latest membership as current');

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

select ok(
  exists (select 1 from public.audit_log
          where table_name = 'person'
            and record_id = 'aaaaaaaa-0000-0000-0000-000000000001'
            and action = 'update'
            and changed_by = '11111111-1111-1111-1111-111111111111'),
  'edits are recorded in the audit log with who made them');

select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'nobody can delete audit log entries through the API');

reset role;

select * from finish();
rollback;
