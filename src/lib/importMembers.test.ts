import { describe, expect, it } from 'vitest';
import { parseCsv } from './csvParse';
import { SHEET_HEADERS } from './exportMembers';
import { interpretSheet, parseNzDate } from './importMembers';
import type { Lookups } from './types';

const lookups: Lookups = {
  genders: [
    { code: 'female', label: 'Female', sort_order: 1 },
    { code: 'male', label: 'Male', sort_order: 2 },
    { code: 'not_stated', label: 'Prefer not to say', sort_order: 4 },
  ],
  ethnicities: [
    { code: 'european', label: 'European', sort_order: 1 },
    { code: 'maori', label: 'Māori', sort_order: 2 },
    { code: 'pacific', label: 'Pacific Peoples', sort_order: 3 },
  ],
  memberTypes: [{ id: 1, name: 'Skating', active: true }],
};

const TODAY = '2026-11-08';

/** Builds a sheet row from the club's headers, with the given values. */
function sheet(...rows: Partial<Record<(typeof SHEET_HEADERS)[number], string>>[]): string[][] {
  return [[...SHEET_HEADERS], ...rows.map((r) => SHEET_HEADERS.map((h) => r[h] ?? ''))];
}

describe('parseCsv', () => {
  it('handles quotes, embedded commas and line breaks, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps trailing empty cells', () => {
    expect(parseCsv('a,b,,\n')).toEqual([['a', 'b', '', '']]);
  });
});

describe('parseNzDate', () => {
  it('reads day/month/year', () => {
    expect(parseNzDate('30/09/2027')).toBe('2027-09-30');
    expect(parseNzDate('1/2/2020')).toBe('2020-02-01');
    expect(parseNzDate('2027-09-30')).toBe('2027-09-30');
  });
  it('rejects impossible or ambiguous values', () => {
    expect(parseNzDate('31/02/2027')).toBeNull();
    expect(parseNzDate('09/30/2027')).toBeNull();
    expect(parseNzDate('2019')).toBeNull();
    expect(parseNzDate('Y')).toBeNull();
  });
});

describe('interpretSheet', () => {
  it('maps a full row to a person and membership', () => {
    const result = interpretSheet(
      sheet({
        'Membership #': '22/042',
        'First Name': 'Aroha',
        'Last Name': 'Example',
        Age: '12',
        Gender: 'F',
        Skater: 'Y',
        Ethnicity: 'NZ European, Maori',
        Email: 'family@example.test',
        'Parent/Guardian if under 18': 'Pat Example 021 111',
        'Agree to CofC': '01/10/2022',
        'Member since': '01/10/2022',
        'Member type': 'skating',
        'card done?': 'Y',
        Expiry: '30/09/2027',
        Type: 'Family',
        'Membership of other club': 'Y',
        'Name of Club': 'Club A; Club B',
      }),
      lookups,
      new Set(),
      TODAY,
    );

    expect(result.fileErrors).toEqual([]);
    const [row] = result.rows;
    expect(row!.errors).toEqual([]);
    expect(row!.warnings).toEqual([]);
    expect(row!.payload).toMatchObject({
      line: 2,
      person: {
        membership_number: '22/042',
        gender_code: 'female',
        in_skate_school: true,
        coc_agreed_on: '2022-10-01',
        member_since: '2022-10-01',
        date_of_birth: null,
      },
      ethnicities: ['european', 'maori'],
      other_clubs: ['Club A', 'Club B'],
      contacts: [{ name: 'Pat Example 021 111', is_guardian: true }],
      membership: {
        kind: 'family',
        season_start: '2026-10-01',
        member_type_id: 1,
        card_issued_on: TODAY,
      },
    });
  });

  it('requires name columns', () => {
    const result = interpretSheet([['Email'], ['x@example.test']], lookups, new Set(), TODAY);
    expect(result.fileErrors).toHaveLength(2);
  });

  it('flags numbers already in the database or repeated in the file', () => {
    const result = interpretSheet(
      sheet(
        { 'Membership #': '22/005', 'First Name': 'A', 'Last Name': 'One' },
        { 'Membership #': '22/006', 'First Name': 'B', 'Last Name': 'Two' },
        { 'Membership #': '22/006', 'First Name': 'C', 'Last Name': 'Three' },
      ),
      lookups,
      new Set(['22/005']),
      TODAY,
    );
    expect(result.rows.map((r) => r.errors.length)).toEqual([1, 0, 1]);
    expect(result.rows[2]!.errors[0]).toContain('row 3');
  });

  it('rejects membership numbers not in the club format', () => {
    const result = interpretSheet(
      sheet(
        { 'Membership #': '22-006', 'First Name': 'A', 'Last Name': 'B' },
        { 'Membership #': '22/6', 'First Name': 'C', 'Last Name': 'D' },
        { 'Membership #': '6', 'First Name': 'E', 'Last Name': 'F' },
      ),
      lookups,
      new Set(),
      TODAY,
    );
    expect(result.rows.map((r) => r.errors[0])).toEqual([
      'Membership # "22-006" is not in the form 22/006.',
      'Membership # "22/6" is not in the form 22/006.',
      'Membership # "6" is not in the form 22/006.',
    ]);
  });

  it('lists member types that need creating', () => {
    const result = interpretSheet(
      sheet(
        { 'First Name': 'A', 'Last Name': 'B', Expiry: '30/09/2027', 'Member type': 'Life' },
        { 'First Name': 'C', 'Last Name': 'D', Expiry: '30/09/2027', 'Member type': 'life' },
      ),
      lookups,
      new Set(),
      TODAY,
    );
    expect(result.missingMemberTypes).toEqual(['Life']);
    expect(result.rows[0]!.payload.membership!.member_type_id).toBeNull();
  });

  it('warns rather than guesses on unclear values', () => {
    const result = interpretSheet(
      sheet({
        'First Name': 'A',
        'Last Name': 'B',
        Gender: 'Unknown',
        Ethnicity: 'Martian',
        'Agree to CofC': 'Y',
        Expiry: '31/12/2026',
        Type: '',
        Skater: 'maybe',
      }),
      lookups,
      new Set(),
      TODAY,
    );
    const [row] = result.rows;
    expect(row!.errors).toEqual([]);
    expect(row!.payload.person.gender_code).toBeNull();
    expect(row!.payload.person.coc_agreed_on).toBeNull();
    expect(row!.payload.membership!.season_start).toBe('2026-10-01');
    expect(row!.warnings.join('\n')).toMatch(/Gender.*Martian|Martian/s);
    expect(row!.warnings.some((w) => w.includes('not 30 September'))).toBe(true);
    expect(row!.warnings.some((w) => w.includes('Agree to CofC'))).toBe(true);
  });

  it('imports people without an expiry as non-members', () => {
    const result = interpretSheet(sheet({ 'First Name': 'A', 'Last Name': 'B' }), lookups, new Set(), TODAY);
    expect(result.rows[0]!.payload.membership).toBeNull();
  });

  it('rejects unreadable expiry dates', () => {
    const result = interpretSheet(
      sheet({ 'First Name': 'A', 'Last Name': 'B', Expiry: '2027' }),
      lookups,
      new Set(),
      TODAY,
    );
    expect(result.rows[0]!.errors[0]).toContain('Expiry');
  });

  it('matches headers regardless of case and spacing, and reports unknown ones', () => {
    const result = interpretSheet(
      [['  first   name ', 'LAST NAME', 'Shoe size'], ['A', 'B', '9']],
      lookups,
      new Set(),
      TODAY,
    );
    expect(result.fileErrors).toEqual([]);
    expect(result.rows[0]!.name).toBe('A B');
    expect(result.ignoredColumns).toEqual(['Shoe size']);
  });
});
