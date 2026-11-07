import { describe, expect, it } from 'vitest';
import {
  ageOn,
  currentSeasonStart,
  formatDate,
  nextSeasonStart,
  nzToday,
  seasonLabel,
} from './dates';

describe('nzToday', () => {
  it('uses New Zealand time, not UTC', () => {
    // 11:30 UTC on 30 Sep is already 1 Oct in NZ (UTC+13 in daylight time).
    expect(nzToday(new Date('2026-09-30T11:30:00Z'))).toBe('2026-10-01');
    expect(nzToday(new Date('2026-09-30T10:00:00Z'))).toBe('2026-09-30');
  });
});

describe('currentSeasonStart', () => {
  it('starts a new season on 1 October', () => {
    expect(currentSeasonStart('2026-10-01')).toBe('2026-10-01');
    expect(currentSeasonStart('2026-12-31')).toBe('2026-10-01');
  });
  it('belongs to the previous season before October', () => {
    expect(currentSeasonStart('2026-09-30')).toBe('2025-10-01');
    expect(currentSeasonStart('2027-01-01')).toBe('2026-10-01');
  });
});

describe('seasons', () => {
  it('labels seasons by their two calendar years', () => {
    expect(seasonLabel('2026-10-01')).toBe('2026/27');
    expect(seasonLabel('2099-10-01')).toBe('2099/00');
  });
  it('finds the next season', () => {
    expect(nextSeasonStart('2026-10-01')).toBe('2027-10-01');
  });
});

describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn('2008-11-07', '2026-11-07')).toBe(18);
    expect(ageOn('2008-11-08', '2026-11-07')).toBe(17);
    expect(ageOn('2008-12-01', '2026-11-07')).toBe(17);
  });
  it('handles 29 February birthdays', () => {
    expect(ageOn('2012-02-29', '2026-02-28')).toBe(13);
    expect(ageOn('2012-02-29', '2026-03-01')).toBe(14);
  });
});

describe('formatDate', () => {
  it('formats for New Zealand readers', () => {
    expect(formatDate('2026-11-07')).toBe('7 Nov 2026');
    expect(formatDate(null)).toBe('');
  });
});
