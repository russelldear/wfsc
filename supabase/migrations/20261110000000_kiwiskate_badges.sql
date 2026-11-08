-- Stage 3a: Kiwiskate badges, skills, and each skater's progress.
--
-- Reference data (streams, badges, skills) is loaded from section 700 of the
-- 2019 NZIFSA Rules and Regulations, and the committee can edit it.
-- Progress is kept apart from the person table, so a future coach role can
-- read progress without being able to read members' personal details.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.badge_stream (
  id smallint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  rule_section text,
  note text,
  sort_order smallint not null
);

create table public.badge (
  id smallint generated always as identity primary key,
  stream_id smallint not null references public.badge_stream (id),
  name text not null unique check (btrim(name) <> ''),
  sort_order smallint not null,
  -- The badge a skater must already have passed (on or before the same day).
  prerequisite_id smallint references public.badge (id),
  -- e.g. 6 for Tiny Tots ("6 years of age and under").
  max_age smallint check (max_age > 0),
  description text,
  unique (stream_id, sort_order),
  check (prerequisite_id is distinct from id)
);

-- "Skills for Assessment" are tested; "Teaching Progression Ideas" are taught
-- but not tested (rule 701.2).
create type public.badge_skill_kind as enum ('assessment', 'teaching');

create table public.badge_skill (
  id integer generated always as identity primary key,
  badge_id smallint not null references public.badge (id),
  kind public.badge_skill_kind not null,
  sort_order smallint not null,
  description text not null check (btrim(description) <> '')
);

create index badge_skill_badge_idx on public.badge_skill (badge_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- Progress
-- ---------------------------------------------------------------------------

create table public.skill_achievement (
  person_id uuid not null references public.person (id) on delete cascade,
  skill_id integer not null references public.badge_skill (id),
  achieved_on date not null,
  note text,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now(),
  primary key (person_id, skill_id)
);

-- Rule 701.1: tests are judged by a NZIFSA Judge or a Level 1 Accredited
-- Professional Coach.
create type public.assessor_type as enum ('judge', 'coach');

create table public.badge_pass (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  badge_id smallint not null references public.badge (id),
  passed_on date not null,
  assessor_name text not null check (btrim(assessor_name) <> ''),
  assessor_type public.assessor_type not null,
  note text,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now(),
  unique (person_id, badge_id)
);

create index badge_pass_person_idx on public.badge_pass (person_id);

-- Order: a badge needs its prerequisite passed on or before the same day,
-- and a prerequisite cannot be removed or moved later than a badge that
-- depends on it.
create function public.badge_pass_check_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prereq_id smallint;
  v_prereq_name text;
  v_prereq_date date;
  v_dependent text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select b.prerequisite_id, p.name
    into v_prereq_id, v_prereq_name
    from public.badge b
    left join public.badge p on p.id = b.prerequisite_id
    where b.id = new.badge_id;

    if v_prereq_id is not null then
      select passed_on into v_prereq_date
      from public.badge_pass
      where person_id = new.person_id and badge_id = v_prereq_id;

      if v_prereq_date is null then
        raise exception '% must be passed first.', v_prereq_name using errcode = 'P0001';
      elsif v_prereq_date > new.passed_on then
        raise exception '% was passed on %, which is after this date.',
          v_prereq_name, to_char(v_prereq_date, 'DD/MM/YYYY') using errcode = 'P0001';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    select string_agg(b.name, ', ' order by b.sort_order)
    into v_dependent
    from public.badge_pass bp
    join public.badge b on b.id = bp.badge_id
    where bp.person_id = old.person_id
      and b.prerequisite_id = old.badge_id
      and (tg_op = 'DELETE' or bp.passed_on < new.passed_on);

    if v_dependent is not null then
      if tg_op = 'DELETE' then
        raise exception 'Remove the % pass first: it depends on this one.', v_dependent
          using errcode = 'P0001';
      else
        raise exception '% was passed before that date, and depends on this badge.', v_dependent
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger badge_pass_order
  before insert or update or delete on public.badge_pass
  for each row execute function public.badge_pass_check_order();

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

grant select on public.badge_stream to authenticated;
grant select, update on public.badge to authenticated;
grant select, insert, update, delete on
  public.badge_skill, public.skill_achievement, public.badge_pass
  to authenticated;

alter table public.badge_stream enable row level security;
alter table public.badge enable row level security;
alter table public.badge_skill enable row level security;
alter table public.skill_achievement enable row level security;
alter table public.badge_pass enable row level security;

create policy "committee reads" on public.badge_stream
  for select to authenticated using ((select public.is_committee()));

create policy "committee reads" on public.badge
  for select to authenticated using ((select public.is_committee()));
create policy "committee edits" on public.badge
  for update to authenticated
  using ((select public.is_committee())) with check ((select public.is_committee()));

do $$
declare
  t text;
begin
  foreach t in array array['badge_skill', 'skill_achievement', 'badge_pass'] loop
    execute format(
      'create policy "committee reads" on public.%I
         for select to authenticated using ((select public.is_committee()))', t);
    execute format(
      'create policy "committee adds" on public.%I
         for insert to authenticated with check ((select public.is_committee()))', t);
    execute format(
      'create policy "committee edits" on public.%I
         for update to authenticated
         using ((select public.is_committee()))
         with check ((select public.is_committee()))', t);
    execute format(
      'create policy "committee removes" on public.%I
         for delete to authenticated using ((select public.is_committee()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2019 NZIFSA Rules and Regulations, section 700: The Kiwi Skate Programme
-- ---------------------------------------------------------------------------

insert into public.badge_stream (code, name, rule_section, note, sort_order) values
  ('general', 'General', '702', null, 1),
  ('figure', 'Figure', '703',
   'More difficult turns are included as Teaching Progressions to prepare skaters for step sequences.', 2),
  ('stroking', 'Stroking', '704', null, 3),
  ('free_skating', 'Free Skating', '705', null, 4),
  ('dance', 'Dance', '706', null, 5),
  ('synchronized', 'Synchronized Skating', '707', null, 6),
  ('pair', 'Pair Skating', '708', null, 7);

insert into public.badge (stream_id, name, sort_order, max_age, description)
select s.id, v.name, v.sort_order, v.max_age, v.description
from (values
  ('general', 'Tiny Tots 1', 1, 6, null),
  ('general', 'Tiny Tots 2', 2, 6, null),
  ('general', 'Beginner', 3, null, null),
  ('general', 'Elementary', 4, null, null),
  ('general', 'Basic', 5, null, null),
  ('general', 'Novice 1', 6, null, null),
  ('general', 'Novice 2', 7, null, null),
  ('general', 'Advanced', 8, null, null),
  ('figure', 'Figure 1', 1, null, null),
  ('figure', 'Figure 2', 2, null, null),
  ('figure', 'Figure 3', 3, null, null),
  ('figure', 'Figure 4', 4, null, null),
  ('stroking', 'Stroking', 1, null, null),
  ('free_skating', 'Free Skating 1', 1, null, null),
  ('free_skating', 'Free Skating 2', 2, null, null),
  ('free_skating', 'Free Skating 3', 3, null, null),
  ('free_skating', 'Freestyle', 4, null, null),
  ('dance', 'Dance 1', 1, null, null),
  ('dance', 'Dance 2', 2, null, null),
  ('dance', 'Dance 3', 3, null, null),
  ('dance', 'Dance 4', 4, null, null),
  ('dance', 'Dance 5', 5, null, null),
  ('dance', 'Dance 6', 6, null, null),
  ('synchronized', 'Synchronized Skating 1', 1, null,
   'Minimum of 6 skaters. The following synchronized manoeuvres should be done with a count but do not need to be connected as a programme.'),
  ('synchronized', 'Synchronized Skating 2', 2, null,
   'This test is to be skated as a programme to music of up to 3 minutes duration for 6 to 16 skaters and to include the following.'),
  ('pair', 'Pair Skating 1', 1, null, null),
  ('pair', 'Pair Skating 2', 2, null, null),
  ('pair', 'Pair Skating 3', 3, null, null)
) as v(stream, name, sort_order, max_age, description)
join public.badge_stream s on s.code = v.stream;

-- Each badge requires the one before it in its stream, except that Beginner
-- does not require Tiny Tots: Tiny Tots are only open to skaters aged 6 and
-- under, so older beginners start at Beginner.
update public.badge b
set prerequisite_id = p.id
from public.badge p
where p.stream_id = b.stream_id
  and p.sort_order = b.sort_order - 1
  and b.name <> 'Beginner';

insert into public.badge_skill (badge_id, kind, sort_order, description)
select b.id, v.kind::public.badge_skill_kind, v.n, v.description
from (values
  -- 702 General
  ('Tiny Tots 1', 'assessment', 1, 'Proper way to fall and get up (standing still).'),
  ('Tiny Tots 1', 'assessment', 2, 'Dip standing still.'),
  ('Tiny Tots 1', 'assessment', 3, 'Forward two-foot glide.'),
  ('Tiny Tots 1', 'assessment', 4, 'Skate width of rink.'),

  ('Tiny Tots 2', 'teaching', 1, 'V position and push.'),
  ('Tiny Tots 2', 'assessment', 1, '‘Scooter’ pushes.'),
  ('Tiny Tots 2', 'assessment', 2, 'Back wiggle.'),
  ('Tiny Tots 2', 'assessment', 3, 'Forward sculling.'),
  ('Tiny Tots 2', 'assessment', 4, 'Dip whilst moving.'),

  ('Beginner', 'teaching', 1, 'Proper way to fall and get up.'),
  ('Beginner', 'teaching', 2, 'Marching across ice with high knees.'),
  ('Beginner', 'teaching', 3, '¼ bend turns; ½ bend turns.'),
  ('Beginner', 'teaching', 4, '360 degree marching on the spot.'),
  ('Beginner', 'teaching', 5, 'Forward two foot glide on a straight line.'),
  ('Beginner', 'teaching', 6, 'Two foot turn from forwards to backwards in place.'),
  ('Beginner', 'assessment', 1, 'Rhythm skating: one count per glide.'),
  ('Beginner', 'assessment', 2, 'Forward two foot glide on a curve.'),
  ('Beginner', 'assessment', 3, 'Forward skating and glide in sit position (2 feet).'),
  ('Beginner', 'assessment', 4, 'Snow plough stops.'),
  ('Beginner', 'assessment', 5, 'Backward marching.'),
  ('Beginner', 'assessment', 6, 'Forward double sculling.'),

  ('Elementary', 'teaching', 1, 'Rhythm skating: 2 counts per glide.'),
  ('Elementary', 'teaching', 2, 'Backward two foot sculling.'),
  ('Elementary', 'teaching', 3, 'Slalom.'),
  ('Elementary', 'teaching', 4, 'Forward one-foot glides in a straight line.'),
  ('Elementary', 'teaching', 5, '360 degree turns on the spot with spiralling edge.'),
  ('Elementary', 'teaching', 6, 'Roll up on toes.'),
  ('Elementary', 'teaching', 7, 'Backward two-foot gliding on a curve.'),
  ('Elementary', 'assessment', 1, '“T” pushes.'),
  ('Elementary', 'assessment', 2, 'Forward double sculling to backward double sculling.'),
  ('Elementary', 'assessment', 3, 'Backward skating, using alternating ‘C’ sculling.'),
  ('Elementary', 'assessment', 4, 'Forward one foot glides on a curve.'),
  ('Elementary', 'assessment', 5, 'Half snow plough stops (both feet).'),
  ('Elementary', 'assessment', 6, 'Forward pumping around circle.'),

  ('Basic', 'teaching', 1, 'Forward skating: four counts per glide, half snow plough stop.'),
  ('Basic', 'teaching', 2, 'Forward one foot glide on a curve (with foot passing).'),
  ('Basic', 'teaching', 3, 'Backward one-foot glide.'),
  ('Basic', 'teaching', 4, 'Walk on toes and heels.'),
  ('Basic', 'teaching', 5, 'Backward pumping around a circle.'),
  ('Basic', 'teaching', 6, 'Two-foot jump on the spot.'),
  ('Basic', 'assessment', 1, 'Two-foot turns on curve (forward to backward).'),
  ('Basic', 'assessment', 2, 'Forward crossovers on a circle.'),
  ('Basic', 'assessment', 3, 'Backwards half snow plough (both feet).'),
  ('Basic', 'assessment', 4, 'Backward skating using alternating “C” pushes.'),
  ('Basic', 'assessment', 5, 'Forward inside edges.'),

  ('Novice 1', 'teaching', 1, 'Forward Russian stroking (can be done as a figure of eight if space is limited).'),
  ('Novice 1', 'teaching', 2, 'Two foot spin from spiralling edge.'),
  ('Novice 1', 'teaching', 3, 'Drag.'),
  ('Novice 1', 'teaching', 4, 'Backward two-foot snowplough stop.'),
  ('Novice 1', 'teaching', 5, 'Side Hops.'),
  ('Novice 1', 'teaching', 6, 'Backward crossovers.'),
  ('Novice 1', 'teaching', 7, 'Backward one-foot glides on a curve.'),
  ('Novice 1', 'assessment', 1, 'Backward pumping on a circle (outside and inside).'),
  ('Novice 1', 'assessment', 2, 'Forward outside edges.'),
  ('Novice 1', 'assessment', 3, 'Forward outside three turns.'),
  ('Novice 1', 'assessment', 4, 'Back inside Mohawks.'),
  ('Novice 1', 'assessment', 5, 'Backward one-foot glides around a circle.'),
  ('Novice 1', 'assessment', 6, 'BO to FO Mohawks.'),

  ('Novice 2', 'teaching', 1, 'Backward C pushes on a curve with foot in front (outside and inside).'),
  ('Novice 2', 'teaching', 2, 'Two foot jump forwards to backwards.'),
  ('Novice 2', 'teaching', 3, 'Forward spiral.'),
  ('Novice 2', 'teaching', 4, 'Inside spread eagle.'),
  ('Novice 2', 'teaching', 5, 'Forward and backward crossovers (two counts per glide).'),
  ('Novice 2', 'assessment', 1, 'Forward inside Mohawk.'),
  ('Novice 2', 'assessment', 2, 'Forward spiral on a curve.'),
  ('Novice 2', 'assessment', 3, 'Forward inside three turns.'),
  ('Novice 2', 'assessment', 4, 'Backward crossovers.'),
  ('Novice 2', 'assessment', 5, 'Forward two foot parallel side stop (left and right).'),
  ('Novice 2', 'assessment', 6, 'Back outside edges.'),

  ('Advanced', 'teaching', 1, 'Backward two-foot turn on a curve.'),
  ('Advanced', 'teaching', 2, 'Back spirals in a straight line.'),
  ('Advanced', 'teaching', 3, 'Ballet hops.'),
  ('Advanced', 'teaching', 4, 'Side hops, three jumps, drags, shoot the ducks and original footwork moves, change of edges, cross rolls, chasse, slide chasses.'),
  ('Advanced', 'teaching', 5, 'Marching spin.'),
  ('Advanced', 'assessment', 1, 'Backward spirals on a curve.'),
  ('Advanced', 'assessment', 2, 'Backward inside edges.'),
  ('Advanced', 'assessment', 3, 'Backward outside three turns.'),
  ('Advanced', 'assessment', 4, 'Backward inside three turns.'),
  ('Advanced', 'assessment', 5, '“T” stops.'),

  -- 703 Figure
  ('Figure 1', 'assessment', 1, 'Forward outside edges.'),
  ('Figure 1', 'assessment', 2, 'Forward inside edges.'),
  ('Figure 1', 'assessment', 3, 'Backward outside edges.'),
  ('Figure 1', 'assessment', 4, 'Backward inside edges.'),
  ('Figure 1', 'assessment', 5, 'LBO – LFI three turn.'),
  ('Figure 1', 'assessment', 6, 'RBO – RFI three turn.'),

  ('Figure 2', 'teaching', 1, 'Inside Brackets.'),
  ('Figure 2', 'teaching', 2, 'Outside Brackets.'),
  ('Figure 2', 'assessment', 1, 'LBI - LFO three turn.'),
  ('Figure 2', 'assessment', 2, 'RBI - RFO three turn.'),
  ('Figure 2', 'assessment', 3, 'Forward outside eight.'),
  ('Figure 2', 'assessment', 4, 'Forward inside eight.'),

  ('Figure 3', 'teaching', 1, 'Inside Counters.'),
  ('Figure 3', 'teaching', 2, 'Outside Counters.'),
  ('Figure 3', 'teaching', 3, 'Twizzles.'),
  ('Figure 3', 'assessment', 1, 'Waltz eight.'),

  ('Figure 4', 'teaching', 1, 'Inside Rockers.'),
  ('Figure 4', 'teaching', 2, 'Outside Rockers.'),
  ('Figure 4', 'teaching', 3, 'Forward Outside and Inside loops.'),
  ('Figure 4', 'assessment', 1, 'FO - FI Change curve.'),
  ('Figure 4', 'assessment', 2, 'FI - FO Change curve.'),
  ('Figure 4', 'assessment', 3, 'Backward outside eight.'),

  -- 704 Stroking
  ('Stroking', 'assessment', 1, 'Circle 1: 3 forward crossovers – FO three turn – 3 backward crossovers – BO Mohawk. Repeated minimum of 3 times around circle (draw for direction).'),
  ('Stroking', 'assessment', 2, 'Circle 2: 3 forward crossovers – FI Mohawk – 3 backward crossovers – BI Mohawk. Repeated minimum of 3 times around circle (draw for direction).'),
  ('Stroking', 'assessment', 3, 'Forward perimeter stroking: Special attention to be given to speed, glide and carriage.'),

  -- 705 Free Skating
  ('Free Skating 1', 'teaching', 1, 'Backwards straight toe jump.'),
  ('Free Skating 1', 'teaching', 2, 'Marching spin (2 rotations).'),
  ('Free Skating 1', 'teaching', 3, 'Tea pot – forwards/backwards.'),
  ('Free Skating 1', 'assessment', 1, 'Forward bunny hop.'),
  ('Free Skating 1', 'assessment', 2, 'Waltz jump.'),
  ('Free Skating 1', 'assessment', 3, 'Toe loop jump.'),
  ('Free Skating 1', 'assessment', 4, 'Backward pivot.'),
  ('Free Skating 1', 'assessment', 5, 'Back spin from a pivot entrance.'),
  ('Free Skating 1', 'assessment', 6, 'Spiral Sequence (min. two different spirals).'),
  ('Free Skating 1', 'assessment', 7, 'One Foot Spin (3 revolutions with correct entry).'),
  ('Free Skating 1', 'assessment', 8, 'Width of rink Step Sequence (min. of two different turns and three different steps).'),

  ('Free Skating 2', 'teaching', 1, '360 degree two foot jump on the spot.'),
  ('Free Skating 2', 'teaching', 2, '2-foot spin in sitting position.'),
  ('Free Skating 2', 'assessment', 1, 'Half flip jump.'),
  ('Free Skating 2', 'assessment', 2, 'Salchow jump.'),
  ('Free Skating 2', 'assessment', 3, 'Loop jump.'),
  ('Free Skating 2', 'assessment', 4, '1-foot spin 3 revolutions (correct entry).'),
  ('Free Skating 2', 'assessment', 5, 'Inside Ina Bauer or forward inside spread eagle.'),
  ('Free Skating 2', 'assessment', 6, 'Jump combination - waltz jump / toe loop jump.'),
  ('Free Skating 2', 'assessment', 7, 'Width of rink Step Sequence (min. of three different turns and four different steps).'),

  ('Free Skating 3', 'assessment', 1, 'Stag jump.'),
  ('Free Skating 3', 'assessment', 2, 'Back spin (correct entry).'),
  ('Free Skating 3', 'assessment', 3, 'Camel spin or sit spin (three revolutions).'),
  ('Free Skating 3', 'assessment', 4, 'Jump combination - salchow jump / loop jump.'),
  ('Free Skating 3', 'assessment', 5, 'Half lutz jump.'),
  ('Free Skating 3', 'assessment', 6, 'Flip jump.'),
  ('Free Skating 3', 'assessment', 7, 'Width of rink Step Sequence (min. of four different turns and five different steps).'),

  ('Freestyle', 'assessment', 1, 'A one and a half minute programme to music, to include at least four different jumps, a minimum of two spins, one or more forward or backward spiral, spread eagle or pivot movements, simple connecting movements, one step sequence, and an opening and closing movement. Other movements allowed.'),

  -- 706 Dance
  ('Dance 1', 'assessment', 1, 'Forward outside swing rolls (count of six).'),
  ('Dance 1', 'assessment', 2, 'Forward progressives (Dutch Waltz timing).'),
  ('Dance 1', 'assessment', 3, 'Dutch Waltz (skated to music with a partner/solo).'),
  ('Dance 1', 'assessment', 4, 'Forward chasses (count of four).'),
  ('Dance 1', 'assessment', 5, 'Forward slide chasses (count of four).'),

  ('Dance 2', 'assessment', 1, 'Forward progressives (Canasta timing).'),
  ('Dance 2', 'assessment', 2, 'Forward cross rolls.'),
  ('Dance 2', 'assessment', 3, 'Forward progressives/chasse (one count per step).'),
  ('Dance 2', 'assessment', 4, 'Swing change of edge.'),
  ('Dance 2', 'assessment', 5, 'Forward swing rolls (count of four).'),
  ('Dance 2', 'assessment', 6, 'Canasta Tango (skated to music with a partner/solo).'),
  ('Dance 2', 'assessment', 7, 'Rhythm Blues (skated to music with partner/solo).'),

  ('Dance 3', 'assessment', 1, 'Backward swing rolls (count of four).'),
  ('Dance 3', 'assessment', 2, 'Backward chasses (count of four).'),
  ('Dance 3', 'assessment', 3, 'RFI - LBI Mohawk (open, closed or swing; count of two plus two).'),
  ('Dance 3', 'assessment', 4, 'LFO RFI LFO RFI progressive steps Mohawk (RFI - LBI)/RBO. Repeat on a circle (two counts per step).'),
  ('Dance 3', 'assessment', 5, 'Swing Dance (skated to music with a partner/solo).'),

  ('Dance 4', 'assessment', 1, 'Forward cross rolls (count of two).'),
  ('Dance 4', 'assessment', 2, 'Cross step (count of two).'),
  ('Dance 4', 'assessment', 3, 'RFOI change of edge (count of four plus two).'),
  ('Dance 4', 'assessment', 4, 'RFI - LBI open Mohawk (count of one plus one).'),
  ('Dance 4', 'assessment', 5, 'Fiesta Tango (skated to music with a partner/solo).'),

  ('Dance 5', 'assessment', 1, 'Backward progressives (count of four).'),
  ('Dance 5', 'assessment', 2, 'LFO - RBO open Mohawk (count of one plus one).'),
  ('Dance 5', 'assessment', 3, 'FO - BI closed three turn (RFO for man, LFO for lady) (count of one plus one).'),
  ('Dance 5', 'assessment', 4, 'RFO roll with knee bend (count of four).'),
  ('Dance 5', 'assessment', 5, 'Riverside Rhumba (skated to music with or without a partner).'),

  ('Dance 6', 'assessment', 1, 'RFI - LBI Mohawk (count of three plus three).'),
  ('Dance 6', 'assessment', 2, 'RFO - LBI closed three turn (count of two plus one)/LBO - RBI - LBO progressive. Repeat on a clockwise circle.'),
  ('Dance 6', 'assessment', 3, 'Willow Waltz (skated to music with or without a partner).'),
  ('Dance 6', 'assessment', 4, 'Ten-Fox (skated to music with or without a partner).'),

  -- 707 Synchronized Skating
  ('Synchronized Skating 1', 'assessment', 1, 'Forward line with or without a change of configuration.'),
  ('Synchronized Skating 1', 'assessment', 2, 'Circle: optional steps.'),
  ('Synchronized Skating 1', 'assessment', 3, 'Two spoke wheel (shoulder, waist or hand hold).'),
  ('Synchronized Skating 1', 'assessment', 4, 'Forward diagonal cross through (splicing).'),
  ('Synchronized Skating 1', 'assessment', 5, 'Forward circle (optional hold, clockwise and counter clockwise) with a change of direction.'),
  ('Synchronized Skating 1', 'assessment', 6, 'Footwork sequence in a line formation.'),
  ('Synchronized Skating 1', 'assessment', 7, 'Forward or backward block with a change of configuration.'),

  ('Synchronized Skating 2', 'assessment', 1, 'Forward or backward horizontal line (1/2 length of rink or more).'),
  ('Synchronized Skating 2', 'assessment', 2, 'Two spoke wheel (optional hold) forwards or backwards.'),
  ('Synchronized Skating 2', 'assessment', 3, 'Forward intersection.'),
  ('Synchronized Skating 2', 'assessment', 4, 'Circle formation: forward crosscuts/three turn or mohawk/backwards crosscuts/three turn or Mohawk (optional hold). Repeat twice.'),
  ('Synchronized Skating 2', 'assessment', 5, 'Step sequence in block formation or block with a change of configuration.'),

  -- 708 Pair Skating
  ('Pair Skating 1', 'teaching', 1, 'Forward and backward crossovers (Figure 8 pattern).'),
  ('Pair Skating 1', 'teaching', 2, 'Side by side single jumps.'),
  ('Pair Skating 1', 'teaching', 3, 'Different turns of directions side by side.'),
  ('Pair Skating 1', 'teaching', 4, 'Backward spirals.'),
  ('Pair Skating 1', 'assessment', 1, 'FO edges (side by side).'),
  ('Pair Skating 1', 'assessment', 2, 'FI edges (side by side).'),
  ('Pair Skating 1', 'assessment', 3, 'Inside 3-turns (side by side).'),
  ('Pair Skating 1', 'assessment', 4, 'Forward spirals (side by side).'),
  ('Pair Skating 1', 'assessment', 5, 'Solo spins (emphasis on unison for entry and exit).'),
  ('Pair Skating 1', 'assessment', 6, 'T-pushes (using hand-to-hand hold).'),

  ('Pair Skating 2', 'teaching', 1, 'Spiral with changes of hold.'),
  ('Pair Skating 2', 'teaching', 2, 'Pivot spirals.'),
  ('Pair Skating 2', 'teaching', 3, 'Steps and turns together.'),
  ('Pair Skating 2', 'assessment', 1, 'BO edges (side by side).'),
  ('Pair Skating 2', 'assessment', 2, 'BI edges (side by side).'),
  ('Pair Skating 2', 'assessment', 3, 'Simple step sequence.'),
  ('Pair Skating 2', 'assessment', 4, 'Forward and backward crossovers (Figure 8 pattern) (hand-to-hand hold).'),
  ('Pair Skating 2', 'assessment', 5, 'Single jumps (using hand-to-hand hold on entry).'),

  ('Pair Skating 3', 'assessment', 1, 'FI Mohawk, BI 3 turn (side by side).'),
  ('Pair Skating 3', 'assessment', 2, 'Spiral sequence (different holds required).'),
  ('Pair Skating 3', 'assessment', 3, 'Pivot spiral (1 full rotation).'),
  ('Pair Skating 3', 'assessment', 4, 'Single + single jump sequence.'),
  ('Pair Skating 3', 'assessment', 5, 'Pair upright spin (hand to hip hold).'),
  ('Pair Skating 3', 'assessment', 6, 'Programme of up to 1 minute 30 second duration with 5 elements from Pair Skating badges 1 to 3 (to be skated with or without music).')
) as v(badge, kind, n, description)
join public.badge b on b.name = v.badge;

-- ---------------------------------------------------------------------------
-- Audit. Created after loading the reference data, so the official rules are
-- not logged as edits; changes from here on are.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['badge', 'badge_skill', 'skill_achievement', 'badge_pass'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()',
      t || '_audit', t);
  end loop;
end;
$$;
