// Dates are handled as ISO strings (yyyy-mm-dd), matching Postgres `date`.
// "Today" is always New Zealand's today, wherever the browser is.

const NZ_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function nzToday(now: Date = new Date()): string {
  return NZ_DATE.format(now);
}

function parts(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The 1 October that starts the membership season containing `today`. */
export function currentSeasonStart(today: string): string {
  const [y, m] = parts(today);
  return `${m >= 10 ? y : y - 1}-10-01`;
}

export function nextSeasonStart(seasonStart: string): string {
  const [y] = parts(seasonStart);
  return `${y + 1}-10-01`;
}

/** "2026/27" for the season starting 1 October 2026. */
export function seasonLabel(seasonStart: string): string {
  const [y] = parts(seasonStart);
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Whole years between date of birth and `today`. */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = parts(dateOfBirth);
  const [ty, tm, td] = parts(today);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

const DISPLAY = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "7 Nov 2026". Empty string for null. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = parts(iso);
  return DISPLAY.format(new Date(Date.UTC(y, m - 1, d)));
}
