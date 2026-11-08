import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { SHEET_HEADERS, memberExportRows } from './exportMembers';
import type { Lookups, PersonDetail } from './types';

const lookups: Lookups = {
  genders: [{ code: 'female', label: 'Female', sort_order: 1 }],
  ethnicities: [
    { code: 'european', label: 'European', sort_order: 1 },
    { code: 'maori', label: 'Māori', sort_order: 2 },
  ],
  memberTypes: [{ id: 1, name: 'Skating', active: true }],
};

function person(overrides: Partial<PersonDetail> = {}): PersonDetail {
  return {
    id: 'p1',
    membership_number: '22/012',
    first_name: 'Aroha',
    last_name: 'Example',
    date_of_birth: '2014-05-01',
    gender_code: 'female',
    address_line: '1 Rink Road',
    town_city: 'Wellington',
    postcode: '6011',
    country: 'New Zealand',
    email: 'family@example.test',
    phone: '+64 21 000 0000',
    enrolment: [
      { term_id: 't-now', class_id: 'c1', skate_class: { id: 'c1', name: 'Beginner', term: { id: 't-now', name: 'Term', starts_on: '2026-10-12' } } },
    ],
    member_since: '2022-10-01',
    coc_agreed_on: '2022-10-01',
    waiver_agreed_on: '2022-10-02',
    nzifsa_share_agreed_on: null,
    created_at: '',
    updated_at: '',
    contact: [
      { id: 'c1', name: 'Pat Example', relationship: 'Mother', phone: '021 111', email: null, is_guardian: true },
      { id: 'c2', name: 'Sam Neighbour', relationship: null, phone: '021 222', email: null, is_guardian: false },
    ],
    person_ethnicity: [{ ethnicity_code: 'maori' }, { ethnicity_code: 'european' }],
    person_other_club: [
      { id: 'o2', club_name: 'Zed Club' },
      { id: 'o1', club_name: 'Alpha Club' },
    ],
    membership_member: [
      {
        member_type_id: 1,
        card_issued_on: null,
        membership: {
          id: 'm-old', kind: 'individual', season_start: '2025-10-01',
          expires_on: '2026-09-30', paid_on: null, membership_member: [],
        },
      },
      {
        member_type_id: 1,
        card_issued_on: '2026-10-10',
        membership: {
          id: 'm-new', kind: 'family', season_start: '2026-10-01',
          expires_on: '2027-09-30', paid_on: '2026-10-05', membership_member: [],
        },
      },
    ],
    ...overrides,
  };
}

describe('memberExportRows', () => {
  it('produces one value per sheet column', () => {
    const [row] = memberExportRows([person()], lookups, '2026-11-07', 't-now');
    expect(row).toHaveLength(SHEET_HEADERS.length);
  });

  it('maps a member to the sheet columns using their latest membership', () => {
    const [row] = memberExportRows([person()], lookups, '2026-11-07', 't-now');
    const byHeader = Object.fromEntries(SHEET_HEADERS.map((h, i) => [h, row![i]]));
    expect(byHeader).toMatchObject({
      'Membership #': '22/012',
      Age: '12',
      Gender: 'Female',
      Skater: 'Y',
      Ethnicity: 'European; Māori',
      'Parent/Guardian if under 18': 'Pat Example (Mother) 021 111',
      'Emergency Contact if over 18': 'Sam Neighbour 021 222',
      'share NZIFSA': '',
      'Member type': 'Skating',
      'card done?': 'Y',
      Expiry: '2027-09-30',
      Type: 'Family',
      'Membership of other club': 'Y',
      'Name of Club': 'Alpha Club; Zed Club',
    });
  });

  it('marks Skater only for enrolment in the current term', () => {
    const skaterColumn = SHEET_HEADERS.indexOf('Skater');
    expect(memberExportRows([person()], lookups, '2026-11-07', 'another-term')[0]![skaterColumn]).toBe('N');
    expect(memberExportRows([person()], lookups, '2026-11-07', null)[0]![skaterColumn]).toBe('N');
  });

  it('leaves out people who have never had a membership', () => {
    const rows = memberExportRows([person({ membership_member: [] })], lookups, '2026-11-07', 't-now');
    expect(rows).toHaveLength(0);
  });

  it('sorts by the membership number counter, unnumbered last', () => {
    const rows = memberExportRows(
      [
        person({ id: 'a', membership_number: null, last_name: 'Aaa' }),
        person({ id: 'b', membership_number: '23/106' }),
        person({ id: 'c', membership_number: '22/105' }),
        person({ id: 'd', membership_number: '20/1000' }),
      ],
      lookups,
      '2026-11-07',
      't-now',
    );
    // By the running counter, whatever the year prefix.
    expect(rows.map((r) => r[0])).toEqual(['22/105', '23/106', '20/1000', '']);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([['a,b', 'say "hi"', 'line\nbreak', 'plain']])).toBe(
      '"a,b","say ""hi""","line\nbreak",plain\r\n',
    );
  });

  it('stops spreadsheet formulas but keeps phone numbers', () => {
    expect(toCsv([['=HYPERLINK("x")', '@cmd', '+64 21 000']])).toBe(
      `"'=HYPERLINK(""x"")",'@cmd,+64 21 000\r\n`,
    );
  });
});
