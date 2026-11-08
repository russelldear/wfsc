import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAsync } from '../components/useAsync';
import { createMembership, fetchLookups, friendlyError, getPerson, savePerson } from '../lib/api';
import { currentSeasonStart, nextSeasonStart, nzToday, seasonLabel } from '../lib/dates';
import { MEMBERSHIP_NUMBER_PATTERN } from '../lib/membershipNumber';
import type { Contact, Lookups, MembershipKind, PersonDetail, PersonFields } from '../lib/types';

const EMPTY: PersonFields = {
  membership_number: null,
  first_name: '',
  last_name: '',
  date_of_birth: null,
  gender_code: null,
  address_line: null,
  town_city: null,
  postcode: null,
  country: 'New Zealand',
  email: null,
  phone: null,
  in_skate_school: false,
  member_since: null,
  coc_agreed_on: null,
  waiver_agreed_on: null,
  nzifsa_share_agreed_on: null,
};

export function PersonFormPage() {
  const { id } = useParams();
  const lookups = useAsync(fetchLookups, []);
  const person = useAsync(() => (id ? getPerson(id) : Promise.resolve(null)), [id]);

  if (lookups.error || person.error) {
    return <p className="error">{lookups.error ?? person.error}</p>;
  }
  if (!lookups.data || (id && !person.data)) return <p>Loading…</p>;

  // key forces a fresh form when switching between people.
  return <PersonForm key={id ?? 'new'} lookups={lookups.data} existing={person.data} />;
}

function fieldsFrom(p: PersonDetail): PersonFields {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof PersonFields)[]) {
    (f as Record<string, unknown>)[k] = p[k];
  }
  return f;
}

function PersonForm({ lookups, existing }: { lookups: Lookups; existing: PersonDetail | null }) {
  const navigate = useNavigate();
  const today = nzToday();
  const [fields, setFields] = useState<PersonFields>(existing ? fieldsFrom(existing) : EMPTY);
  const [contacts, setContacts] = useState<Contact[]>(existing?.contact ?? []);
  const [ethnicities, setEthnicities] = useState<string[]>(
    existing?.person_ethnicity.map((e) => e.ethnicity_code) ?? [],
  );
  const [clubs, setClubs] = useState<string[]>(
    existing?.person_other_club.map((c) => c.club_name).sort() ?? [],
  );
  // Membership to create alongside a new person.
  const [startMembership, setStartMembership] = useState(!existing);
  const [kind, setKind] = useState<MembershipKind>('individual');
  const [season, setSeason] = useState(currentSeasonStart(today));
  const [typeId, setTypeId] = useState('');
  const [paidOn, setPaidOn] = useState(today);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof PersonFields>(key: K, value: PersonFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function text(key: keyof PersonFields, label: string, type = 'text', required = false) {
    return (
      <label>
        {label}
        {required && <span className="required"> (required)</span>}
        <input
          type={type}
          required={required}
          value={(fields[key] as string | number | null) ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            set(key, (v === '' && !required ? null : v) as never);
          }}
        />
      </label>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const personId = await savePerson({
        id: existing?.id,
        fields: {
          ...fields,
          first_name: fields.first_name.trim(),
          last_name: fields.last_name.trim(),
        },
        contacts: contacts
          .filter((c) => c.name.trim())
          .map((c) => ({ ...c, name: c.name.trim() })),
        ethnicities,
        otherClubs: clubs.map((c) => c.trim()).filter(Boolean),
      });
      if (!existing && startMembership) {
        try {
          await createMembership(kind, season, paidOn || null, [
            { person_id: personId, member_type_id: typeId ? Number(typeId) : null },
          ]);
        } catch (err) {
          // The person was saved; send them to the person page with the problem.
          alert(`Saved the person, but could not create the membership: ${friendlyError(err)}`);
        }
      }
      navigate(`/people/${personId}`);
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  const current = currentSeasonStart(today);

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="person-form">
      <div className="page-title">
        <h1>{existing ? `Edit ${existing.first_name} ${existing.last_name}` : 'Add member'}</h1>
      </div>

      <fieldset>
        <legend>Person</legend>
        <div className="grid">
          {text('first_name', 'First name', 'text', true)}
          {text('last_name', 'Last name', 'text', true)}
          {text('date_of_birth', 'Date of birth', 'date')}
          <label>
            Membership number
            <input
              value={fields.membership_number ?? ''}
              pattern={MEMBERSHIP_NUMBER_PATTERN}
              title="Two-digit year, a slash, and at least three digits, e.g. 22/006"
              placeholder="Assigned when they join, e.g. 26/107"
              onChange={(e) => set('membership_number', e.target.value.trim() || null)}
            />
          </label>
          <label>
            Gender
            <select
              value={fields.gender_code ?? ''}
              onChange={(e) => set('gender_code', e.target.value || null)}
            >
              <option value="">Not recorded</option>
              {lookups.genders.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          {text('member_since', 'Member since', 'date')}
        </div>
        <fieldset className="checkbox-group">
          <legend>Ethnicity (select all that apply)</legend>
          {lookups.ethnicities.map((e) => (
            <label key={e.code} className="checkbox">
              <input
                type="checkbox"
                checked={ethnicities.includes(e.code)}
                onChange={(ev) =>
                  setEthnicities((list) =>
                    ev.target.checked ? [...list, e.code] : list.filter((c) => c !== e.code),
                  )
                }
              />
              {e.label}
            </label>
          ))}
        </fieldset>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={fields.in_skate_school}
            onChange={(e) => set('in_skate_school', e.target.checked)}
          />
          Also in the skate school
        </label>
        <p className="hint">Gender and ethnicity are optional and are used for NZIFSA and Sport NZ reporting.</p>
      </fieldset>

      <fieldset>
        <legend>Contact details</legend>
        <div className="grid">
          {text('email', 'Email', 'email')}
          {text('phone', 'Phone', 'tel')}
          {text('address_line', 'Address')}
          {text('town_city', 'Town/City')}
          {text('postcode', 'Postcode')}
          {text('country', 'Country')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Parents, guardians and emergency contacts</legend>
        {contacts.length === 0 && <p className="muted">None yet.</p>}
        {contacts.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="contact-row">
            <div className="grid">
              <label>
                Name
                <input
                  value={c.name}
                  required
                  onChange={(e) =>
                    setContacts((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              </label>
              <label>
                Relationship
                <input
                  value={c.relationship ?? ''}
                  placeholder="e.g. Mother"
                  onChange={(e) =>
                    setContacts((list) =>
                      list.map((x, j) => (j === i ? { ...x, relationship: e.target.value || null } : x)),
                    )
                  }
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  value={c.phone ?? ''}
                  onChange={(e) =>
                    setContacts((list) =>
                      list.map((x, j) => (j === i ? { ...x, phone: e.target.value || null } : x)),
                    )
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={c.email ?? ''}
                  onChange={(e) =>
                    setContacts((list) =>
                      list.map((x, j) => (j === i ? { ...x, email: e.target.value || null } : x)),
                    )
                  }
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={c.is_guardian}
                onChange={(e) =>
                  setContacts((list) =>
                    list.map((x, j) => (j === i ? { ...x, is_guardian: e.target.checked } : x)),
                  )
                }
              />
              Parent or legal guardian
            </label>{' '}
            <button
              type="button"
              className="link-button danger"
              onClick={() => setContacts((list) => list.filter((_, j) => j !== i))}
            >
              Remove contact
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setContacts((list) => [
              ...list,
              { name: '', relationship: null, phone: null, email: null, is_guardian: false },
            ])
          }
        >
          Add contact
        </button>
      </fieldset>

      <fieldset>
        <legend>Agreements (date agreed)</legend>
        <div className="grid">
          {text('coc_agreed_on', 'Code of Conduct', 'date')}
          {text('waiver_agreed_on', 'Liability waiver', 'date')}
          {text('nzifsa_share_agreed_on', 'Share details with NZIFSA', 'date')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Other clubs</legend>
        {clubs.map((club, i) => (
          <div key={i} className="inline-form">
            <input
              aria-label={`Other club ${i + 1}`}
              value={club}
              onChange={(e) => setClubs((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="link-button danger"
              onClick={() => setClubs((list) => list.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setClubs((list) => [...list, ''])}>
          Add club
        </button>
      </fieldset>

      {!existing && (
        <fieldset>
          <legend>Membership</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={startMembership}
              onChange={(e) => setStartMembership(e.target.checked)}
            />
            Start a membership now
          </label>
          <p className="hint">
            Untick this when adding someone who will join an existing family membership. Add them
            from the family member's page instead.
          </p>
          {startMembership && (
            <div className="grid">
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
              <label>
                Member type
                <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  <option value="">Not set</option>
                  {lookups.memberTypes
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Paid on
                <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
            </div>
          )}
        </fieldset>
      )}

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <Link to={existing ? `/people/${existing.id}` : '/'}>Cancel</Link>
      </div>
    </form>
  );
}
