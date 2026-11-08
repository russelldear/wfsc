import { ageOn } from './dates';
import type { Badge, BadgeCatalog, BadgePass, BadgeSkill, SkaterProgress } from './types';

export interface BadgeStatus {
  badge: Badge;
  assessment: BadgeSkill[];
  teaching: BadgeSkill[];
  /** Assessment skills ticked. */
  ticked: number;
  pass: BadgePass | undefined;
  prerequisite: Badge | undefined;
  prerequisitePass: BadgePass | undefined;
  /** No prerequisite, or the prerequisite is passed. */
  prerequisiteMet: boolean;
  /** Every assessment skill ticked, prerequisite passed, badge not yet passed. */
  readyToTest: boolean;
}

export function badgeStatuses(catalog: BadgeCatalog, progress: SkaterProgress): Map<number, BadgeStatus> {
  const ticked = new Set(progress.achievements.map((a) => a.skill_id));
  const passByBadge = new Map(progress.passes.map((p) => [p.badge_id, p]));
  const badgeById = new Map(catalog.badges.map((b) => [b.id, b]));
  const bySort = (a: BadgeSkill, b: BadgeSkill) => a.sort_order - b.sort_order;

  const result = new Map<number, BadgeStatus>();
  for (const badge of catalog.badges) {
    const skills = catalog.skills.filter((s) => s.badge_id === badge.id);
    const assessment = skills.filter((s) => s.kind === 'assessment').sort(bySort);
    const teaching = skills.filter((s) => s.kind === 'teaching').sort(bySort);
    const prerequisite = badge.prerequisite_id != null ? badgeById.get(badge.prerequisite_id) : undefined;
    const prerequisitePass = prerequisite ? passByBadge.get(prerequisite.id) : undefined;
    const prerequisiteMet = !prerequisite || !!prerequisitePass;
    const tickedCount = assessment.filter((s) => ticked.has(s.id)).length;
    const pass = passByBadge.get(badge.id);
    result.set(badge.id, {
      badge,
      assessment,
      teaching,
      ticked: tickedCount,
      pass,
      prerequisite,
      prerequisitePass,
      prerequisiteMet,
      readyToTest: !pass && prerequisiteMet && assessment.length > 0 && tickedCount === assessment.length,
    });
  }
  return result;
}

/** True when the skater is known to be too old for the badge on that date. */
export function overAgeLimit(badge: Badge, dateOfBirth: string | null, onDate: string): boolean {
  return badge.max_age != null && dateOfBirth != null && ageOn(dateOfBirth, onDate) > badge.max_age;
}

/**
 * The badges worth showing by default: any badge with ticks that is not yet
 * passed, plus the next badge in the General stream the skater can work on.
 * Tiny Tots are skipped for skaters known to be too old for them.
 */
export function badgesInFocus(
  catalog: BadgeCatalog,
  statuses: Map<number, BadgeStatus>,
  dateOfBirth: string | null,
  today: string,
): Badge[] {
  const ordered = orderedBadges(catalog);
  const inProgress = ordered.filter((b) => {
    const s = statuses.get(b.id)!;
    return !s.pass && s.ticked > 0;
  });

  const general = catalog.streams.find((s) => s.code === 'general');
  const nextGeneral = ordered.find((b) => {
    const s = statuses.get(b.id)!;
    return (
      b.stream_id === general?.id && !s.pass && s.prerequisiteMet && !overAgeLimit(b, dateOfBirth, today) &&
      // Once past Tiny Tots, don't suggest them.
      !(b.max_age != null && hasPassedLaterInStream(catalog, statuses, b))
    );
  });

  const result = [...inProgress];
  if (nextGeneral && !result.includes(nextGeneral)) result.unshift(nextGeneral);
  return orderedBadges(catalog).filter((b) => result.includes(b));
}

function hasPassedLaterInStream(catalog: BadgeCatalog, statuses: Map<number, BadgeStatus>, badge: Badge) {
  return catalog.badges.some(
    (b) => b.stream_id === badge.stream_id && b.sort_order > badge.sort_order && !!statuses.get(b.id)?.pass,
  );
}

/** Badges in stream order, then badge order. */
export function orderedBadges(catalog: BadgeCatalog): Badge[] {
  const streamOrder = new Map(catalog.streams.map((s) => [s.id, s.sort_order]));
  return [...catalog.badges].sort(
    (a, b) => (streamOrder.get(a.stream_id) ?? 0) - (streamOrder.get(b.stream_id) ?? 0) || a.sort_order - b.sort_order,
  );
}
