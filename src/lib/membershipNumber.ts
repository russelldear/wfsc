// Club membership numbers: two-digit year of joining, a slash, and a counter
// that runs on across years, e.g. 22/006. The database enforces the same rule.

/** For HTML `pattern` attributes (anchored automatically by the browser). */
export const MEMBERSHIP_NUMBER_PATTERN = '[0-9]{2}/[0-9]{3,}';

const RE = /^[0-9]{2}\/[0-9]{3,}$/;

export function isMembershipNumber(value: string): boolean {
  return RE.test(value);
}

/** Orders by the running counter (so, by when people joined); blanks last. */
export function compareMembershipNumbers(a: string | null, b: string | null): number {
  const counter = (n: string | null) =>
    n && RE.test(n) ? Number(n.split('/')[1]) : Number.MAX_SAFE_INTEGER;
  return counter(a) - counter(b);
}
