import { describe, expect, it } from 'vitest';
import { badgeStatuses, badgesInFocus, overAgeLimit } from './badges';
import type { BadgeCatalog, BadgePass, SkaterProgress } from './types';

const catalog: BadgeCatalog = {
  streams: [
    { id: 1, code: 'general', name: 'General', rule_section: '702', note: null, sort_order: 1 },
    { id: 2, code: 'dance', name: 'Dance', rule_section: '706', note: null, sort_order: 2 },
  ],
  badges: [
    { id: 10, stream_id: 1, name: 'Tiny Tots 1', sort_order: 1, prerequisite_id: null, max_age: 6, description: null },
    { id: 11, stream_id: 1, name: 'Beginner', sort_order: 3, prerequisite_id: null, max_age: null, description: null },
    { id: 12, stream_id: 1, name: 'Elementary', sort_order: 4, prerequisite_id: 11, max_age: null, description: null },
    { id: 20, stream_id: 2, name: 'Dance 1', sort_order: 1, prerequisite_id: null, max_age: null, description: null },
  ],
  skills: [
    { id: 1, badge_id: 10, kind: 'assessment', sort_order: 1, description: 'Dip' },
    { id: 2, badge_id: 11, kind: 'assessment', sort_order: 2, description: 'B2' },
    { id: 3, badge_id: 11, kind: 'assessment', sort_order: 1, description: 'B1' },
    { id: 4, badge_id: 11, kind: 'teaching', sort_order: 1, description: 'Idea' },
    { id: 5, badge_id: 12, kind: 'assessment', sort_order: 1, description: 'E1' },
    { id: 6, badge_id: 20, kind: 'assessment', sort_order: 1, description: 'D1' },
  ],
};

const pass = (badge_id: number): BadgePass => ({
  id: `p${badge_id}`, person_id: 'x', badge_id, passed_on: '2027-01-01',
  assessor_name: 'A Coach', assessor_type: 'coach', note: null,
});
const tick = (skill_id: number) => ({ person_id: 'x', skill_id, achieved_on: '2027-01-01', note: null });
const progress = (ticks: number[], passes: number[]): SkaterProgress => ({
  achievements: ticks.map(tick),
  passes: passes.map(pass),
});

describe('badgeStatuses', () => {
  it('counts only assessment skills, in order', () => {
    const s = badgeStatuses(catalog, progress([3, 4], [])).get(11)!;
    expect(s.assessment.map((x) => x.description)).toEqual(['B1', 'B2']);
    expect(s.teaching).toHaveLength(1);
    expect(s.ticked).toBe(1);
    expect(s.readyToTest).toBe(false);
  });

  it('is ready to test when every assessment skill is ticked and the prerequisite is passed', () => {
    expect(badgeStatuses(catalog, progress([2, 3], [])).get(11)!.readyToTest).toBe(true);
    expect(badgeStatuses(catalog, progress([5], [])).get(12)!.readyToTest).toBe(false);
    expect(badgeStatuses(catalog, progress([5], [11])).get(12)!.readyToTest).toBe(true);
  });

  it('is not ready to test once passed', () => {
    expect(badgeStatuses(catalog, progress([2, 3], [11])).get(11)!.readyToTest).toBe(false);
  });
});

describe('overAgeLimit', () => {
  const tinyTots = catalog.badges[0]!;
  it('flags skaters older than the limit on the date', () => {
    expect(overAgeLimit(tinyTots, '2020-06-01', '2027-06-01')).toBe(true);
    expect(overAgeLimit(tinyTots, '2020-06-01', '2027-05-31')).toBe(false);
  });
  it('cannot tell without a date of birth', () => {
    expect(overAgeLimit(tinyTots, null, '2027-06-01')).toBe(false);
  });
});

describe('badgesInFocus', () => {
  const names = (age: number | null, p: SkaterProgress) =>
    badgesInFocus(catalog, badgeStatuses(catalog, p), age).map((b) => b.name);

  it('suggests Tiny Tots for young or unknown-age skaters', () => {
    expect(names(4, progress([], []))).toEqual(['Tiny Tots 1']);
    expect(names(null, progress([], []))).toEqual(['Tiny Tots 1']);
  });

  it('skips Tiny Tots for older skaters', () => {
    expect(names(12, progress([], []))).toEqual(['Beginner']);
  });

  it('moves on after a pass, and includes other badges with ticks', () => {
    expect(names(12, progress([6], [11]))).toEqual(['Elementary', 'Dance 1']);
  });

  it('stops suggesting Tiny Tots once a later General badge is passed', () => {
    expect(names(null, progress([], [11]))).toEqual(['Elementary']);
  });
});
