import type { PostgrestError } from '@supabase/supabase-js';
import type { ImportPayload } from './importMembers';
import { supabase } from './supabase';
import type {
  AppRole,
  AppUser,
  Badge,
  BadgeCatalog,
  BadgePass,
  BadgeSkill,
  BadgeSkillKind,
  BadgeStream,
  ClassDetail,
  ClassSkater,
  Contact,
  Lookups,
  MemberSummary,
  MembershipKind,
  PersonDetail,
  PersonFields,
  RoleInvite,
  SkaterProgress,
  SkateClass,
  SkateClassFields,
  SkillAchievement,
  Term,
} from './types';

/** Turns database errors into messages a committee member can act on. */
export function friendlyError(error: unknown): string {
  const e = error as Partial<PostgrestError> & { message?: string };
  if (e?.code === '23505') {
    if (e.message?.includes('person_id_season_start')) {
      return 'That person already has a membership for that season.';
    }
    if (e.message?.includes('person_id_term_id')) {
      return 'That skater is already in a class this term.';
    }
    if (e.message?.includes('skate_class_term_id_name')) {
      return 'There is already a class with that name this term.';
    }
    if (e.message?.includes('term_name')) {
      return 'There is already a term with that name.';
    }
    if (e.message?.includes('membership_number')) {
      return 'That membership number is already in use.';
    }
    return 'That would create a duplicate.';
  }
  if (e?.code === '23503') {
    if (e.message?.includes('skate_class_term_id_fkey')) {
      return 'That term still has classes. Delete its classes first.';
    }
    return 'That is still in use, so it cannot be removed.';
  }
  if (e?.code === '42501') {
    return 'You do not have permission to do that.';
  }
  return e?.message ?? String(error);
}

function check<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

const PERSON_SELECT = `
  *,
  enrolment(term_id, class_id, skate_class(id, name, term(id, name, starts_on))),
  contact(*),
  person_ethnicity(ethnicity_code),
  person_other_club(id, club_name),
  membership_member(
    member_type_id, card_issued_on,
    membership(
      id, kind, season_start, expires_on, paid_on,
      membership_member(
        person_id, member_type_id, card_issued_on,
        person(id, first_name, last_name, membership_number)
      )
    )
  )
`;

export async function fetchLookups(): Promise<Lookups> {
  const [genders, ethnicities, memberTypes] = await Promise.all([
    supabase.from('gender').select('*').order('sort_order'),
    supabase.from('ethnicity').select('*').order('sort_order'),
    supabase.from('member_type').select('*').order('name'),
  ]);
  return {
    genders: check(genders),
    ethnicities: check(ethnicities),
    memberTypes: check(memberTypes),
  };
}

export async function listMembers(): Promise<MemberSummary[]> {
  return check(
    await supabase
      .from('member_summary')
      .select('*')
      .order('last_name')
      .order('first_name'),
  ) as MemberSummary[];
}

export async function getPerson(id: string): Promise<PersonDetail> {
  return check(
    await supabase.from('person').select(PERSON_SELECT).eq('id', id).single(),
  ) as unknown as PersonDetail;
}

/** Every person with all their details, fetched in pages. */
export async function listPeopleForExport(): Promise<PersonDetail[]> {
  const pageSize = 500;
  const all: PersonDetail[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = check(
      await supabase
        .from('person')
        .select(PERSON_SELECT)
        .order('id')
        .range(from, from + pageSize - 1),
    ) as unknown as PersonDetail[];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export interface SavePersonInput {
  id?: string;
  fields: PersonFields;
  contacts: Contact[];
  ethnicities: string[];
  otherClubs: string[];
}

export async function savePerson(input: SavePersonInput): Promise<string> {
  return check(
    await supabase.rpc('save_person', {
      p_person: { ...input.fields, id: input.id ?? null },
      p_contacts: input.contacts,
      p_ethnicities: input.ethnicities,
      p_other_clubs: input.otherClubs,
    }),
  ) as string;
}

export async function createMembership(
  kind: MembershipKind,
  seasonStart: string,
  paidOn: string | null,
  members: { person_id: string; member_type_id: number | null }[],
): Promise<string> {
  return check(
    await supabase.rpc('create_membership', {
      p_kind: kind,
      p_season_start: seasonStart,
      p_paid_on: paidOn,
      p_members: members,
    }),
  ) as string;
}

export async function renewMembership(membershipId: string, paidOn: string): Promise<string> {
  return check(
    await supabase.rpc('renew_membership', {
      p_membership_id: membershipId,
      p_paid_on: paidOn,
    }),
  ) as string;
}

export async function updateMembership(id: string, changes: { paid_on: string | null }) {
  check(await supabase.from('membership').update(changes).eq('id', id));
}

export async function deleteMembership(id: string) {
  check(await supabase.from('membership').delete().eq('id', id));
}

export async function updateMembershipMember(
  membershipId: string,
  personId: string,
  changes: { member_type_id?: number | null; card_issued_on?: string | null },
) {
  check(
    await supabase
      .from('membership_member')
      .update(changes)
      .eq('membership_id', membershipId)
      .eq('person_id', personId),
  );
}

export async function removeFromMembership(membershipId: string, personId: string) {
  check(
    await supabase
      .from('membership_member')
      .delete()
      .eq('membership_id', membershipId)
      .eq('person_id', personId),
  );
}

export async function addMemberType(name: string) {
  check(await supabase.from('member_type').insert({ name }));
}

export async function updateMemberType(id: number, changes: { name?: string; active?: boolean }) {
  check(await supabase.from('member_type').update(changes).eq('id', id));
}

/** Moves a person onto a family membership, replacing a solo one that season. */
export async function joinFamilyMembership(
  membershipId: string,
  personId: string,
  memberTypeId: number | null,
) {
  check(
    await supabase.rpc('join_family_membership', {
      p_membership_id: membershipId,
      p_person_id: personId,
      p_member_type_id: memberTypeId,
    }),
  );
}

/** Imports people all at once; nothing is saved if any row fails. */
export async function importMembers(rows: ImportPayload[]): Promise<number> {
  return check(await supabase.rpc('import_members', { p_rows: rows })) as number;
}

export async function existingMembershipNumbers(): Promise<Set<string>> {
  const rows = check(
    await supabase.from('person').select('membership_number').not('membership_number', 'is', null),
  ) as { membership_number: string }[];
  return new Set(rows.map((r) => r.membership_number));
}

// ---------------------------------------------------------------------------
// Kiwiskate
// ---------------------------------------------------------------------------

export async function fetchBadgeCatalog(): Promise<BadgeCatalog> {
  const [streams, badges, skills] = await Promise.all([
    supabase.from('badge_stream').select('*').order('sort_order'),
    supabase.from('badge').select('*').order('sort_order'),
    supabase.from('badge_skill').select('*').order('sort_order'),
  ]);
  return {
    streams: check(streams) as BadgeStream[],
    badges: check(badges) as Badge[],
    skills: check(skills) as BadgeSkill[],
  };
}

export async function getSkaterProgress(personId: string): Promise<SkaterProgress> {
  const [achievements, passes] = await Promise.all([
    supabase.from('skill_achievement').select('person_id, skill_id, achieved_on, note').eq('person_id', personId),
    supabase.from('badge_pass').select('*').eq('person_id', personId),
  ]);
  return {
    achievements: check(achievements) as SkillAchievement[],
    passes: check(passes) as BadgePass[],
  };
}

export async function tickSkill(personId: string, skillId: number, achievedOn: string) {
  check(
    await supabase
      .from('skill_achievement')
      .insert({ person_id: personId, skill_id: skillId, achieved_on: achievedOn }),
  );
}

export async function untickSkill(personId: string, skillId: number) {
  check(await supabase.from('skill_achievement').delete().eq('person_id', personId).eq('skill_id', skillId));
}

export async function updateSkillAchievement(
  personId: string,
  skillId: number,
  changes: { achieved_on?: string; note?: string | null },
) {
  check(
    await supabase.from('skill_achievement').update(changes).eq('person_id', personId).eq('skill_id', skillId),
  );
}

export async function recordBadgePass(input: Omit<BadgePass, 'id'>) {
  check(await supabase.from('badge_pass').insert(input));
}

export async function deleteBadgePass(id: string) {
  check(await supabase.from('badge_pass').delete().eq('id', id));
}

export async function updateBadgeSkill(id: number, changes: { description: string }) {
  check(await supabase.from('badge_skill').update(changes).eq('id', id));
}

export async function addBadgeSkill(badgeId: number, kind: BadgeSkillKind, description: string, sortOrder: number) {
  check(
    await supabase
      .from('badge_skill')
      .insert({ badge_id: badgeId, kind, description, sort_order: sortOrder }),
  );
}

export async function deleteBadgeSkill(id: number) {
  check(await supabase.from('badge_skill').delete().eq('id', id));
}

export async function updateBadge(
  id: number,
  changes: { description?: string | null; prerequisite_id?: number | null; max_age?: number | null },
) {
  check(await supabase.from('badge').update(changes).eq('id', id));
}

/** Ticks and passes for several skaters at once (e.g. a class). */
export async function getProgressForPeople(personIds: string[]): Promise<Map<string, SkaterProgress>> {
  const result = new Map<string, SkaterProgress>(personIds.map((id) => [id, { achievements: [], passes: [] }]));
  if (personIds.length === 0) return result;
  const [achievements, passes] = await Promise.all([
    supabase.from('skill_achievement').select('person_id, skill_id, achieved_on, note').in('person_id', personIds),
    supabase.from('badge_pass').select('*').in('person_id', personIds),
  ]);
  for (const a of check(achievements) as SkillAchievement[]) result.get(a.person_id)?.achievements.push(a);
  for (const p of check(passes) as BadgePass[]) result.get(p.person_id)?.passes.push(p);
  return result;
}

// ---------------------------------------------------------------------------
// Terms, classes and enrolments
// ---------------------------------------------------------------------------

export async function listTerms(): Promise<Term[]> {
  return check(await supabase.from('term').select('*').order('starts_on', { ascending: false })) as Term[];
}

export async function getCurrentTermId(): Promise<string | null> {
  return check(await supabase.rpc('current_term_id')) as string | null;
}

export async function createTerm(input: Omit<Term, 'id'>): Promise<string> {
  const row = check(await supabase.from('term').insert(input).select('id').single()) as { id: string };
  return row.id;
}

export async function updateTerm(id: string, changes: Partial<Omit<Term, 'id'>>) {
  check(await supabase.from('term').update(changes).eq('id', id));
}

export async function deleteTerm(id: string) {
  check(await supabase.from('term').delete().eq('id', id));
}

interface ClassRow extends SkateClassFields {
  id: string;
  term_id: string;
  skate_class_badge: { badge_id: number }[];
  enrolment: { count: number }[];
}

function toSkateClass(r: ClassRow): SkateClass {
  return {
    id: r.id,
    term_id: r.term_id,
    name: r.name,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    min_age: r.min_age,
    max_age: r.max_age,
    coach_name: r.coach_name,
    badge_ids: r.skate_class_badge.map((b) => b.badge_id),
    enrolled: r.enrolment[0]?.count ?? 0,
  };
}

export async function listClasses(termId: string): Promise<SkateClass[]> {
  const rows = check(
    await supabase
      .from('skate_class')
      .select('*, skate_class_badge(badge_id), enrolment(count)')
      .eq('term_id', termId)
      .order('starts_at', { nullsFirst: false })
      .order('name'),
  ) as ClassRow[];
  return rows.map(toSkateClass);
}

export async function getClass(id: string): Promise<ClassDetail> {
  const row = check(
    await supabase
      .from('skate_class')
      .select('*, skate_class_badge(badge_id), enrolment(count), term(*)')
      .eq('id', id)
      .single(),
  ) as unknown as ClassRow & { term: Term };
  const skaters = await termSkaters(row.term_id);
  return { ...toSkateClass(row), term: row.term, skaters: skaters.filter((s) => s.class_id === id) };
}

/** Skaters enrolled in a term: names and ages (works for coaches too). */
export async function termSkaters(termId: string): Promise<ClassSkater[]> {
  const rows = check(await supabase.rpc('term_skaters', { p_term_id: termId })) as (Omit<ClassSkater, 'id'> & {
    person_id: string;
  })[];
  return rows.map(({ person_id, ...rest }) => ({ id: person_id, ...rest }));
}

export async function saveClass(
  input: { id?: string; term_id: string; fields: SkateClassFields; badge_ids: number[] },
): Promise<string> {
  let id = input.id;
  if (id) {
    check(await supabase.from('skate_class').update(input.fields).eq('id', id));
  } else {
    const row = check(
      await supabase.from('skate_class').insert({ ...input.fields, term_id: input.term_id }).select('id').single(),
    ) as { id: string };
    id = row.id;
  }
  const current = check(
    await supabase.from('skate_class_badge').select('badge_id').eq('class_id', id),
  ) as { badge_id: number }[];
  const have = new Set(current.map((c) => c.badge_id));
  const want = new Set(input.badge_ids);
  const remove = [...have].filter((b) => !want.has(b));
  const add = [...want].filter((b) => !have.has(b));
  if (remove.length) {
    check(await supabase.from('skate_class_badge').delete().eq('class_id', id).in('badge_id', remove));
  }
  if (add.length) {
    check(await supabase.from('skate_class_badge').insert(add.map((badge_id) => ({ class_id: id, badge_id }))));
  }
  return id;
}

export async function deleteClass(id: string) {
  check(await supabase.from('skate_class').delete().eq('id', id));
}

/** Copies a term's classes (names, times, ages, coach, badges) into another term, without skaters. */
export async function copyClasses(fromTermId: string, toTermId: string) {
  for (const c of await listClasses(fromTermId)) {
    await saveClass({
      term_id: toTermId,
      fields: {
        name: c.name,
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        min_age: c.min_age,
        max_age: c.max_age,
        coach_name: c.coach_name,
      },
      badge_ids: c.badge_ids,
    });
  }
}

export async function listEnrolments(termId: string): Promise<{ class_id: string; person_id: string }[]> {
  return check(
    await supabase.from('enrolment').select('class_id, person_id').eq('term_id', termId),
  ) as { class_id: string; person_id: string }[];
}

export async function enrol(classId: string, personId: string) {
  check(await supabase.from('enrolment').insert({ class_id: classId, person_id: personId }));
}

export async function moveEnrolment(personId: string, termId: string, toClassId: string) {
  check(
    await supabase.from('enrolment').update({ class_id: toClassId }).eq('person_id', personId).eq('term_id', termId),
  );
}

export async function unenrol(personId: string, termId: string) {
  check(await supabase.from('enrolment').delete().eq('person_id', personId).eq('term_id', termId));
}

// ---------------------------------------------------------------------------
// Access management (admins)
// ---------------------------------------------------------------------------

export async function listAppUsers(): Promise<AppUser[]> {
  return check(await supabase.rpc('list_app_users')) as AppUser[];
}

export async function listInvites(): Promise<RoleInvite[]> {
  return check(await supabase.from('role_invite').select('email, role, invited_at').order('email')) as RoleInvite[];
}

export async function inviteUser(email: string, role: AppRole): Promise<'granted' | 'invited'> {
  return check(await supabase.rpc('invite_user', { p_email: email, p_role: role })) as 'granted' | 'invited';
}

export async function cancelInvite(email: string, role: AppRole) {
  check(await supabase.from('role_invite').delete().eq('email', email).eq('role', role));
}

export async function grantRole(userId: string, role: AppRole) {
  check(await supabase.rpc('grant_role', { p_user_id: userId, p_role: role }));
}

export async function revokeRole(userId: string, role: AppRole) {
  check(await supabase.rpc('revoke_role', { p_user_id: userId, p_role: role }));
}
