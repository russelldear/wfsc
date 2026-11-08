import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAsync } from '../components/useAsync';
import { fetchLookups, friendlyError, listMembers, listPeopleForExport } from '../lib/api';
import { downloadCsv, toCsv } from '../lib/csv';
import { formatDate, nzToday } from '../lib/dates';
import { SHEET_HEADERS, memberExportRows } from '../lib/exportMembers';
import type { MemberSummary } from '../lib/types';

type Filter = 'current' | 'lapsed' | 'none' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'current', label: 'Current members' },
  { value: 'lapsed', label: 'Lapsed members' },
  { value: 'none', label: 'Never a member' },
  { value: 'all', label: 'Everyone' },
];

function matchesFilter(m: MemberSummary, filter: Filter): boolean {
  switch (filter) {
    case 'current':
      return m.is_current;
    case 'lapsed':
      return m.membership_id !== null && !m.is_current;
    case 'none':
      return m.membership_id === null;
    case 'all':
      return true;
  }
}

function matchesSearch(m: MemberSummary, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    `${m.first_name} ${m.last_name}`.toLowerCase().includes(t) ||
    (m.email ?? '').toLowerCase().includes(t) ||
    (m.membership_number ?? '').includes(t)
  );
}

export function MemberListPage() {
  const { data, error, loading } = useAsync(listMembers, []);
  const [filter, setFilter] = useState<Filter>('current');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const rows = useMemo(
    () => (data ?? []).filter((m) => matchesFilter(m, filter) && matchesSearch(m, search.trim())),
    [data, filter, search],
  );

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const [people, lookups] = await Promise.all([listPeopleForExport(), fetchLookups()]);
      const today = nzToday();
      const csv = toCsv([[...SHEET_HEADERS], ...memberExportRows(people, lookups, today)]);
      downloadCsv(`wfsc-members-${today}.csv`, csv);
    } catch (e) {
      setExportError(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>Members</h1>
        <div className="actions">
          <button type="button" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <Link className="button primary" to="/people/new">
            Add member
          </Link>
        </div>
      </div>
      <p className="hint">
        The export includes everyone who has ever had a membership, in the same columns as the
        club spreadsheet. It contains personal information: store it carefully.
      </p>
      {exportError && <p className="error">{exportError}</p>}

      <div className="toolbar">
        <label>
          Show{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Search{' '}
          <input
            type="search"
            placeholder="Name, email or membership number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p className="count">
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Member type</th>
                  <th>Membership</th>
                  <th>Expires</th>
                  <th>Skate school</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.membership_number ?? ''}</td>
                    <td>
                      <Link to={`/people/${m.id}`}>
                        {m.last_name}, {m.first_name}
                      </Link>
                    </td>
                    <td>{m.member_type ?? ''}</td>
                    <td>{m.kind === 'family' ? 'Family' : m.kind === 'individual' ? 'Individual' : ''}</td>
                    <td>
                      {m.expires_on ? (
                        <span className={m.is_current ? 'badge ok' : 'badge lapsed'}>
                          {formatDate(m.expires_on)}
                        </span>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td>{m.in_skate_school ? 'Yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
