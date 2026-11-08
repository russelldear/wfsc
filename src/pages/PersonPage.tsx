import { Link, useParams } from 'react-router';
import { useAsync } from '../components/useAsync';
import { fetchBadgeCatalog, fetchLookups, getPerson } from '../lib/api';
import { ageOn, formatDate, nzToday } from '../lib/dates';
import { MembershipsPanel } from './MembershipsPanel';
import { SkateSchoolPanel } from './SkateSchoolPanel';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children || <span className="muted">Not recorded</span>}</dd>
    </>
  );
}

export function PersonPage() {
  const { id = '' } = useParams();
  const person = useAsync(() => getPerson(id), [id]);
  const lookups = useAsync(fetchLookups, []);
  const catalog = useAsync(fetchBadgeCatalog, []);

  if (person.error) return <p className="error">{person.error}</p>;
  if (lookups.error) return <p className="error">{lookups.error}</p>;
  if (!person.data || !lookups.data) return <p>Loading…</p>;

  const p = person.data;
  const l = lookups.data;
  const today = nzToday();
  const age = p.date_of_birth ? ageOn(p.date_of_birth, today) : null;
  const guardians = p.contact.filter((c) => c.is_guardian);
  const gender = l.genders.find((g) => g.code === p.gender_code)?.label;
  const ethnicities = l.ethnicities
    .filter((e) => p.person_ethnicity.some((pe) => pe.ethnicity_code === e.code))
    .map((e) => e.label)
    .join(', ');
  const address = [p.address_line, p.town_city, p.postcode, p.country].filter(Boolean).join(', ');

  return (
    <>
      <div className="page-title">
        <h1>
          {p.first_name} {p.last_name}
          {p.membership_number != null && <span className="muted"> #{p.membership_number}</span>}
        </h1>
        <div className="actions">
          <Link className="button primary" to={`/people/${p.id}/edit`}>
            Edit details
          </Link>
        </div>
      </div>

      {age !== null && age < 18 && guardians.length === 0 && (
        <p className="warning">Under 18 with no parent or guardian recorded.</p>
      )}

      <div className="columns">
        <section className="panel">
          <h2>Details</h2>
          <dl>
            <Field label="Date of birth">
              {p.date_of_birth && `${formatDate(p.date_of_birth)} (age ${age})`}
            </Field>
            <Field label="Gender">{gender}</Field>
            <Field label="Ethnicity">{ethnicities}</Field>
            <Field label="Email">{p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}</Field>
            <Field label="Phone">{p.phone}</Field>
            <Field label="Address">{address}</Field>
            <Field label="In skate school">{p.in_skate_school ? 'Yes' : 'No'}</Field>
            <Field label="Member since">{formatDate(p.member_since)}</Field>
            <Field label="Other clubs">
              {p.person_other_club.map((c) => c.club_name).sort().join(', ')}
            </Field>
          </dl>
        </section>

        <section className="panel">
          <h2>Agreements</h2>
          <dl>
            <Field label="Code of Conduct">{formatDate(p.coc_agreed_on)}</Field>
            <Field label="Liability waiver">{formatDate(p.waiver_agreed_on)}</Field>
            <Field label="Share with NZIFSA">{formatDate(p.nzifsa_share_agreed_on)}</Field>
          </dl>

          <h2>Contacts</h2>
          {p.contact.length === 0 && <p className="muted">No contacts recorded.</p>}
          <ul className="contacts">
            {p.contact.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.relationship && ` (${c.relationship})`}
                {c.is_guardian && <span className="badge">Guardian</span>}
                <br />
                {[c.phone, c.email].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <MembershipsPanel person={p} lookups={l} onChange={person.reload} />

      {catalog.error && <p className="error">{catalog.error}</p>}
      {catalog.data && <SkateSchoolPanel person={p} catalog={catalog.data} />}
    </>
  );
}
