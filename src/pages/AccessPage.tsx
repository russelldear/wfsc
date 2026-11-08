import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useAsync } from '../components/useAsync';
import {
  cancelInvite,
  friendlyError,
  grantRole,
  inviteUser,
  listAppUsers,
  listInvites,
  revokeRole,
} from '../lib/api';
import { formatDate } from '../lib/dates';
import type { AppRole } from '../lib/types';

const ROLES: { role: AppRole; label: string; description: string }[] = [
  { role: 'committee', label: 'Committee', description: 'Everything: members, memberships, skate school, import and export.' },
  {
    role: 'coach',
    label: 'Coach',
    description:
      'View only: skate school classes, skater names and ages, badges and progress. No contact details, dates of birth, ethnicity or membership information.',
  },
  { role: 'admin', label: 'Admin', description: 'Manages who has access (this page). Add Committee too if they should see members.' },
];

const roleLabel = (r: AppRole) => ROLES.find((x) => x.role === r)?.label ?? r;

export function AccessPage() {
  const { session } = useAuth();
  const users = useAsync(listAppUsers, []);
  const invites = useAsync(listInvites, []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('committee');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      users.reload();
      invites.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>Access</h1>
      </div>

      <section className="panel">
        <h2>Roles</h2>
        <dl>
          {ROLES.map((r) => (
            <div key={r.role} className="role-row">
              <dt>{r.label}</dt>
              <dd>{r.description}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          People sign in with Google. Signing in alone gives no access. Every change here is recorded in the audit log.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="panel">
        <h2>Invite someone</h2>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const address = email.trim();
            void run(async () => {
              const result = await inviteUser(address, role);
              setMessage(
                result === 'granted'
                  ? `${address} has already signed in, so they are now ${roleLabel(role)}.`
                  : `Invitation saved. ${address} becomes ${roleLabel(role)} the first time they sign in with that Google account.`,
              );
              setEmail('');
            });
          }}
        >
          <label className="grow">
            Google email address
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              {ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Invite
          </button>
        </form>

        {invites.data && invites.data.length > 0 && (
          <>
            <h3>Waiting for first sign-in</h3>
            <ul className="roster">
              {invites.data.map((i) => (
                <li key={`${i.email}:${i.role}`}>
                  {i.email} <span className="badge">{roleLabel(i.role)}</span>
                  <span className="muted">invited {formatDate(i.invited_at.slice(0, 10))}</span>
                  <span className="roster-actions">
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busy}
                      onClick={() => void run(() => cancelInvite(i.email, i.role))}
                    >
                      Cancel
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2>People who have signed in</h2>
        {users.error && <p className="error">{users.error}</p>}
        {users.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Last signed in</th>
                  {ROLES.map((r) => (
                    <th key={r.role}>{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const isMe = u.user_id === session?.user.id;
                  return (
                    <tr key={u.user_id}>
                      <td>
                        {u.email}
                        {isMe && <span className="muted"> (you)</span>}
                        {u.roles.length === 0 && <span className="badge lapsed">No access</span>}
                      </td>
                      <td>{u.last_sign_in_at ? formatDate(u.last_sign_in_at.slice(0, 10)) : ''}</td>
                      {ROLES.map((r) => {
                        const has = u.roles.includes(r.role);
                        return (
                          <td key={r.role}>
                            <input
                              type="checkbox"
                              aria-label={`${r.label} for ${u.email}`}
                              checked={has}
                              disabled={busy}
                              onChange={() => {
                                if (has && isMe && r.role === 'admin' && !confirm('Remove your own admin access?')) return;
                                void run(() => (has ? revokeRole(u.user_id, r.role) : grantRole(u.user_id, r.role)));
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">There must always be at least one admin.</p>
      </section>
    </>
  );
}
