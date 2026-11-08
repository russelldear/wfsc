import { ageOn } from './dates';

/** "07:30:00" or "07:30" → "7:30 am". */
export function formatTime(t: string | null): string {
  if (!t) return '';
  const [h = 0, m = 0] = t.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function timeRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (!end) return formatTime(start);
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function ageRangeLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `age ${min} to ${max}`;
  if (min != null) return `age ${min}+`;
  if (max != null) return `age ${max} and under`;
  return '';
}

/**
 * Whether a skater falls outside a class's age guidance, judged at the start
 * of the term. Unknown when there is no date of birth.
 */
export function outsideAgeRange(
  dateOfBirth: string | null,
  onDate: string,
  min: number | null,
  max: number | null,
): boolean {
  if (!dateOfBirth || (min == null && max == null)) return false;
  const age = ageOn(dateOfBirth, onDate);
  return (min != null && age < min) || (max != null && age > max);
}
