import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAsync } from '../components/useAsync';
import {
  deleteClass,
  enrol,
  fetchBadgeCatalog,
  friendlyError,
  getClass,
  getProgressForPeople,
  listClasses,
  listEnrolments,
  listMembers,
  moveEnrolment,
  saveClass,
  tickSkill,
  unenrol,
  untickSkill,
} from '../lib/api';
import { badgeStatuses, badgesInFocus, orderedBadges, type BadgeStatus } from '../lib/badges';
import { ageRangeLabel, outsideAgeRange, timeRange } from '../lib/classes';
import { ageOn, nzToday } from '../lib/dates';
import type { BadgeCatalog, ClassDetail, ClassSkater, SkaterProgress } from '../lib/types';
import { ClassForm } from './ClassForm';

export function ClassPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const klass = useAsync(() => getClass(id), [id]);
  const catalog = useAsync(fetchBadgeCatalog, []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      klass.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (klass.error || catalog.error) return <p className="error">{klass.error ?? catalog.error}</p>;
  if (!klass.data || !catalog.data) return <p>Loading…</p>;
  const c = klass.data;
  const cat = catalog.data;
  const covered = orderedBadges(cat).filter((b) => c.badge_ids.includes(b.id));

  return (
    <>
      <p className="muted">
        <Link to="/skate-school">Skate school</Link> › {c.term.name}
      </p>
      <div className="page-title">
        <h1>{c.name}</h1>
        <div className="actions">
          <button type="button" onClick={() => setEditing((s) => !s)}>
            Edit class
          </button>
        </div>
      </div>
      <p>
        {[timeRange(c.starts_at, c.ends_at), ageRangeLabel(c.min_age, c.max_age), c.coach_name && `Coach: ${c.coach_name}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="muted">Badges: {covered.map((b) => b.name).join(', ') || 'none set'}</p>
      {error && <p className="error">{error}</p>}

      {editing && (
        <>
          <ClassForm
            catalog={cat}
            initial={c}
            submitLabel="Save class"
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={(fields, badgeIds) =>
              void run(() => saveClass({ id: c.id, term_id: c.term_id, fields, badge_ids: badgeIds }), () => setEditing(false))
            }
          />
          <button
            type="button"
            className="link-button danger"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete ${c.name}? Its ${c.skaters.length} skaters will be un-enrolled from it.`)) {
                void run(() => deleteClass(c.id), () => navigate('/skate-school'));
              }
            }}
          >
            Delete class
          </button>
        </>
      )}

      <Roster klass={c} busy={busy} run={run} />
      <Progress klass={c} catalog={cat} />
    </>
  );
}

function Roster(props: { klass: ClassDetail; busy: boolean; run: (a: () => Promise<unknown>) => Promise<void> }) {
  const { klass: c, busy, run } = props;
  const others = useAsync(async () => {
    const [classes, enrolments, people] = await Promise.all([
      listClasses(c.term_id),
      listEnrolments(c.term_id),
      listMembers(),
    ]);
    const enrolledThisTerm = new Set(enrolments.map((e) => e.person_id));
    return {
      classes: classes.filter((x) => x.id !== c.id),
      available: people.filter((p) => !enrolledThisTerm.has(p.id)),
    };
  }, [c.id, c.skaters.length]);
  const [personId, setPersonId] = useState('');
  const chosen = others.data?.available.find((p) => p.id === personId);
  const ageWarning = chosen && outsideAgeRange(chosen.date_of_birth, c.term.starts_on, c.min_age, c.max_age);

  return (
    <section className="panel">
      <h2>
        Skaters <span className="muted">({c.skaters.length})</span>
      </h2>
      {c.skaters.length === 0 && <p className="muted">No skaters enrolled yet.</p>}
      {c.skaters.length > 0 && (
        <ul className="roster">
          {c.skaters.map((s) => (
            <li key={s.id}>
              <Link to={`/people/${s.id}`}>
                {s.first_name} {s.last_name}
              </Link>
              {s.date_of_birth && <span className="muted"> · age {ageOn(s.date_of_birth, nzToday())}</span>}
              {outsideAgeRange(s.date_of_birth, c.term.starts_on, c.min_age, c.max_age) && (
                <span className="badge lapsed">Outside age range</span>
              )}
              <span className="roster-actions">
                {others.data && others.data.classes.length > 0 && (
                  <select
                    aria-label={`Move ${s.first_name} to another class`}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value) void run(() => moveEnrolment(s.id, c.term_id, e.target.value));
                    }}
                  >
                    <option value="">Move to…</option>
                    {others.data.classes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="link-button danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${s.first_name} from ${c.name}? Their badge progress is kept.`)) {
                      void run(() => unenrol(s.id, c.term_id));
                    }
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (personId) void run(() => enrol(c.id, personId)).then(() => setPersonId(''));
        }}
      >
        <label>
          Enrol a skater
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">{others.data ? 'Choose…' : 'Loading…'}</option>
            {others.data?.available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.last_name}, {p.first_name}
                {p.membership_number ? ` #${p.membership_number}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy || !personId}>
          Enrol
        </button>
        <span className="hint">
          Only people not already in a class this term are listed. New skater?{' '}
          <Link to="/people/new">Add them as a person</Link> first (untick "Start a membership" if they're not a member).
        </span>
      </form>
      {ageWarning && (
        <p className="warning">
          {chosen.first_name} is {ageOn(chosen.date_of_birth!, c.term.starts_on)} at the start of term, outside this
          class's {ageRangeLabel(c.min_age, c.max_age)}. You can still enrol them.
        </p>
      )}
    </section>
  );
}

function Progress({ klass: c, catalog }: { klass: ClassDetail; catalog: BadgeCatalog }) {
  const ids = c.skaters.map((s) => s.id);
  const progress = useAsync(() => getProgressForPeople(ids), [ids.join(',')]);
  const [tickDate, setTickDate] = useState(nzToday());
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(personId: string, skillId: number, checked: boolean) {
    const key = `${personId}:${skillId}`;
    setOptimistic((o) => ({ ...o, [key]: checked }));
    setError(null);
    try {
      if (checked) await tickSkill(personId, skillId, tickDate);
      else await untickSkill(personId, skillId);
      progress.reload();
    } catch (e) {
      setOptimistic((o) => {
        const next = { ...o };
        delete next[key];
        return next;
      });
      setError(friendlyError(e));
    }
  }

  if (c.skaters.length === 0) return null;
  if (progress.error) return <p className="error">{progress.error}</p>;
  if (!progress.data) return <section className="panel"><h2>Progress</h2><p>Loading…</p></section>;

  const covered = orderedBadges(catalog).filter((b) => c.badge_ids.includes(b.id));
  const statusesFor = (personId: string) => badgeStatuses(catalog, progress.data!.get(personId)!);

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Progress</h2>
        <label className="inline-label">
          Session date for new ticks{' '}
          <input type="date" value={tickDate} max={nzToday()} onChange={(e) => setTickDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {covered.length === 0 ? (
        <FocusList skaters={c.skaters} catalog={catalog} progress={progress.data} />
      ) : (
        <Grid
          skaters={c.skaters}
          covered={covered.map((b) => b.id)}
          catalog={catalog}
          statusesFor={statusesFor}
          progress={progress.data}
          optimistic={optimistic}
          onToggle={(p, s, v) => void toggle(p, s, v)}
        />
      )}
    </section>
  );
}

function Grid(props: {
  skaters: ClassSkater[];
  covered: number[];
  catalog: BadgeCatalog;
  statusesFor: (personId: string) => Map<number, BadgeStatus>;
  progress: Map<string, SkaterProgress>;
  optimistic: Record<string, boolean>;
  onToggle: (personId: string, skillId: number, checked: boolean) => void;
}) {
  const statusesByPerson = new Map(props.skaters.map((s) => [s.id, props.statusesFor(s.id)]));
  const first = statusesByPerson.values().next().value!;
  const badgeColumns = props.covered.map((id) => first.get(id)!);

  return (
    <>
      <p className="hint">
        Tick skills seen in the session; they save straight away. Green ✓ cells are badges the skater has already
        passed. Hover over a number to see the skill, or read the key below.
      </p>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th rowSpan={2}>Skater</th>
              {badgeColumns.map((b) => (
                <th key={b.badge.id} colSpan={b.assessment.length} className="badge-group">
                  {b.badge.name}
                </th>
              ))}
              <th rowSpan={2}>Ready to test</th>
            </tr>
            <tr>
              {badgeColumns.flatMap((b) =>
                b.assessment.map((s, i) => (
                  <th key={s.id} title={s.description} className={`skill-col ${i === 0 ? 'group-start' : ''}`}>
                    {i + 1}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {props.skaters.map((skater) => {
              const statuses = statusesByPerson.get(skater.id)!;
              const ticked = new Set(props.progress.get(skater.id)!.achievements.map((a) => a.skill_id));
              const readyNames = props.covered
                .map((id) => statuses.get(id)!)
                .filter((s) => s.readyToTest)
                .map((s) => s.badge.name);
              return (
                <tr key={skater.id}>
                  <th scope="row" className="skater-name">
                    <Link to={`/people/${skater.id}`}>
                      {skater.first_name} {skater.last_name}
                    </Link>
                  </th>
                  {props.covered.flatMap((badgeId) => {
                    const st = statuses.get(badgeId)!;
                    return st.assessment.map((skill, i) => {
                      const key = `${skater.id}:${skill.id}`;
                      const checked = props.optimistic[key] ?? ticked.has(skill.id);
                      return (
                        <td key={skill.id} className={`cell ${st.pass ? 'passed' : ''} ${i === 0 ? 'group-start' : ''}`}>
                          {st.pass ? (
                            <span title={`${st.badge.name} passed`}>✓</span>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`${skater.first_name} ${skater.last_name}: ${st.badge.name} skill ${i + 1}, ${skill.description}`}
                              checked={checked}
                              onChange={(e) => props.onToggle(skater.id, skill.id, e.target.checked)}
                            />
                          )}
                        </td>
                      );
                    });
                  })}
                  <td>{readyNames.map((n) => <span key={n} className="badge ok">{n}</span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="columns skill-key">
        {badgeColumns.map((b) => (
          <div key={b.badge.id}>
            <h4>{b.badge.name}</h4>
            <ol className="skills">
              {b.assessment.map((s) => (
                <li key={s.id}>{s.description}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="hint">To record a pass, open the skater's page.</p>
    </>
  );
}

/** For classes without set badges (e.g. Invitational): each skater's own current badges. */
function FocusList(props: { skaters: ClassSkater[]; catalog: BadgeCatalog; progress: Map<string, SkaterProgress> }) {
  const today = nzToday();
  return (
    <>
      <p className="hint">
        This class has no badges set, so each skater's current badges are listed. Open a skater to tick skills, or edit
        the class to choose its badges.
      </p>
      <ul className="roster">
        {props.skaters.map((s) => {
          const statuses = badgeStatuses(props.catalog, props.progress.get(s.id)!);
          const focus = badgesInFocus(props.catalog, statuses, s.date_of_birth, today);
          return (
            <li key={s.id}>
              <Link to={`/people/${s.id}`}>
                {s.first_name} {s.last_name}
              </Link>
              :{' '}
              {focus.length === 0
                ? 'nothing in progress'
                : focus.map((b) => {
                    const st = statuses.get(b.id)!;
                    return (
                      <span key={b.id} className={`badge ${st.readyToTest ? 'ok' : ''}`}>
                        {b.name} {st.ticked}/{st.assessment.length}
                      </span>
                    );
                  })}
            </li>
          );
        })}
      </ul>
    </>
  );
}
