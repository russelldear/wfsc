import { useState } from 'react';
import { Link } from 'react-router';
import { useAsync } from '../components/useAsync';
import {
  deleteBadgePass,
  enrol,
  friendlyError,
  getCurrentTermId,
  getSkaterProgress,
  listClasses,
  listTerms,
  moveEnrolment,
  unenrol,
  recordBadgePass,
  tickSkill,
  untickSkill,
  updateSkillAchievement,
} from '../lib/api';
import { badgeStatuses, badgesInFocus, orderedBadges, overAgeLimit, type BadgeStatus } from '../lib/badges';
import { formatDate, nzToday } from '../lib/dates';
import type { AssessorType, BadgeCatalog, PersonDetail, SkillAchievement } from '../lib/types';

interface Props {
  person: PersonDetail;
  catalog: BadgeCatalog;
  onPersonChange: () => void;
}

export function SkateSchoolPanel({ person, catalog, onPersonChange }: Props) {
  const progress = useAsync(() => getSkaterProgress(person.id), [person.id]);
  const [tickDate, setTickDate] = useState(nzToday());
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ticks show immediately and save in the background, so several can be
  // entered quickly. A failed save is undone and reported.
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});

  async function toggleSkill(skillId: number, checked: boolean) {
    setOptimistic((o) => ({ ...o, [skillId]: checked }));
    setError(null);
    try {
      if (checked) await tickSkill(person.id, skillId, tickDate);
      else await untickSkill(person.id, skillId);
      progress.reload();
    } catch (e) {
      setOptimistic((o) => {
        const next = { ...o };
        delete next[skillId];
        return next;
      });
      setError(friendlyError(e));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      progress.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (progress.error) return <section className="panel"><h2>Skate school</h2><p className="error">{progress.error}</p></section>;
  if (!progress.data) return <section className="panel"><h2>Skate school</h2><p>Loading…</p></section>;

  const today = nzToday();
  const statuses = badgeStatuses(catalog, progress.data);
  const achievements = new Map(progress.data.achievements.map((a) => [a.skill_id, a]));
  const streamName = new Map(catalog.streams.map((s) => [s.id, s.name]));
  const passed = orderedBadges(catalog).filter((b) => statuses.get(b.id)!.pass);
  const shown = showAll
    ? orderedBadges(catalog).filter((b) => !statuses.get(b.id)!.pass)
    : badgesInFocus(catalog, statuses, person.date_of_birth, today);

  return (
    <section className="panel skate-school">
      <div className="panel-title">
        <h2>Skate school</h2>
        <div className="actions">
          <label className="inline-label">
            Date for new ticks{' '}
            <input type="date" value={tickDate} max={today} onChange={(e) => setTickDate(e.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all badges
          </label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <ClassThisTerm person={person} onChange={onPersonChange} />

      <h3>Badges passed</h3>
      {passed.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="passes">
          {passed.map((b) => {
            const p = statuses.get(b.id)!.pass!;
            return (
              <li key={b.id}>
                <strong>{b.name}</strong> <span className="muted">({streamName.get(b.stream_id)})</span> ·{' '}
                {formatDate(p.passed_on)} · {p.assessor_name} ({p.assessor_type === 'judge' ? 'NZIFSA Judge' : 'Level 1 Coach'})
                {p.note && <span className="muted"> · {p.note}</span>}{' '}
                <button
                  type="button"
                  className="link-button danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove the ${b.name} pass? Use this only to correct a mistake.`)) {
                      void run(() => deleteBadgePass(p.id));
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>{showAll ? 'All badges not yet passed' : 'Working on'}</h3>
      {shown.length === 0 && (
        <p className="muted">Nothing in progress. Tick "Show all badges" to start on another badge.</p>
      )}
      {shown.map((b) => (
        <BadgeCard
          key={b.id}
          status={statuses.get(b.id)!}
          streamName={streamName.get(b.stream_id) ?? ''}
          achievements={achievements}
          optimistic={optimistic}
          onToggle={(skillId, checked) => void toggleSkill(skillId, checked)}
          person={person}
          busy={busy}
          run={run}
        />
      ))}
    </section>
  );
}

function BadgeCard(props: {
  status: BadgeStatus;
  streamName: string;
  achievements: Map<number, SkillAchievement>;
  optimistic: Record<number, boolean>;
  onToggle: (skillId: number, checked: boolean) => void;
  person: PersonDetail;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { status: s, achievements, optimistic, person, busy, run } = props;
  const isTicked = (skillId: number) => optimistic[skillId] ?? achievements.has(skillId);
  const tickedNow = s.assessment.filter((sk) => isTicked(sk.id)).length;
  const [recording, setRecording] = useState(false);

  return (
    <article className={`badge-card ${s.readyToTest ? 'ready' : ''}`}>
      <header>
        <strong>{s.badge.name}</strong> <span className="muted">{props.streamName}</span>{' '}
        <span className="badge">
          {tickedNow} of {s.assessment.length}
        </span>
        {s.readyToTest && <span className="badge ok">Ready to test</span>}
        {!s.prerequisiteMet && s.prerequisite && (
          <span className="muted"> · needs {s.prerequisite.name} passed first</span>
        )}
      </header>
      {s.badge.description && <p className="hint">{s.badge.description}</p>}

      <ol className="skills">
        {s.assessment.map((skill) => {
          const a = achievements.get(skill.id);
          return (
            <li key={skill.id}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={isTicked(skill.id)}
                  onChange={(e) => props.onToggle(skill.id, e.target.checked)}
                />
                {skill.description}
              </label>
              {a && (
                <span className="tick-meta">
                  <input
                    type="date"
                    aria-label={`Date achieved: ${skill.description}`}
                    defaultValue={a.achieved_on}
                    disabled={busy}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== a.achieved_on) {
                        void run(() => updateSkillAchievement(person.id, skill.id, { achieved_on: e.target.value }));
                      }
                    }}
                  />
                  <input
                    aria-label={`Note: ${skill.description}`}
                    placeholder="Note (optional)"
                    defaultValue={a.note ?? ''}
                    disabled={busy}
                    onBlur={(e) => {
                      const note = e.target.value.trim() || null;
                      if (note !== a.note) void run(() => updateSkillAchievement(person.id, skill.id, { note }));
                    }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {s.teaching.length > 0 && (
        <details>
          <summary>Teaching progression ideas (taught, not tested)</summary>
          <ol className="teaching">
            {s.teaching.map((t) => (
              <li key={t.id}>{t.description}</li>
            ))}
          </ol>
        </details>
      )}

      {recording ? (
        <RecordPassForm
          status={s}
          person={person}
          busy={busy}
          onCancel={() => setRecording(false)}
          onSave={(input) =>
            void run(async () => {
              await recordBadgePass({ ...input, person_id: person.id, badge_id: s.badge.id });
              setRecording(false);
            })
          }
        />
      ) : (
        <div className="badge-actions">
          <button
            type="button"
            className={s.readyToTest ? 'primary' : ''}
            disabled={busy || !s.prerequisiteMet}
            title={s.prerequisiteMet ? undefined : `${s.prerequisite?.name} must be passed first`}
            onClick={() => setRecording(true)}
          >
            Record pass
          </button>
        </div>
      )}
    </article>
  );
}

function RecordPassForm(props: {
  status: BadgeStatus;
  person: PersonDetail;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { passed_on: string; assessor_name: string; assessor_type: AssessorType; note: string | null }) => void;
}) {
  const { status: s } = props;
  const [passedOn, setPassedOn] = useState(nzToday());
  const [assessor, setAssessor] = useState('');
  const [type, setType] = useState<AssessorType>('coach');
  const [note, setNote] = useState('');
  const untickedCount = s.assessment.length - s.ticked;
  const tooOld = overAgeLimit(s.badge, props.person.date_of_birth, passedOn);
  const earliest = s.prerequisitePass?.passed_on;

  return (
    <form
      className="subform"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({ passed_on: passedOn, assessor_name: assessor.trim(), assessor_type: type, note: note.trim() || null });
      }}
    >
      <label>
        Passed on
        <input type="date" required value={passedOn} min={earliest} max={nzToday()} onChange={(e) => setPassedOn(e.target.value)} />
      </label>
      <label>
        Assessor
        <input required value={assessor} onChange={(e) => setAssessor(e.target.value)} />
      </label>
      <label>
        Assessor is a
        <select value={type} onChange={(e) => setType(e.target.value as AssessorType)}>
          <option value="coach">Level 1 Accredited Professional Coach</option>
          <option value="judge">NZIFSA Judge</option>
        </select>
      </label>
      <label className="grow">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {untickedCount > 0 && (
        <p className="warning">
          {untickedCount} assessment {untickedCount === 1 ? 'skill is' : 'skills are'} not ticked. You can still record the
          pass.
        </p>
      )}
      {tooOld && (
        <p className="warning">
          {s.badge.name} is for skaters aged {s.badge.max_age} and under, and this skater was older on that date.
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={props.busy}>
          Save pass
        </button>
        <button type="button" className="link-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ClassThisTerm({ person, onChange }: { person: PersonDetail; onChange: () => void }) {
  const term = useAsync(async () => {
    const [currentId, terms] = await Promise.all([getCurrentTermId(), listTerms()]);
    // The current term, or the newest one if none has started yet.
    const t = terms.find((x) => x.id === currentId) ?? terms[0] ?? null;
    return t ? { term: t, classes: await listClasses(t.id) } : null;
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const history = [...person.enrolment].sort((a, b) =>
    b.skate_class.term.starts_on.localeCompare(a.skate_class.term.starts_on),
  );

  if (term.error) return <p className="error">{term.error}</p>;
  if (!term.data) {
    return term.loading ? null : (
      <p className="muted">
        No terms set up yet. <Link to="/skate-school">Add one on the Skate school page.</Link>
      </p>
    );
  }
  const { term: t, classes } = term.data;
  const current = person.enrolment.find((e) => e.term_id === t.id);

  return (
    <>
      <h3>Class</h3>
      {error && <p className="error">{error}</p>}
      <div className="inline-form">
        <label>
          {t.name}
          <select
            value={current?.class_id ?? ''}
            disabled={busy}
            onChange={(e) => {
              const to = e.target.value;
              void run(() =>
                !to ? unenrol(person.id, t.id) : current ? moveEnrolment(person.id, t.id, to) : enrol(to, person.id),
              );
            }}
          >
            <option value="">Not enrolled</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {current && <Link to={`/skate-school/classes/${current.class_id}`}>Open class</Link>}
      </div>
      {history.filter((e) => e.term_id !== t.id).length > 0 && (
        <p className="muted">
          Earlier:{' '}
          {history
            .filter((e) => e.term_id !== t.id)
            .map((e) => `${e.skate_class.term.name}: ${e.skate_class.name}`)
            .join('; ')}
        </p>
      )}
    </>
  );
}
