-- Made-up data for local development and the staging site.
-- Never put real member details here: this repository is public.
-- Safe to run more than once.

insert into public.member_type (name)
values ('Skating'), ('Non-skating'), ('Life')
on conflict (name) do nothing;

insert into public.person (
  id, first_name, last_name, date_of_birth, gender_code, address_line, town_city,
  postcode, country, email, phone, in_skate_school, member_since, coc_agreed_on,
  waiver_agreed_on, nzifsa_share_agreed_on
) values
  ('00000000-0000-4000-8000-000000000001', 'Test', 'Skaterson', '2014-06-15', 'female',
   '1 Example Street', 'Testville', '0000', 'New Zealand', 'family.skaterson@example.test',
   '+64 21 000 0001', true, '2022-10-01', '2022-10-01', '2022-10-01', '2022-10-01'),
  ('00000000-0000-4000-8000-000000000002', 'Sample', 'Skaterson', '1985-02-01', 'not_stated',
   '1 Example Street', 'Testville', '0000', 'New Zealand', 'family.skaterson@example.test',
   '+64 21 000 0002', false, '2022-10-01', '2022-10-01', '2022-10-01', null),
  ('00000000-0000-4000-8000-000000000003', 'Demo', 'Glider', '1990-11-30', 'male',
   '99 Placeholder Road', 'Mocktown', '9999', 'New Zealand', 'demo.glider@example.test',
   '+64 21 000 0003', false, '2019-10-01', '2019-10-01', '2019-10-01', '2019-10-01'),
  ('00000000-0000-4000-8000-000000000004', 'Lapsed', 'Example', '2001-04-04', null,
   null, 'Mocktown', null, 'New Zealand', 'lapsed@example.test',
   null, false, '2020-10-01', '2020-10-01', null, null)
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
