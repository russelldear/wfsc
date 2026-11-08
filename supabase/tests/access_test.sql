-- Stage 4: access management and the coach role.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

-- admin: also committee. committee: committee only. coach: coach only.
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@example.test', now()),
  ('a0000000-0000-0000-0000-000000000002', 'committee@example.test', now()),
  ('a0000000-0000-0000-0000-000000000003', 'coach@example.test', now()),
  ('a0000000-0000-0000-0000-000000000004', 'waiting@example.test', now());
insert into public.user_role (user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000001', 'committee'),
  ('a0000000-0000-0000-0000-000000000002', 'committee'),
  ('a0000000-0000-0000-0000-000000000003', 'coach');

-- A skater enrolled in a class, and a member who is not.
insert into public.person (id, first_name, last_name, date_of_birth, email, phone, membership_number) values
  ('b0000000-0000-0000-0000-000000000001', 'Enrolled', 'Skater', '1995-05-05', 'private@example.test', '021 PRIVATE', '22/901'),
  ('b0000000-0000-0000-0000-000000000002', 'Not', 'Enrolled', '1980-01-01', 'other@example.test', null, '22/902');
insert into public.term (id, name, starts_on, ends_on) values
  ('c0000000-0000-0000-0000-000000000001', 'Access test term', '2003-01-01', '2003-03-31');
insert into public.skate_class (id, term_id, name) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Access test class');
insert into public.enrolment (class_id, person_id) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
insert into public.badge_pass (person_id, badge_id, passed_on, assessor_name, assessor_type)
select p.id, (select id from public.badge where name = 'Beginner'), '2003-02-01', 'A Coach', 'coach'
from public.person p where p.id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Committee without admin cannot manage access
-- ---------------------------------------------------------------------------

select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
set local role authenticated;

select throws_ok($$ select * from public.list_app_users() $$, '42501', null,
  'committee without admin cannot list users');
select throws_ok($$ select public.invite_user('new@example.test', 'committee') $$, '42501', null,
  'committee without admin cannot invite');
select throws_ok(
  $$ select public.grant_role('a0000000-0000-0000-0000-000000000002', 'admin') $$, '42501', null,
  'committee cannot make themselves admin');
select is((select count(*) from public.user_role), 1::bigint,
  'committee without admin sees only their own roles');

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
set local role authenticated;

select ok(
  (select roles = '{}' from public.list_app_users() where email = 'waiting@example.test'),
  'admin sees signed-in people with no access');

select is(public.invite_user('  New.Person@Example.test ', 'coach'), 'invited',
  'inviting someone who has not signed in creates an invitation');
select is((select email from public.role_invite), 'new.person@example.test',
  'invitation emails are stored in lower case');

select is(public.invite_user('WAITING@example.test', 'coach'), 'granted',
  'inviting someone who has already signed in grants the role at once');
select ok(
  exists (select 1 from public.user_role
          where user_id = 'a0000000-0000-0000-0000-000000000004' and role = 'coach'),
  'the waiting person is now a coach');

select throws_ok($$ select public.invite_user('not an email', 'coach') $$, 'P0001', null,
  'invalid email addresses are refused');

select lives_ok($$ select public.grant_role('a0000000-0000-0000-0000-000000000002', 'admin') $$,
  'admin can make someone else an admin');
select lives_ok($$ select public.revoke_role('a0000000-0000-0000-0000-000000000002', 'admin') $$,
  'admin can remove another admin');
select throws_ok(
  $$ select public.revoke_role('a0000000-0000-0000-0000-000000000001', 'admin') $$,
  'P0001', 'There must always be at least one admin.', 'the last admin cannot be removed');

select ok(
  exists (select 1 from public.audit_log where table_name = 'user_role' and action = 'delete'
            and changed_by = 'a0000000-0000-0000-0000-000000000001'),
  'role changes are audited with who made them');

reset role;

-- ---------------------------------------------------------------------------
-- Invitations apply on first (confirmed) sign-in
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values ('a0000000-0000-0000-0000-000000000005', 'new.person@example.test', null);

select is(
  (select count(*) from public.user_role where user_id = 'a0000000-0000-0000-0000-000000000005'),
  0::bigint, 'an unconfirmed email does not claim an invitation');

update auth.users set email_confirmed_at = now() where id = 'a0000000-0000-0000-0000-000000000005';

select ok(
  exists (select 1 from public.user_role
          where user_id = 'a0000000-0000-0000-0000-000000000005' and role = 'coach'),
  'the invitation becomes a role once the email is confirmed');
select is((select count(*) from public.role_invite), 0::bigint, 'used invitations are removed');

insert into public.role_invite (email, role) values ('google.user@example.test', 'committee');
insert into auth.users (id, email, email_confirmed_at)
values ('a0000000-0000-0000-0000-000000000006', 'Google.User@example.test', now());
select ok(
  exists (select 1 from public.user_role
          where user_id = 'a0000000-0000-0000-0000-000000000006' and role = 'committee'),
  'a confirmed first sign-in (as with Google) applies the invitation, ignoring case');

-- ---------------------------------------------------------------------------
-- Coach: view-only skate school, nothing else
-- ---------------------------------------------------------------------------

select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
set local role authenticated;

select results_eq(
  $$ select first_name, membership_number, age_at_term_start
     from public.term_skaters('c0000000-0000-0000-0000-000000000001') $$,
  $$ values ('Enrolled'::text, null::text, 7) $$,
  'coaches get skater names and ages, not membership numbers');
select ok(
  (select count(*) from public.skate_class where id = 'd0000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.enrolment where class_id = 'd0000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.badge) = 28,
  'coaches can read classes, enrolments and badges');
select is(
  (select count(*) from public.badge_pass where person_id in
     ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  1::bigint, 'coaches see progress only for enrolled skaters');
select is((select count(*) from public.person), 0::bigint, 'coaches cannot read people');
select is((select count(*) from public.member_summary), 0::bigint, 'coaches cannot read the member list');
select is(
  (select count(*) from public.contact) + (select count(*) from public.membership)
    + (select count(*) from public.audit_log),
  0::bigint, 'coaches cannot read contacts, memberships or the audit log');
select throws_ok(
  $$ insert into public.skill_achievement (person_id, skill_id, achieved_on)
     values ('b0000000-0000-0000-0000-000000000001', (select min(id) from public.badge_skill), '2003-02-02') $$,
  '42501', null, 'coaches cannot tick skills');
select throws_ok(
  $$ insert into public.enrolment (class_id, person_id)
     values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'coaches cannot enrol skaters');

reset role;

-- Someone with no role cannot use the coach function.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000007');
set local role authenticated;
select throws_ok($$ select * from public.term_skaters('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'people without a role cannot list skaters');
reset role;

select * from finish();
rollback;
