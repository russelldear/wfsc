import { currentSeasonStart } from './dates';
import { isMembershipNumber } from './membershipNumber';
import type { Contact, Lookups, MembershipKind, PersonFields } from './types';

/**
 * Turns rows from the club's Google Sheet export into import payloads.
 * Nothing here talks to the database: the result is shown to the committee
 * for checking before anything is saved.
 */

export interface ImportMembership {
  kind: MembershipKind;
  season_start: string;
  paid_on: null;
  member_type_id: number | null;
  card_issued_on: string | null;
}

export interface ImportPayload {
  line: number;
  person: PersonFields;
  contacts: Contact[];
  ethnicities: string[];
  other_clubs: string[];
  membership: ImportMembership | null;
}

export interface InterpretedRow {
  line: number;
  name: string;
  payload: ImportPayload;
  errors: string[];
  warnings: string[];
}

export interface Interpretation {
  /** Problems with the file as a whole, e.g. missing name columns. */
  fileErrors: string[];
  rows: InterpretedRow[];
  /** Member type names in the file that do not exist yet. */
  missingMemberTypes: string[];
  /** Columns present in the file that the importer does not use. */
  ignoredColumns: string[];
}

const COLUMNS = {
  number: 'membership #',
  first: 'first name',
  last: 'last name',
  age: 'age',
  gender: 'gender',
  skater: 'skater',
  ethnicity: 'ethnicity',
  address: 'address',
  town: 'town/city',
  postcode: 'postcode',
  country: 'country',
  email: 'email',
  phone: 'phone number',
  guardian: 'parent/guardian if under 18',
  emergency: 'emergency contact if over 18',
  coc: 'agree to cofc',
  nzifsa: 'share nzifsa',
  waiver: 'liability waiver',
  since: 'member since',
  memberType: 'member type',
  card: 'card done?',
  expiry: 'expiry',
  type: 'type',
  otherClub: 'membership of other club',
  clubName: 'name of club',
} as const;

type ColumnKey = keyof typeof COLUMNS;

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lower-case, trimmed, with macrons removed, for forgiving comparisons. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const ETHNICITY_SYNONYMS: Record<string, string> = {
  european: 'european',
  'nz european': 'european',
  'new zealand european': 'european',
  pakeha: 'european',
  maori: 'maori',
  'nz maori': 'maori',
  pacific: 'pacific',
  'pacific peoples': 'pacific',
  'pacific islander': 'pacific',
  pasifika: 'pacific',
  samoan: 'pacific',
  tongan: 'pacific',
  fijian: 'pacific',
  niuean: 'pacific',
  'cook islands maori': 'pacific',
  'cook island maori': 'pacific',
  asian: 'asian',
  chinese: 'asian',
  indian: 'asian',
  korean: 'asian',
  japanese: 'asian',
  filipino: 'asian',
  melaa: 'melaa',
  'middle eastern': 'melaa',
  'latin american': 'melaa',
  african: 'melaa',
  other: 'other',
  'prefer not to say': 'not_stated',
  'not stated': 'not_stated',
};

const GENDER_SYNONYMS: Record<string, string> = {
  f: 'female',
  female: 'female',
  girl: 'female',
  woman: 'female',
  m: 'male',
  male: 'male',
  boy: 'male',
  man: 'male',
  'another gender': 'another',
  other: 'another',
  'non-binary': 'another',
  nonbinary: 'another',
  'prefer not to say': 'not_stated',
  'not stated': 'not_stated',
};

const YES = new Set(['y', 'yes', 'true', '1', 'x', '✓', '✔']);
const NO = new Set(['n', 'no', 'false', '0', '']);

/** dd/mm/yyyy (also d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy) or yyyy-mm-dd. */
export function parseNzDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function splitList(value: string): string[] {
  return value
    .split(/[,;/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function interpretSheet(
  table: string[][],
  lookups: Lookups,
  existingNumbers: ReadonlySet<string>,
  today: string,
): Interpretation {
  const [header, ...body] = table;
  const result: Interpretation = {
    fileErrors: [],
    rows: [],
    missingMemberTypes: [],
    ignoredColumns: [],
  };
  if (!header) {
    result.fileErrors.push('The file is empty.');
    return result;
  }

  const index = new Map<ColumnKey, number>();
  const known = new Map<string, ColumnKey>(
    Object.entries(COLUMNS).map(([k, h]) => [h, k as ColumnKey]),
  );
  header.forEach((h, i) => {
    const key = known.get(normaliseHeader(h));
    if (key && !index.has(key)) index.set(key, i);
    else if (h.trim()) result.ignoredColumns.push(h.trim());
  });
  for (const required of ['first', 'last'] as const) {
    if (!index.has(required)) {
      result.fileErrors.push(`Missing a "${COLUMNS[required]}" column (headers are matched by name).`);
    }
  }
  if (result.fileErrors.length) return result;

  const genderByLabel = new Map(lookups.genders.map((g) => [fold(g.label), g.code]));
  const ethnicityByLabel = new Map(lookups.ethnicities.map((e) => [fold(e.label), e.code]));
  const typeByName = new Map(lookups.memberTypes.map((t) => [fold(t.name), t.id]));
  const missingTypes = new Map<string, string>();
  const numbersInFile = new Map<string, number>();

  body.forEach((cells, i) => {
    const line = i + 2; // spreadsheet row number, counting the header as row 1
    const get = (key: ColumnKey) => {
      const idx = index.get(key);
      return idx === undefined ? '' : (cells[idx] ?? '').trim();
    };
    const errors: string[] = [];
    const warnings: string[] = [];

    const date = (key: ColumnKey, label: string): string | null => {
      const raw = get(key);
      if (!raw) return null;
      const parsed = parseNzDate(raw);
      if (!parsed) warnings.push(`${label} "${raw}" is not a dd/mm/yyyy date, so it was left blank.`);
      return parsed;
    };

    const yesNo = (key: ColumnKey, label: string): boolean => {
      const raw = fold(get(key));
      if (YES.has(raw)) return true;
      if (!NO.has(raw)) warnings.push(`${label} "${get(key)}" is not Y or N, so it was treated as N.`);
      return false;
    };

    // Membership number
    let membershipNumber: string | null = null;
    const rawNumber = get('number');
    if (rawNumber) {
      if (isMembershipNumber(rawNumber)) {
        membershipNumber = rawNumber;
        if (existingNumbers.has(membershipNumber)) {
          errors.push(`Membership #${membershipNumber} is already in the database.`);
        }
        const earlier = numbersInFile.get(membershipNumber);
        if (earlier) errors.push(`Membership #${membershipNumber} is also used on row ${earlier}.`);
        else numbersInFile.set(membershipNumber, line);
      } else {
        errors.push(`Membership # "${rawNumber}" is not in the form 22/006.`);
      }
    } else {
      warnings.push('No membership number: a new one will be assigned.');
    }

    const first = get('first');
    const last = get('last');
    if (!first) errors.push('First name is blank.');
    if (!last) errors.push('Last name is blank.');

    // Gender
    let genderCode: string | null = null;
    const rawGender = get('gender');
    if (rawGender) {
      const f = fold(rawGender);
      genderCode = genderByLabel.get(f) ?? GENDER_SYNONYMS[f] ?? null;
      if (!genderCode) warnings.push(`Gender "${rawGender}" was not recognised, so it was left blank.`);
    }

    // Ethnicity
    const ethnicities = new Set<string>();
    for (const part of splitList(get('ethnicity'))) {
      const f = fold(part);
      const code = ethnicityByLabel.get(f) ?? ETHNICITY_SYNONYMS[f];
      if (code) ethnicities.add(code);
      else warnings.push(`Ethnicity "${part}" was not recognised, so it was left out.`);
    }

    // Contacts: the Sheet holds free text, so it is kept as the contact's
    // name for the committee to tidy up later.
    const contacts: Contact[] = [];
    const guardian = get('guardian');
    if (guardian) {
      contacts.push({ name: guardian, relationship: 'Parent/guardian', phone: null, email: null, is_guardian: true });
    }
    const emergency = get('emergency');
    if (emergency) {
      contacts.push({ name: emergency, relationship: 'Emergency contact', phone: null, email: null, is_guardian: false });
    }

    // Other clubs
    const clubs = splitList(get('clubName'));
    const otherClubFlag = get('otherClub');
    if (otherClubFlag && YES.has(fold(otherClubFlag)) && clubs.length === 0) {
      warnings.push('Marked as a member of another club, but no club name is given.');
    }

    // Membership
    let membership: ImportMembership | null = null;
    const rawExpiry = get('expiry');
    if (rawExpiry) {
      const expiry = parseNzDate(rawExpiry);
      if (!expiry) {
        errors.push(`Expiry "${rawExpiry}" is not a dd/mm/yyyy date.`);
      } else {
        const seasonStart = currentSeasonStart(expiry);
        if (!expiry.endsWith('-09-30')) {
          warnings.push(
            `Expiry ${rawExpiry} is not 30 September; imported as the season ending ` +
              `30/09/${Number(seasonStart.slice(0, 4)) + 1}.`,
          );
        }

        const rawType = fold(get('type'));
        let kind: MembershipKind = 'individual';
        if (rawType === 'family' || rawType === 'f') kind = 'family';
        else if (rawType !== 'individual' && rawType !== 'i') {
          warnings.push(`Type "${get('type')}" is not Individual or Family; imported as Individual.`);
        }

        let memberTypeId: number | null = null;
        const rawMemberType = get('memberType');
        if (rawMemberType) {
          memberTypeId = typeByName.get(fold(rawMemberType)) ?? null;
          if (memberTypeId === null && !missingTypes.has(fold(rawMemberType))) {
            missingTypes.set(fold(rawMemberType), rawMemberType);
          }
        }

        membership = {
          kind,
          season_start: seasonStart,
          paid_on: null,
          member_type_id: memberTypeId,
          card_issued_on: yesNo('card', 'Card done?') ? today : null,
        };
      }
    } else {
      warnings.push('No expiry date: imported without a membership.');
    }

    const person: PersonFields = {
      membership_number: membershipNumber,
      first_name: first,
      last_name: last,
      date_of_birth: null,
      gender_code: genderCode,
      address_line: get('address') || null,
      town_city: get('town') || null,
      postcode: get('postcode') || null,
      country: get('country') || null,
      email: get('email') || null,
      phone: get('phone') || null,
      in_skate_school: yesNo('skater', 'Skater'),
      member_since: date('since', 'Member since'),
      coc_agreed_on: date('coc', 'Agree to CofC'),
      waiver_agreed_on: date('waiver', 'Liability Waiver'),
      nzifsa_share_agreed_on: date('nzifsa', 'Share NZIFSA'),
    };

    result.rows.push({
      line,
      name: `${first} ${last}`.trim() || '(no name)',
      payload: {
        line,
        person,
        contacts,
        ethnicities: [...ethnicities],
        other_clubs: clubs,
        membership,
      },
      errors,
      warnings,
    });
  });

  result.missingMemberTypes = [...missingTypes.values()].sort();
  return result;
}
