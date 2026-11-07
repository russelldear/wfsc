import { useState } from 'react';
import { useAsync } from '../components/useAsync';
import { addMemberType, fetchLookups, friendlyError, updateMemberType } from '../lib/api';
import type { MemberType } from '../lib/types';

export function MemberTypesPage() {
  const { data, error, reload } = useAsync(fetchLookups, []);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

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
        <h1>Member types</h1>
      </div>
      <p className="hint">
        Types can be renamed or made inactive, but not deleted, because past memberships refer to
        them. Inactive types are hidden when creating new memberships.
      </p>
      {error && <p className="error">{error}</p>}
      {actionError && <p className="error">{actionError}</p>}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(async () => {
            await addMemberType(name.trim());
            setName('');
          });
        }}
      >
        <label>
          New type <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="primary">Add</button>
      </form>

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.memberTypes.map((t) => (
                <MemberTypeRow key={t.id} type={t} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MemberTypeRow({ type, run }: { type: MemberType; run: (a: () => Promise<unknown>) => void }) {
  const [name, setName] = useState(type.name);
  return (
    <tr>
      <td>
        <input
          aria-label={`Name for ${type.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== type.name) {
              run(() => updateMemberType(type.id, { name: name.trim() }));
            }
          }}
        />
      </td>
      <td>{type.active ? 'Active' : 'Inactive'}</td>
      <td>
        <button type="button" onClick={() => run(() => updateMemberType(type.id, { active: !type.active }))}>
          {type.active ? 'Make inactive' : 'Make active'}
        </button>
      </td>
    </tr>
  );
}
