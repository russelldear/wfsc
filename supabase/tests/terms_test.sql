-- Stage 3b: terms, classes and enrolments.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'committee@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'no-role@example.test');
insert into public.user_role (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'committee');
insert into public.person (id, first_name, last_name) values
  ('dddddddd-0000-0000-0000-000000000001', 'Term', 'Skater');

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Terms far from today, so the tests don't depend on the date: one long
-- past, one that has started (current), one in the future.
insert into public.term (id, name, starts_on, ends_on) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Test past term', '2001-01-01', '2001-03-31'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'Test current term', '2002-01-01', '2002-03-31'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'Test future term', '2099-01-01', '2099-03-31');
insert into public.skate_class (id, term_id, name) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', 'Class A'),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', 'Class B'),
  ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003', 'Future class'),
  ('ffffffff-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000001', 'Past class');

-- On staging/CI the seed adds a real-looking term; make the test's current
-- term the latest started one by moving any others out of the way.
update public.term set starts_on = '2000-01-01', ends_on = '2000-02-01'
where id not in ('eeeeeeee-0000-0000-0000-000000000001',
                 'eeeeeeee-0000-0000-0000-000000000002',
                 'eeeeeeee-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select is((select count(*) from public.skate_class), 0::bigint, 'user without a role sees no classes');
select throws_ok(
  $$ insert into public.enrolment (class_id, person_id)
     values ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001') $$,
  '42501', null, 'user without a role cannot enrol anyone');

reset role;
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Current term and enrolment
-- ---------------------------------------------------------------------------

select is(public.current_term_id(), 'eeeeeeee-0000-0000-0000-000000000002'::uuid,
  'the current term is the latest one that has started');

select lives_ok(
  $$ insert into public.enrolment (class_id, person_id)
     values ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001') $$,
  'committee can enrol a skater in a class');

select is(
  (select term_id from public.enrolment where person_id = 'dddddddd-0000-0000-0000-000000000001'),
  'eeeeeeee-0000-0000-0000-000000000002'::uuid, 'the enrolment takes its term from the class');

select is(
  (select in_skate_school from public.member_summary where id = 'dddddddd-0000-0000-0000-000000000001'),
  true, 'enrolled in the current term means in the skate school');

select throws_ok(
  $$ insert into public.enrolment (class_id, person_id)
     values ('ffffffff-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001') $$,
  '23505', null, 'a skater can only be in one class per term');

select lives_ok(
  $$ update public.enrolment set class_id = 'ffffffff-0000-0000-0000-000000000002'
     where person_id = 'dddddddd-0000-0000-0000-000000000001'
       and class_id = 'ffffffff-0000-0000-0000-000000000001' $$,
  'a skater can be moved to another class in the same term');

select lives_ok(
  $$ insert into public.enrolment (class_id, person_id)
     values ('ffffffff-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001') $$,
  'a skater can be enrolled in different terms');

select is(
  (select count(*) from public.enrolment where person_id = 'dddddddd-0000-0000-0000-000000000001'),
  2::bigint, 'one enrolment per term');

-- Only enrolled in a past term: not in the skate school now.
insert into public.person (id, first_name, last_name) values
  ('dddddddd-0000-0000-0000-000000000002', 'Past', 'Skater');
insert into public.enrolment (class_id, person_id)
values ('ffffffff-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000002');

select is(
  (select in_skate_school from public.member_summary where id = 'dddddddd-0000-0000-0000-000000000002'),
  false, 'enrolled only in a past term means not in the skate school now');

-- ---------------------------------------------------------------------------
-- Classes and terms
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.skate_class (term_id, name) values ('eeeeeeee-0000-0000-0000-000000000002', 'Class A') $$,
  '23505', null, 'class names are unique within a term');

select throws_ok(
  $$ insert into public.skate_class (term_id, name, starts_at, ends_at)
     values ('eeeeeeee-0000-0000-0000-000000000002', 'Backwards', '10:00', '09:00') $$,
  '23514', null, 'a class cannot end before it starts');

select throws_ok(
  $$ delete from public.term where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  '23503', null, 'a term with classes cannot be deleted');

select lives_ok(
  $$ delete from public.skate_class where id = 'ffffffff-0000-0000-0000-000000000003' $$,
  'deleting a class removes its enrolments');

select ok(
  exists (select 1 from public.audit_log
          where table_name = 'enrolment' and action = 'update'
            and changed_by = '11111111-1111-1111-1111-111111111111'),
  'enrolment changes are audited');

reset role;

select * from finish();
rollback;
