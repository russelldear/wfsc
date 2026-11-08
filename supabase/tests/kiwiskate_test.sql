-- Stage 3a: Kiwiskate badges and progress.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- Reference data matches section 700 of the 2019 rules
-- ---------------------------------------------------------------------------

select is((select count(*) from public.badge_stream), 7::bigint, '7 badge streams');
select is((select count(*) from public.badge), 28::bigint, '28 badges');
select is((select count(*) from public.badge_skill where kind = 'assessment'), 142::bigint,
  '142 skills for assessment');
select is((select count(*) from public.badge_skill where kind = 'teaching'), 57::bigint,
  '57 teaching progression ideas');
select is(
  (select count(*) from public.badge b
   where not exists (select 1 from public.badge_skill s
                     where s.badge_id = b.id and s.kind = 'assessment')),
  0::bigint, 'every badge has something to assess');
select results_eq(
  $$ select b.name, p.name from public.badge b left join public.badge p on p.id = b.prerequisite_id
     where b.name in ('Tiny Tots 2', 'Beginner', 'Elementary', 'Freestyle', 'Dance 1') order by b.name $$,
  $$ values ('Beginner', null::text), ('Dance 1', null), ('Elementary', 'Beginner'),
            ('Freestyle', 'Free Skating 3'), ('Tiny Tots 2', 'Tiny Tots 1') $$,
  'badges require the previous badge in their stream; Beginner does not require Tiny Tots');
select is(
  (select max_age from public.badge where name = 'Tiny Tots 1'), 6::smallint,
  'Tiny Tots are for skaters aged 6 and under');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'committee@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'no-role@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'admin@example.test');
insert into public.user_role (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'committee'),
  ('33333333-3333-3333-3333-333333333333', 'admin');
insert into public.person (id, first_name, last_name) values
  ('cccccccc-0000-0000-0000-000000000001', 'Kiwi', 'Skater');

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.pass(p_badge text, p_date date) returns void language sql as $$
  insert into public.badge_pass (person_id, badge_id, passed_on, assessor_name, assessor_type)
  values ('cccccccc-0000-0000-0000-000000000001',
          (select id from public.badge where name = p_badge), p_date, 'A Coach', 'coach');
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select is((select count(*) from public.badge), 0::bigint, 'user without a role sees no badges');
select throws_ok(
  $$ select pg_temp.pass('Beginner', '2027-01-01') $$,
  '42501', null, 'user without a role cannot record a pass');
select throws_ok(
  $$ insert into public.skill_achievement (person_id, skill_id, achieved_on)
     values ('cccccccc-0000-0000-0000-000000000001', 1, '2027-01-01') $$,
  '42501', null, 'user without a role cannot tick a skill');

reset role;
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Skill ticks
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.skill_achievement (person_id, skill_id, achieved_on, note)
     select 'cccccccc-0000-0000-0000-000000000001', s.id, '2027-02-01', 'Solid on both feet'
     from public.badge_skill s join public.badge b on b.id = s.badge_id
     where b.name = 'Elementary' and s.kind = 'assessment' and s.sort_order = 1 $$,
  'committee can tick a skill, with a note, before the earlier badge is passed');

select is(
  (select recorded_by from public.skill_achievement limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid, 'ticks record who entered them');

-- ---------------------------------------------------------------------------
-- Badge order
-- ---------------------------------------------------------------------------

select throws_ok($$ select pg_temp.pass('Elementary', '2027-03-01') $$,
  'P0001', 'Beginner must be passed first.', 'a badge needs the one before it');

select lives_ok($$ select pg_temp.pass('Beginner', '2027-03-01') $$,
  'Beginner needs no Tiny Tots badge');

select throws_ok($$ select pg_temp.pass('Elementary', '2027-02-28') $$,
  'P0001', null, 'a badge cannot be dated before the one it depends on');

select lives_ok($$ select pg_temp.pass('Elementary', '2027-03-01') $$,
  'two badges can be passed on the same day, in order');

select throws_ok($$ select pg_temp.pass('Tiny Tots 2', '2027-03-01') $$,
  'P0001', 'Tiny Tots 1 must be passed first.', 'Tiny Tots 2 needs Tiny Tots 1');

select throws_ok(
  $$ delete from public.badge_pass bp using public.badge b
     where b.id = bp.badge_id and b.name = 'Beginner' $$,
  'P0001', 'Remove the Elementary pass first: it depends on this one.',
  'an earlier pass cannot be removed while a later one depends on it');

select throws_ok(
  $$ update public.badge_pass bp set passed_on = '2027-04-01' from public.badge b
     where b.id = bp.badge_id and b.name = 'Beginner' $$,
  'P0001', null, 'an earlier pass cannot be moved after a later one');

select throws_ok($$ select pg_temp.pass('Beginner', '2027-05-01') $$,
  '23505', null, 'a badge can only be passed once');

select lives_ok(
  $$ delete from public.badge_pass bp using public.badge b
     where b.id = bp.badge_id and b.name = 'Elementary' $$,
  'the latest pass can be removed');

select lives_ok($$ select pg_temp.pass('Figure 1', '2027-01-01') $$,
  'streams are independent: Figure 1 needs no General badge');

-- ---------------------------------------------------------------------------
-- Editing reference data, and audit
-- ---------------------------------------------------------------------------

-- Committee (not admin): the update matches no rows it may change.
update public.badge_skill set description = description || ' (edited)'
  where id = (select min(id) from public.badge_skill);
select is(
  (select count(*) from public.badge_skill where description like '% (edited)'),
  0::bigint, 'committee without admin cannot edit skill wording');

select throws_ok(
  $$ insert into public.badge_skill (badge_id, kind, sort_order, description)
     values ((select min(id) from public.badge), 'assessment', 99, 'Sneaky skill') $$,
  '42501', null, 'committee without admin cannot add skills');

reset role;
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;
update public.badge_skill set description = description || ' (edited)'
  where id = (select min(id) from public.badge_skill);
reset role;
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select ok(
  exists (select 1 from public.audit_log
          where table_name = 'badge_skill' and action = 'update'
            and changed_by = '33333333-3333-3333-3333-333333333333'),
  'admins can edit skill wording');

select ok(
  exists (select 1 from public.audit_log
          where table_name = 'badge_pass' and action = 'insert'
            and changed_by = '11111111-1111-1111-1111-111111111111'),
  'badge passes are audited');

reset role;

select * from finish();
rollback;
