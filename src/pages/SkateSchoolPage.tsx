import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useAsync } from '../components/useAsync';
import {
  copyClasses,
  createTerm,
  deleteTerm,
  fetchBadgeCatalog,
  friendlyError,
  getCurrentTermId,
  getProgressForPeople,
  listClasses,
  listTerms,
  saveClass,
  termSkaters,
  updateTerm,
} from '../lib/api';
import { badgeStatuses, orderedBadges } from '../lib/badges';
import { ageRangeLabel, timeRange } from '../lib/classes';
import { formatDate } from '../lib/dates';
import type { BadgeCatalog, Term } from '../lib/types';
import { ClassForm } from './ClassForm';

export function SkateSchoolPage() {
  const terms = useAsync(async () => {
    const [list, currentId] = await Promise.all([listTerms(), getCurrentTermId()]);
    return { list, currentId };
  }, []);
  const catalog = useAsync(fetchBadgeCatalog, []);
  const [chosenTermId, setChosenTermId] = useState<string | null>(null);
  const [showNewTerm, setShowNewTerm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = useAuth().hasRole('committee');

  if (terms.error || catalog.error) return <p className="error">{terms.error ?? catalog.error}</p>;
  if (!terms.data || !catalog.data) return <p>Loading…</p>;

  const { list, currentId } = terms.data;
  // Default to the current term, or else the newest (e.g. a term not started yet).
  const termId = chosenTermId ?? currentId ?? list[0]?.id ?? null;
  const term = list.find((t) => t.id === termId) ?? null;

  return (
    <>
      <div className="page-title">
        <h1>Skate school</h1>
        <div className="actions">
          {list.length > 0 && (
            <label className="inline-label">
              Term{' '}
              <select value={termId ?? ''} onChange={(e) => setChosenTermId(e.target.value)}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.id === currentId ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canEdit && (
            <button type="button" onClick={() => setShowNewTerm((s) => !s)}>
              New term
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {showNewTerm && (
        <NewTermForm
          previous={list[0] ?? null}
          onCancel={() => setShowNewTerm(false)}
          onCreated={(id) => {
            setShowNewTerm(false);
            setChosenTermId(id);
            terms.reload();
          }}
          onError={setError}
        />
      )}

      {!term && !showNewTerm && (
        <p className="muted">{canEdit ? 'No terms yet. Add the current term to get started.' : 'No terms yet.'}</p>
      )}

      {term && (
        <TermView
          key={term.id}
          term={term}
          isCurrent={term.id === currentId}
          catalog={catalog.data}
          canEdit={canEdit}
          onTermChanged={terms.reload}
          onTermDeleted={() => {
            setChosenTermId(null);
            terms.reload();
          }}
        />
      )}
    </>
  );
}

function NewTermForm(props: {
  previous: Term | null;
  onCancel: () => void;
  onCreated: (id: string) => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [copy, setCopy] = useState(!!props.previous);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="subform"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        props.onError(null);
        void (async () => {
          try {
            const id = await createTerm({ name: name.trim(), starts_on: startsOn, ends_on: endsOn });
            if (copy && props.previous) await copyClasses(props.previous.id, id);
            props.onCreated(id);
          } catch (err) {
            props.onError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <label>
        Name
        <input required value={name} placeholder="e.g. 2027 Term 1" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Starts
        <input type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </label>
      <label>
        Ends
        <input type="date" required value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </label>
      {props.previous && (
        <label className="checkbox">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Copy the classes from {props.previous.name} (without skaters)
        </label>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          Create term
        </button>
        <button type="button" className="link-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TermView(props: {
  term: Term;
  isCurrent: boolean;
  catalog: BadgeCatalog;
  canEdit: boolean;
  onTermChanged: () => void;
  onTermDeleted: () => void;
}) {
  const { term, catalog, canEdit } = props;
  const classes = useAsync(() => listClasses(term.id), [term.id]);
  const ready = useAsync(() => readyToTest(term.id, catalog), [term.id]);
  const [showNewClass, setShowNewClass] = useState(false);
  const [editingTerm, setEditingTerm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badgeName = new Map(catalog.badges.map((b) => [b.id, b.name]));
  const badgeOrder = new Map(orderedBadges(catalog).map((b, i) => [b.id, i]));

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>
            {term.name} {props.isCurrent && <span className="badge ok">Current</span>}
          </h2>
          <div className="actions">
            <span className="muted">
              {formatDate(term.starts_on)} – {formatDate(term.ends_on)}
            </span>
            {canEdit && (
              <button type="button" className="link-button" onClick={() => setEditingTerm((s) => !s)}>
                Edit term
              </button>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}

        {editingTerm && (
          <form
            className="subform"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  updateTerm(term.id, {
                    name: String(f.get('name')).trim(),
                    starts_on: String(f.get('starts_on')),
                    ends_on: String(f.get('ends_on')),
                  }),
                () => {
                  setEditingTerm(false);
                  props.onTermChanged();
                },
              );
            }}
          >
            <label>
              Name <input name="name" required defaultValue={term.name} />
            </label>
            <label>
              Starts <input name="starts_on" type="date" required defaultValue={term.starts_on} />
            </label>
            <label>
              Ends <input name="ends_on" type="date" required defaultValue={term.ends_on} />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary" disabled={busy}>
                Save
              </button>
              <button
                type="button"
                className="link-button danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete ${term.name}? Only possible once it has no classes.`)) {
                    void run(() => deleteTerm(term.id), props.onTermDeleted);
                  }
                }}
              >
                Delete term
              </button>
            </div>
          </form>
        )}

        <div className="panel-title">
          <h3>Classes</h3>
          {canEdit && (
            <button type="button" onClick={() => setShowNewClass((s) => !s)}>
              New class
            </button>
          )}
        </div>

        {showNewClass && (
          <ClassForm
            catalog={catalog}
            submitLabel="Create class"
            busy={busy}
            onCancel={() => setShowNewClass(false)}
            onSubmit={(fields, badgeIds) =>
              void run(
                () => saveClass({ term_id: term.id, fields, badge_ids: badgeIds }),
                () => {
                  setShowNewClass(false);
                  classes.reload();
                },
              )
            }
          />
        )}

        {classes.error && <p className="error">{classes.error}</p>}
        {classes.data && classes.data.length === 0 && !showNewClass && (
          <p className="muted">No classes in this term yet.</p>
        )}
        {classes.data && classes.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Class</th>
                  <th>Badges</th>
                  <th>Skaters</th>
                </tr>
              </thead>
              <tbody>
                {classes.data.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{timeRange(c.starts_at, c.ends_at)}</td>
                    <td>
                      <Link to={`/skate-school/classes/${c.id}`}>{c.name}</Link>
                      {ageRangeLabel(c.min_age, c.max_age) && (
                        <span className="muted"> ({ageRangeLabel(c.min_age, c.max_age)})</span>
                      )}
                      {c.coach_name && <div className="muted">Coach: {c.coach_name}</div>}
                    </td>
                    <td>
                      {[...c.badge_ids]
                        .sort((a, b) => (badgeOrder.get(a) ?? 0) - (badgeOrder.get(b) ?? 0))
                        .map((id) => badgeName.get(id))
                        .join(', ') || <span className="muted">None set</span>}
                    </td>
                    <td>{c.enrolled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Ready to test</h2>
        <p className="hint">
          Skaters in this term who have every assessment skill ticked for a badge and have passed the badge before it.
        </p>
        {ready.error && <p className="error">{ready.error}</p>}
        {ready.data && ready.data.length === 0 && <p className="muted">Nobody yet.</p>}
        {ready.data && ready.data.length > 0 && (
          <ul className="ready-list">
            {ready.data.map((r) => (
              <li key={r.personId}>
                {canEdit ? <Link to={`/people/${r.personId}`}>{r.name}</Link> : r.name}
                {r.className && <span className="muted"> ({r.className})</span>}: {r.badges.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

async function readyToTest(termId: string, catalog: BadgeCatalog) {
  const [skaters, classes] = await Promise.all([termSkaters(termId), listClasses(termId)]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const progress = await getProgressForPeople(skaters.map((s) => s.id));
  const ordered = orderedBadges(catalog);
  return skaters
    .map((s) => {
      const statuses = badgeStatuses(catalog, progress.get(s.id)!);
      const badges = ordered.filter((b) => statuses.get(b.id)!.readyToTest).map((b) => b.name);
      return { personId: s.id, name: `${s.first_name} ${s.last_name}`, className: className.get(s.class_id), badges };
    })
    .filter((r) => r.badges.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
