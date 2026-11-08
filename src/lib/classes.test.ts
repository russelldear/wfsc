import { describe, expect, it } from 'vitest';
import { ageOutside, ageRangeLabel, formatTime, outsideAgeRange, timeRange } from './classes';

describe('formatTime', () => {
  it('shows 12-hour times', () => {
    expect(formatTime('07:30:00')).toBe('7:30 am');
    expect(formatTime('12:05')).toBe('12:05 pm');
    expect(formatTime('00:15')).toBe('12:15 am');
    expect(formatTime('18:00')).toBe('6:00 pm');
    expect(formatTime(null)).toBe('');
  });
  it('shows ranges', () => {
    expect(timeRange('07:30:00', '08:15:00')).toBe('7:30 am – 8:15 am');
    expect(timeRange(null, null)).toBe('');
  });
});

describe('ages', () => {
  it('labels the club’s age guidance', () => {
    expect(ageRangeLabel(4, 6)).toBe('age 4 to 6');
    expect(ageRangeLabel(16, null)).toBe('age 16+');
    expect(ageRangeLabel(null, null)).toBe('');
  });
  it('flags skaters outside the range at the start of term', () => {
    expect(outsideAgeRange('2019-11-01', '2026-10-12', 4, 6)).toBe(false); // 6
    expect(outsideAgeRange('2019-10-01', '2026-10-12', 4, 6)).toBe(true); // 7
    expect(outsideAgeRange('2011-01-01', '2026-10-12', 16, null)).toBe(true); // 15
    expect(outsideAgeRange(null, '2026-10-12', 4, 6)).toBe(false);
    expect(outsideAgeRange('2000-01-01', '2026-10-12', null, null)).toBe(false);
  });
});

describe('ageOutside', () => {
  it('compares a known age with the guidance', () => {
    expect(ageOutside(7, 4, 6)).toBe(true);
    expect(ageOutside(6, 4, 6)).toBe(false);
    expect(ageOutside(15, 16, null)).toBe(true);
    expect(ageOutside(null, 4, 6)).toBe(false);
  });
});
