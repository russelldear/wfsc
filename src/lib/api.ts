import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  Contact,
  Lookups,
  MemberSummary,
  MembershipKind,
  PersonDetail,
  PersonFields,
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

export async function addToMembership(
  membershipId: string,
  personId: string,
  memberTypeId: number | null,
) {
  check(
    await supabase.from('membership_member').insert({
      membership_id: membershipId,
      person_id: personId,
      member_type_id: memberTypeId,
    }),
  );
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
