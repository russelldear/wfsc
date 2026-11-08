import { useState } from 'react';
import { Link } from 'react-router';
import {
  addMemberType,
  existingMembershipNumbers,
  fetchLookups,
  friendlyError,
  importMembers,
} from '../lib/api';
import { parseCsv } from '../lib/csvParse';
import { nzToday, seasonLabel } from '../lib/dates';
import { interpretSheet, type Interpretation } from '../lib/importMembers';

type Filter = 'problems' | 'warnings' | 'all';

export function ImportPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [result, setResult] = useState<Interpretation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('problems');

  async function interpret(rows: string[][]) {
    setBusy(true);
    setError(null);
    try {
      const [lookups, numbers] = await Promise.all([fetchLookups(), existingMembershipNumbers()]);
      setResult(interpretSheet(rows, lookups, numbers, nzToday()));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setImported(null);
    setResult(null);
    setFileName(file.name);
    const rows = parseCsv(await file.text());
    setTable(rows);
    await interpret(rows);
  }

  async function createMissingTypes() {
    if (!result || !table) return;
    setBusy(true);
    setError(null);
    try {
      for (const name of result.missingMemberTypes) await addMemberType(name);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
      return;
    }
    await interpret(table);
  }

  async function runImport() {
    if (!result) return;
    const ready = result.rows.filter((r) => r.errors.length === 0);
    setBusy(true);
    setError(null);
    try {
      const count = await importMembers(ready.map((r) => r.payload));
      setImported(count);
      setResult(null);
      setTable(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = result?.rows.filter((r) => r.errors.length === 0) ?? [];
  const withErrors = result?.rows.filter((r) => r.errors.length > 0) ?? [];
  const withWarnings = result?.rows.filter((r) => r.warnings.length > 0) ?? [];
  const families = ready.filter((r) => r.payload.membership?.kind === 'family').length;
  const shown =
    result?.rows.filter((r) =>
      filter === 'all' ? true : filter === 'warnings' ? r.warnings.length > 0 : r.errors.length > 0,
    ) ?? [];
  const canImport =
    !!result && result.fileErrors.length === 0 && result.missingMemberTypes.length === 0 && ready.length > 0;

  return (
    <>
      <div className="page-title">
        <h1>Import members</h1>
      </div>

      <section className="panel">
        <h2>1. Choose the file</h2>
        <p>
          In Google Sheets: <strong>File → Download → Comma-separated values (.csv)</strong>. The
          file is read in this browser and sent straight to the database; it is not uploaded
          anywhere else. Columns are matched by their header names.
        </p>
        <p className="hint">
          Delete the downloaded file once the import is done: it contains members' personal details.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = '';
          }}
        />
        {fileName && <p className="muted">{fileName}</p>}
      </section>

      {error && <p className="error">{error}</p>}

      {imported !== null && (
        <section className="panel">
          <h2>Done</h2>
          <p>
            Imported {imported} {imported === 1 ? 'person' : 'people'}.{' '}
            <Link to="/">View members</Link>.
          </p>
          <p>Next steps:</p>
          <ul>
            <li>
              Link family members: open one person in each family, then use{' '}
              <strong>Add family member</strong> on their family membership. Each person's own
              membership for that season is replaced by the shared one.
            </li>
            <li>
              Tidy up contacts: the Sheet's guardian and emergency contact text was copied into each
              contact's name.
            </li>
            <li>Add dates of birth: the Sheet's ages could not be turned into dates.</li>
          </ul>
        </section>
      )}

      {busy && <p>Working…</p>}

      {result && (
        <>
          {result.fileErrors.length > 0 && (
            <div className="error">
              {result.fileErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {result.missingMemberTypes.length > 0 && (
            <section className="panel">
              <h2>2. Member types to create</h2>
              <p>
                The file uses member types the database does not have yet:{' '}
                <strong>{result.missingMemberTypes.join(', ')}</strong>.
              </p>
              <button type="button" className="primary" disabled={busy} onClick={() => void createMissingTypes()}>
                Create these member types
              </button>
            </section>
          )}

          {result.fileErrors.length === 0 && (
            <section className="panel">
              <h2>{result.missingMemberTypes.length > 0 ? '3' : '2'}. Check and import</h2>
              <ul>
                <li>
                  <strong>{ready.length}</strong> {ready.length === 1 ? 'row is' : 'rows are'} ready to
                  import ({families} with family memberships, which you link afterwards).
                </li>
                <li>
                  <strong>{withErrors.length}</strong> {withErrors.length === 1 ? 'row has' : 'rows have'}{' '}
                  problems and will be skipped. Fix them in the Sheet and import again, or add them
                  by hand.
                </li>
                <li>
                  <strong>{withWarnings.length}</strong> {withWarnings.length === 1 ? 'row has' : 'rows have'}{' '}
                  warnings: they will be imported, with the noted values left blank.
                </li>
                {result.ignoredColumns.length > 0 && (
                  <li>Columns not imported: {result.ignoredColumns.join(', ')}.</li>
                )}
                <li>
                  "Card done?" = Y is recorded as a card issued today, since the Sheet has no date.
                  Ages are not imported. The Skater column is not imported: enrol skaters in a class
                  on the Skate school page instead.
                </li>
              </ul>

              <div className="toolbar">
                <label>
                  Show{' '}
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option value="problems">Rows with problems ({withErrors.length})</option>
                    <option value="warnings">Rows with warnings ({withWarnings.length})</option>
                    <option value="all">All rows ({result.rows.length})</option>
                  </select>
                </label>
              </div>

              {shown.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>#</th>
                        <th>Name</th>
                        <th>Membership</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          <td>{r.payload.person.membership_number ?? ''}</td>
                          <td>{r.name}</td>
                          <td>
                            {r.payload.membership
                              ? `${seasonLabel(r.payload.membership.season_start)} ${r.payload.membership.kind}`
                              : 'None'}
                          </td>
                          <td>
                            {r.errors.map((e) => (
                              <div key={e} className="danger">
                                {e}
                              </div>
                            ))}
                            {r.warnings.map((w) => (
                              <div key={w} className="muted">
                                {w}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="form-actions" style={{ marginTop: '1rem' }}>
                <button type="button" className="primary" disabled={!canImport || busy} onClick={() => void runImport()}>
                  Import {ready.length} {ready.length === 1 ? 'person' : 'people'}
                </button>
                <span className="hint">All or nothing: if anything fails, nothing is saved.</span>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
