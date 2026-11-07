import { useState } from 'react';
import { Link } from 'react-router';
import {
  createMembership,
  deleteMembership,
  friendlyError,
  joinFamilyMembership,
  listMembers,
  removeFromMembership,
  renewMembership,
  updateMembership,
  updateMembershipMember,
} from '../lib/api';
import {
  currentSeasonStart,
  formatDate,
  nextSeasonStart,
  nzToday,
  seasonLabel,
} from '../lib/dates';
import type { Lookups, MemberSummary, Membership, MembershipKind, PersonDetail } from '../lib/types';

interface Props {
  person: PersonDetail;
  lookups: Lookups;
  onChange: () => void;
}

export function MembershipsPanel({ person, lookups, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const today = nzToday();
  const memberships = [...person.membership_member]
    .map((l) => l.membership)
    .sort((a, b) => b.season_start.localeCompare(a.season_start));
  const latest = memberships[0];
  const renewSeason = latest
    ? [nextSeasonStart(latest.season_start), currentSeasonStart(today)].sort().at(-1)!
    : null;

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

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Memberships</h2>
        <div className="actions">
          {latest && renewSeason && (
            <RenewButton
              season={renewSeason}
              disabled={busy}
              onRenew={(paidOn) => run(() => renewMembership(latest.id, paidOn))}
            />
          )}
          <button type="button" onClick={() => setShowNew((s) => !s)} disabled={busy}>
            New membership
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {showNew && (
        <NewMembershipForm
          lookups={lookups}
          today={today}
          onCancel={() => setShowNew(false)}
          onCreate={(kind, season, typeId, paidOn) =>
            run(async () => {
              await createMembership(kind, season, paidOn, [
                { person_id: person.id, member_type_id: typeId },
              ]);
              setShowNew(false);
            })
          }
        />
      )}

      {memberships.length === 0 && !showNew && (
        <p className="muted">No memberships yet.</p>
      )}

      {memberships.map((m) => (
        <MembershipCard
          key={m.id}
          membership={m}
          personId={person.id}
          lookups={lookups}
          today={today}
          busy={busy}
          run={run}
        />
      ))}
    </section>
  );
}

function RenewButton(props: {
  season: string;
  disabled: boolean;
  onRenew: (paidOn: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(nzToday());
  if (!open) {
    return (
      <button type="button" className="primary" disabled={props.disabled} onClick={() => setOpen(true)}>
        Renew for {seasonLabel(props.season)}
      </button>
    );
  }
  return (
    <span className="inline-form">
      <label>
        Paid on <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <button
        type="button"
        className="primary"
        disabled={props.disabled || !paidOn}
        onClick={() => {
          props.onRenew(paidOn);
          setOpen(false);
        }}
      >
        Confirm renewal
      </button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

function NewMembershipForm(props: {
  lookups: Lookups;
  today: string;
  onCancel: () => void;
  onCreate: (kind: MembershipKind, season: string, typeId: number | null, paidOn: string | null) => void;
}) {
  const current = currentSeasonStart(props.today);
  const [kind, setKind] = useState<MembershipKind>('individual');
  const [season, setSeason] = useState(current);
  const [typeId, setTypeId] = useState<string>('');
  const [paidOn, setPaidOn] = useState(props.today);

  return (
    <form
      className="subform"
      onSubmit={(e) => {
        e.preventDefault();
        props.onCreate(kind, season, typeId ? Number(typeId) : null, paidOn || null);
      }}
    >
      <label>
        Season
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          {[current, nextSeasonStart(current)].map((s) => (
            <option key={s} value={s}>
              {seasonLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Membership
        <select value={kind} onChange={(e) => setKind(e.target.value as MembershipKind)}>
          <option value="individual">Individual</option>
          <option value="family">Family</option>
        </select>
      </label>
      <MemberTypeSelect lookups={props.lookups} value={typeId} onChange={setTypeId} />
      <label>
        Paid on
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      {kind === 'family' && (
        <p className="hint">Add the other family members after creating the membership.</p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary">Create membership</button>
        <button type="button" className="link-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MemberTypeSelect(props: {
  lookups: Lookups;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const options = props.lookups.memberTypes.filter(
    (t) => t.active || String(t.id) === props.value,
  );
  return (
    <label>
      {props.label ?? 'Member type'}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
    </label>
  );
}

function MembershipCard(props: {
  membership: Membership;
  personId: string;
  lookups: Lookups;
  today: string;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { membership: m, lookups, today, busy, run } = props;
  const current = m.expires_on >= today && m.season_start <= today;
  const future = m.season_start > today;
  const members = [...m.membership_member].sort((a, b) =>
    a.person.last_name.localeCompare(b.person.last_name) ||
    a.person.first_name.localeCompare(b.person.first_name),
  );

  return (
    <article className={`membership ${current ? 'current' : ''}`}>
      <header>
        <strong>{seasonLabel(m.season_start)}</strong>{' '}
        {m.kind === 'family' ? 'Family' : 'Individual'} membership
        {current && <span className="badge ok">Current</span>}
        {future && <span className="badge">Upcoming</span>}
        <span className="muted"> · Expires {formatDate(m.expires_on)}</span>
      </header>

      <div className="membership-meta">
        <label>
          Paid on{' '}
          <input
            type="date"
            defaultValue={m.paid_on ?? ''}
            disabled={busy}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== m.paid_on) void run(() => updateMembership(m.id, { paid_on: v }));
            }}
          />
        </label>
      </div>

      <table className="members">
        <thead>
          <tr>
            <th>Person</th>
            <th>Member type</th>
            <th>Card issued</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((mm) => (
            <tr key={mm.person_id}>
              <td>
                {mm.person_id === props.personId ? (
                  <strong>
                    {mm.person.first_name} {mm.person.last_name}
                  </strong>
                ) : (
                  <Link to={`/people/${mm.person_id}`}>
                    {mm.person.first_name} {mm.person.last_name}
                  </Link>
                )}
                {mm.person.membership_number != null && (
                  <span className="muted"> #{mm.person.membership_number}</span>
                )}
              </td>
              <td>
                <MemberTypeSelect
                  label=""
                  lookups={lookups}
                  value={mm.member_type_id != null ? String(mm.member_type_id) : ''}
                  onChange={(v) =>
                    void run(() =>
                      updateMembershipMember(m.id, mm.person_id, {
                        member_type_id: v ? Number(v) : null,
                      }),
                    )
                  }
                />
              </td>
              <td>
                {mm.card_issued_on ? (
                  <>
                    {formatDate(mm.card_issued_on)}{' '}
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          updateMembershipMember(m.id, mm.person_id, { card_issued_on: null }),
                        )
                      }
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        updateMembershipMember(m.id, mm.person_id, { card_issued_on: today }),
                      )
                    }
                  >
                    Mark issued
                  </button>
                )}
              </td>
              <td>
                {m.kind === 'family' && members.length > 1 && (
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${mm.person.first_name} from this family membership?`)) {
                        void run(() => removeFromMembership(m.id, mm.person_id));
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="membership-actions">
        {m.kind === 'family' && (
          <AddFamilyMember
            lookups={lookups}
            excludeIds={members.map((mm) => mm.person_id)}
            disabled={busy}
            onAdd={(personId, typeId) => run(() => joinFamilyMembership(m.id, personId, typeId))}
          />
        )}
        <button
          type="button"
          className="link-button danger"
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                `Delete the ${seasonLabel(m.season_start)} membership for everyone on it? ` +
                  'Use this only to correct a mistake.',
              )
            ) {
              void run(() => deleteMembership(m.id));
            }
          }}
        >
          Delete membership
        </button>
      </div>
    </article>
  );
}

function AddFamilyMember(props: {
  lookups: Lookups;
  excludeIds: string[];
  disabled: boolean;
  onAdd: (personId: string, typeId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<MemberSummary[] | null>(null);
  const [personId, setPersonId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => {
          setOpen(true);
          listMembers()
            .then(setPeople)
            .catch((e: unknown) => setLoadError(friendlyError(e)));
        }}
      >
        Add family member
      </button>
    );
  }

  const choices = (people ?? []).filter((p) => !props.excludeIds.includes(p.id));
  return (
    <span className="inline-form">
      {loadError && <span className="error">{loadError}</span>}
      <label>
        Person
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">{people ? 'Choose…' : 'Loading…'}</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.last_name}, {p.first_name}
              {p.membership_number != null ? ` #${p.membership_number}` : ''}
            </option>
          ))}
        </select>
      </label>
      <MemberTypeSelect lookups={props.lookups} value={typeId} onChange={setTypeId} />
      <button
        type="button"
        className="primary"
        disabled={props.disabled || !personId}
        onClick={() => {
          props.onAdd(personId, typeId ? Number(typeId) : null);
          setOpen(false);
          setPersonId('');
        }}
      >
        Add
      </button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <span className="hint">
        If they already have their own membership this season (for example, after an import),
        it is replaced by this one. Not listed? <Link to="/people/new">Add them as a person</Link>{' '}
        first.
      </span>
    </span>
  );
}
