import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useAsync } from '../components/useAsync';
import {
  addBadgeSkill,
  deleteBadgeSkill,
  fetchBadgeCatalog,
  friendlyError,
  updateBadge,
  updateBadgeSkill,
} from '../lib/api';
import type { Badge, BadgeCatalog, BadgeSkill, BadgeSkillKind } from '../lib/types';

export function BadgesPage() {
  const { data, error, reload } = useAsync(fetchBadgeCatalog, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const canEdit = useAuth().hasRole('admin');

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>Kiwiskate badges</h1>
        {canEdit && (
          <label className="checkbox">
            <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
            Edit
          </label>
        )}
      </div>
      <p className="hint">
        From section 700 of the 2019 NZIFSA Rules and Regulations. Tests may be judged by a NZIFSA Judge or a Level 1
        Accredited Professional Coach (701.1). Only the "Skills for Assessment" are tested (701.2). Correct balance, posture and eye focus must be covered for every skill
        (701.3).
      </p>
      {error && <p className="error">{error}</p>}
      {actionError && <p className="error">{actionError}</p>}
      {data && <Catalog catalog={data} editing={editing} run={run} />}
    </>
  );
}

function Catalog(props: { catalog: BadgeCatalog; editing: boolean; run: (a: () => Promise<unknown>) => void }) {
  const { catalog } = props;
  return (
    <>
      <nav className="toc" aria-label="Streams">
        {catalog.streams.map((s) => (
          <a key={s.id} href={`#stream-${s.code}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`stream-${s.code}`)?.scrollIntoView();
          }}>
            {s.name}
          </a>
        ))}
      </nav>
      {catalog.streams.map((stream) => (
        <section key={stream.id} id={`stream-${stream.code}`} className="panel stream">
          <h2>
            {stream.name} <span className="muted">({stream.rule_section})</span>
          </h2>
          {catalog.badges
            .filter((b) => b.stream_id === stream.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((badge) => (
              <BadgeBlock key={badge.id} badge={badge} catalog={catalog} editing={props.editing} run={props.run} />
            ))}
        </section>
      ))}
    </>
  );
}

function BadgeBlock(props: {
  badge: Badge;
  catalog: BadgeCatalog;
  editing: boolean;
  run: (a: () => Promise<unknown>) => void;
}) {
  const { badge, catalog, editing, run } = props;
  const skills = catalog.skills.filter((s) => s.badge_id === badge.id);
  const prerequisite = catalog.badges.find((b) => b.id === badge.prerequisite_id);
  const sameStream = catalog.badges.filter((b) => b.stream_id === badge.stream_id && b.id !== badge.id);

  return (
    <article className="badge-block">
      <h3>
        {badge.name}
        {badge.max_age != null && <span className="muted"> ({badge.max_age} years of age and under)</span>}
      </h3>
      {editing ? (
        <div className="inline-form">
          <label>
            Must already have
            <select
              value={badge.prerequisite_id ?? ''}
              onChange={(e) => run(() => updateBadge(badge.id, { prerequisite_id: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">Nothing</option>
              {sameStream.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Age limit
            <input
              type="number"
              min={1}
              defaultValue={badge.max_age ?? ''}
              onBlur={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                if (v !== badge.max_age) run(() => updateBadge(badge.id, { max_age: v }));
              }}
            />
          </label>
          <label className="grow">
            Description
            <input
              defaultValue={badge.description ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== badge.description) run(() => updateBadge(badge.id, { description: v }));
              }}
            />
          </label>
        </div>
      ) : (
        <>
          <p className="muted">{prerequisite ? `Must already have ${prerequisite.name}.` : 'No earlier badge needed.'}</p>
          {badge.description && <p className="hint">{badge.description}</p>}
        </>
      )}
      <SkillList title="Skills for assessment" kind="assessment" badge={badge} skills={skills} editing={editing} run={run} />
    </article>
  );
}

function SkillList(props: {
  title: string;
  kind: BadgeSkillKind;
  badge: Badge;
  skills: BadgeSkill[];
  editing: boolean;
  run: (a: () => Promise<unknown>) => void;
}) {
  const { kind, badge, editing, run } = props;
  const [newSkill, setNewSkill] = useState('');
  const list = props.skills.filter((s) => s.kind === kind).sort((a, b) => a.sort_order - b.sort_order);
  if (!editing && list.length === 0) return <div />;

  return (
    <div>
      <h4>{props.title}</h4>
      {list.length === 0 && <p className="muted">None.</p>}
      <ol className="skills">
        {list.map((s) => (
          <li key={s.id}>
            {editing ? (
              <span className="inline-form">
                <input
                  className="grow"
                  aria-label={`Skill ${s.sort_order}`}
                  defaultValue={s.description}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.description) run(() => updateBadgeSkill(s.id, { description: v }));
                  }}
                />
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => {
                    if (confirm('Remove this skill? Skills already ticked for a skater cannot be removed.')) {
                      run(() => deleteBadgeSkill(s.id));
                    }
                  }}
                >
                  Remove
                </button>
              </span>
            ) : (
              s.description
            )}
          </li>
        ))}
      </ol>
      {editing && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = newSkill.trim();
            if (!v) return;
            const next = Math.max(0, ...list.map((s) => s.sort_order)) + 1;
            run(async () => {
              await addBadgeSkill(badge.id, kind, v, next);
              setNewSkill('');
            });
          }}
        >
          <input className="grow" placeholder="Add a skill" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
  );
}
