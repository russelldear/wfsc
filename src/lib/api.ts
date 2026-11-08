import type { PostgrestError } from '@supabase/supabase-js';
import type { ImportPayload } from './importMembers';
import { supabase } from './supabase';
import type {
  Badge,
  BadgeCatalog,
  BadgePass,
  BadgeSkill,
  BadgeSkillKind,
  BadgeStream,
  Contact,
  Lookups,
  MemberSummary,
  MembershipKind,
  PersonDetail,
  PersonFields,
  SkaterProgress,
  SkillAchievement,
} from './types';

/** Turns database errors into messages a committee member can act on. */
export function friendlyError(error: unknown): string {
  const e = error as Partial<PostgrestError> & { message?: string };
  if (e?.code === '23505') {
    if (e.message?.includes('person_id_season_start')) {
      return 'That person already has a membership for that season.';
    }
    if (e.message?.includes('membership_number')) {
      return 'That membership number is already in use.';
    }
    return 'That would create a duplicate.';
  }
  if (e?.code === '23503') {
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
