import { ageOn } from './dates';
import { compareMembershipNumbers } from './membershipNumber';
import type { Contact, Lookups, PersonDetail, PersonMembershipLink } from './types';

/** Same columns, in the same order, as the club's existing Google Sheet. */
export const SHEET_HEADERS = [
  'Membership #',
  'First Name',
  'Last Name',
  'Age',
  'Gender',
  'Skater',
  'Ethnicity',
  'Address',
  'Town/City',
  'Postcode',
  'Country',
  'Email',
  'Phone Number',
  'Parent/Guardian if under 18',
  'Emergency Contact if over 18',
  'Agree to CofC',
  'share NZIFSA',
  'Liability Waiver',
  'Member since',
  'Member type',
  'card done?',
  'Expiry',
  'Type',
  'Membership of other club',
  'Name of Club',
] as const;

export function latestMembership(person: PersonDetail): PersonMembershipLink | undefined {
  return [...person.membership_member].sort((a, b) =>
    b.membership.season_start.localeCompare(a.membership.season_start),
  )[0];
}

function formatContact(c: Contact): string {
  return [c.name, c.relationship ? `(${c.relationship})` : '', c.phone ?? '', c.email ?? '']
    .filter(Boolean)
    .join(' ');
}

/**
 * One row per person who has ever held a membership.
 * Guardians go in the "Parent/Guardian" column and other contacts in
 * "Emergency Contact", whatever the person's age, so nothing is dropped.
 */
export function memberExportRows(
  people: PersonDetail[],
  lookups: Lookups,
  today: string,
): string[][] {
  const gender = new Map(lookups.genders.map((g) => [g.code, g.label]));
  const ethnicity = new Map(lookups.ethnicities.map((e) => [e.code, e]));
  const memberType = new Map(lookups.memberTypes.map((t) => [t.id, t.name]));

  const rows = people
    .map((p) => ({ p, latest: latestMembership(p) }))
    .filter((x): x is { p: PersonDetail; latest: PersonMembershipLink } => !!x.latest)
    .sort(
      (a, b) =>
        compareMembershipNumbers(a.p.membership_number, b.p.membership_number) ||
        a.p.last_name.localeCompare(b.p.last_name) ||
        a.p.first_name.localeCompare(b.p.first_name),
    );

  return rows.map(({ p, latest }) => {
    const ethnicities = p.person_ethnicity
      .map((e) => ethnicity.get(e.ethnicity_code))
      .filter((e) => e !== undefined)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((e) => e.label)
      .join('; ');
    const clubs = p.person_other_club.map((c) => c.club_name).sort();
    const kind = latest.membership.kind;
    return [
      p.membership_number ?? '',
      p.first_name,
      p.last_name,
      p.date_of_birth ? String(ageOn(p.date_of_birth, today)) : '',
      p.gender_code ? (gender.get(p.gender_code) ?? p.gender_code) : '',
      p.in_skate_school ? 'Y' : 'N',
      ethnicities,
      p.address_line ?? '',
      p.town_city ?? '',
      p.postcode ?? '',
      p.country ?? '',
      p.email ?? '',
      p.phone ?? '',
      p.contact.filter((c) => c.is_guardian).map(formatContact).join('; '),
      p.contact.filter((c) => !c.is_guardian).map(formatContact).join('; '),
      p.coc_agreed_on ?? '',
      p.nzifsa_share_agreed_on ?? '',
      p.waiver_agreed_on ?? '',
      p.member_since ?? '',
      latest.member_type_id != null ? (memberType.get(latest.member_type_id) ?? '') : '',
      latest.card_issued_on ? 'Y' : 'N',
      latest.membership.expires_on,
      kind === 'family' ? 'Family' : 'Individual',
      clubs.length ? 'Y' : 'N',
      clubs.join('; '),
    ];
  });
}
