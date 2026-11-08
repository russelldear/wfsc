-- Made-up data for local development and the staging site.
-- Never put real member details here: this repository is public.
-- Safe to run more than once.

insert into public.member_type (name)
values ('Skating'), ('Non-skating'), ('Life')
on conflict (name) do nothing;

insert into public.person (
  id, first_name, last_name, date_of_birth, gender_code, address_line, town_city,
  postcode, country, email, phone, member_since, coc_agreed_on,
  waiver_agreed_on, nzifsa_share_agreed_on
) values
  ('00000000-0000-4000-8000-000000000001', 'Test', 'Skaterson', '2014-06-15', 'female',
   '1 Example Street', 'Testville', '0000', 'New Zealand', 'family.skaterson@example.test',
   '+64 21 000 0001', '2022-10-01', '2022-10-01', '2022-10-01', '2022-10-01'),
  ('00000000-0000-4000-8000-000000000002', 'Sample', 'Skaterson', '1985-02-01', 'not_stated',
   '1 Example Street', 'Testville', '0000', 'New Zealand', 'family.skaterson@example.test',
   '+64 21 000 0002', '2022-10-01', '2022-10-01', '2022-10-01', null),
  ('00000000-0000-4000-8000-000000000003', 'Demo', 'Glider', '1990-11-30', 'male',
   '99 Placeholder Road', 'Mocktown', '9999', 'New Zealand', 'demo.glider@example.test',
   '+64 21 000 0003', '2019-10-01', '2019-10-01', '2019-10-01', '2019-10-01'),
  ('00000000-0000-4000-8000-000000000004', 'Lapsed', 'Example', '2001-04-04', null,
   null, 'Mocktown', null, 'New Zealand', 'lapsed@example.test',
   null, '2020-10-01', '2020-10-01', null, null)
on conflict (id) do nothing;

insert into public.contact (id, person_id, name, relationship, phone, is_guardian) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001',
   'Sample Skaterson', 'Parent', '+64 21 000 0002', true),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000003',
   'Emergency Person', 'Partner', '+64 21 000 0009', false)
on conflict (id) do nothing;

insert into public.person_ethnicity (person_id, ethnicity_code) values
  ('00000000-0000-4000-8000-000000000001', 'european'),
  ('00000000-0000-4000-8000-000000000001', 'maori'),
  ('00000000-0000-4000-8000-000000000003', 'not_stated')
on conflict do nothing;

insert into public.person_other_club (person_id, club_name) values
  ('00000000-0000-4000-8000-000000000003', 'Another Skating Club'),
  ('00000000-0000-4000-8000-000000000003', 'A Third Club')
on conflict do nothing;

-- A current family membership, a current individual one, and a lapsed one.
insert into public.membership (id, kind, season_start, paid_on) values
  ('00000000-0000-4000-8000-0000000000a1', 'family', public.current_season_start(),
   public.current_season_start() + 5),
  ('00000000-0000-4000-8000-0000000000a2', 'individual', public.current_season_start(),
   public.current_season_start() + 12),
  ('00000000-0000-4000-8000-0000000000a3', 'individual',
   (public.current_season_start() - interval '2 years')::date,
   (public.current_season_start() - interval '2 years')::date + 3)
on conflict (id) do nothing;

insert into public.membership_member (membership_id, person_id, member_type_id)
select v.membership_id::uuid, v.person_id::uuid, (select id from public.member_type where name = v.type_name)
from (values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Skating'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 'Non-skating'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000003', 'Skating'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000004', 'Skating')
) as v(membership_id, person_id, type_name)
on conflict do nothing;

-- Skate school: the club's 2026 Term 4 classes. The term dates are
-- placeholders for staging, not the real term dates.
insert into public.term (id, name, starts_on, ends_on) values
  ('00000000-0000-4000-8000-0000000000e1', '2026 Term 4', '2026-10-12', '2026-12-18')
on conflict (id) do nothing;

insert into public.skate_class (id, term_id, name, starts_at, ends_at, min_age, max_age) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'Invitational', '07:30', '08:15', null, null),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 'Novice 2 and Advanced', '08:15', '09:00', null, null),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e1', 'Novice 1 – Adults', '09:00', '09:30', 16, null),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000e1', 'Novice 1 – Youth', '09:00', '09:30', 7, 15),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000e1', 'Elementary and Basic levels', '09:30', '10:00', null, null),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000e1', 'Beginner Classes', '09:30', '10:00', null, null),
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000e1', 'Tiny Tots', '10:00', '10:30', 4, 6)
on conflict (id) do nothing;

insert into public.skate_class_badge (class_id, badge_id)
select v.class_id::uuid, b.id
from (values
  ('00000000-0000-4000-8000-0000000000f2', 'Novice 2'),
  ('00000000-0000-4000-8000-0000000000f2', 'Advanced'),
  ('00000000-0000-4000-8000-0000000000f3', 'Novice 1'),
  ('00000000-0000-4000-8000-0000000000f4', 'Novice 1'),
  ('00000000-0000-4000-8000-0000000000f5', 'Elementary'),
  ('00000000-0000-4000-8000-0000000000f5', 'Basic'),
  ('00000000-0000-4000-8000-0000000000f6', 'Beginner'),
  ('00000000-0000-4000-8000-0000000000f7', 'Tiny Tots 1'),
  ('00000000-0000-4000-8000-0000000000f7', 'Tiny Tots 2')
) as v(class_id, badge_name)
join public.badge b on b.name = v.badge_name
on conflict do nothing;

insert into public.enrolment (class_id, person_id) values
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-000000000003')
on conflict do nothing;
