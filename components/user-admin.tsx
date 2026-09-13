'use client';

import { useEffect, useState } from 'react';
import { Card, Badge, Th, Td, EmptyState, humanStatus } from './ui';

const ROLE_HELP: Record<string, string> = {
  HR_MANAGER: 'Runs the whole ASR. Sees every division, controls budgets, decides exceptions.',
  HOD: 'Head of Department — sees only their own division and submits it to HR.',
  DIRECTOR: 'Sees only the departments assigned to them, not the whole division.',
  GSM_PRESIDENT: 'Reviews and approves the final ASR. Cannot edit any figures.',
  REWARDS: 'Sees nothing until the approved ASR is formally released to Rewards.',
  ADMIN: 'Full system access including user management.',
};

const ROLE_TONE: Record<string, any> = {
  HR_MANAGER: 'violet', ADMIN: 'violet', GSM_PRESIDENT: 'blue',
  REWARDS: 'blue', HOD: 'green', DIRECTOR: 'gray',
};

interface U {
  id: number; name: string; email: string; role: string; title: string | null;
  divisionId: number | null; divisionName: string | null; isActive: number;
  lastLoginAt: string | null; headsDivisions: string[]; directsDepartments: string[];
}

export function UserAdmin({ currentUserId }: { currentUserId: number }) {
  const [data, setData] = useState<any>(null);
  const [editing, setEditing] = useState<U | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    const r = await fetch('/api/admin/users');
    setData(await r.json());
  }
  useEffect(() => { load(); }, []);

  if (!data) return <Card><p className="text-[13px] text-ink-500">Loading…</p></Card>;
  if (data.error) return <Card><EmptyState title={data.error} /></Card>;

  const users: U[] = data.users.filter((u: U) => {
    if (!showInactive && !u.isActive) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || u.role.toLowerCase().includes(s);
  });

  const unassignedDivisions = data.divisions.filter((d: any) => !d.hodUserId);
  const unassignedDepartments = data.departments.filter((d: any) => !d.directorUserId);

  return (
    <div className="space-y-4">
      {msg && (
        <p className="text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{msg}</p>
      )}

      {(unassignedDivisions.length > 0 || unassignedDepartments.length > 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <p className="font-medium">Some parts of the organisation have nobody assigned</p>
          {unassignedDivisions.length > 0 && (
            <p className="mt-0.5">
              <span className="font-medium">No Head of Department:</span>{' '}
              {unassignedDivisions.map((d: any) => d.name).join(', ')} — these divisions will not be
              notified when an ASR is distributed.
            </p>
          )}
          {unassignedDepartments.length > 0 && (
            <p className="mt-0.5">
              <span className="font-medium">No Director:</span> {unassignedDepartments.length} department
              {unassignedDepartments.length > 1 ? 's' : ''} ({unassignedDepartments.slice(0, 4).map((d: any) => d.name).join(', ')}
              {unassignedDepartments.length > 4 ? '…' : ''}).
            </p>
          )}
        </div>
      )}

      <Card
        title={`People with access (${users.length})`}
        subtitle="Everyone who can sign in. Accounts are never deleted — deactivating removes access instantly but keeps their history."
        action={<button className="btn-primary btn-sm" onClick={() => setEditing('new')}>Add person</button>}
        bodyClass="p-0"
      >
        <div className="px-4 py-2.5 border-b border-ink-200 flex flex-wrap gap-2 items-center">
          <input className="input max-w-xs" placeholder="Search name, email or role…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[13px] text-ink-600 cursor-pointer">
            <input type="checkbox" className="accent-jazz-600" checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)} />
            Show deactivated
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <Th>Name</Th><Th>Email (used to sign in)</Th><Th>Role</Th>
              <Th>Responsible for</Th><Th>Last signed in</Th><Th /><Th />
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`row-hover ${!u.isActive ? 'opacity-50' : ''}`}>
                  <Td>
                    <span className="font-medium text-ink-900">{u.name}</span>
                    {u.id === currentUserId && <Badge tone="blue" className="ml-1.5">You</Badge>}
                    {u.title && <span className="block text-2xs text-ink-500">{u.title}</span>}
                  </Td>
                  <Td className="font-mono text-2xs text-ink-600">{u.email}</Td>
                  <Td><Badge tone={ROLE_TONE[u.role]}>{humanStatus(u.role)}</Badge></Td>
                  <Td className="text-2xs text-ink-600 max-w-xs whitespace-normal">
                    {u.headsDivisions.length > 0 && <span className="block">Heads: {u.headsDivisions.join(', ')}</span>}
                    {u.directsDepartments.length > 0 && <span className="block">Directs: {u.directsDepartments.join(', ')}</span>}
                    {u.headsDivisions.length === 0 && u.directsDepartments.length === 0 && (
                      ['HOD', 'DIRECTOR'].includes(u.role)
                        ? <span className="text-amber-700">Nothing assigned — will see no data</span>
                        : <span className="text-ink-400">Company-wide</span>
                    )}
                  </Td>
                  <Td className="text-2xs text-ink-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt.replace(' ', 'T') + 'Z').toLocaleString('en-GB') : 'Never'}
                  </Td>
                  <Td>{!u.isActive && <Badge tone="red">Deactivated</Badge>}</Td>
                  <Td align="right">
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(u)}>Edit</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && <EmptyState title="No accounts match that search" />}
      </Card>

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          data={data}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); setMsg(m); load(); }}
        />
      )}
    </div>
  );
}

function UserForm({ user, data, currentUserId, onClose, onSaved }: {
  user: U | null; data: any; currentUserId: number;
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const isNew = !user;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [role, setRole] = useState(user?.role ?? 'HOD');
  const [divisionId, setDivisionId] = useState(String(user?.divisionId ?? ''));
  const [isActive, setIsActive] = useState(user ? !!user.isActive : true);
  const [password, setPassword] = useState('');
  const [deptIds, setDeptIds] = useState<number[]>(
    user ? data.departments.filter((d: any) => d.directorUserId === user.id).map((d: any) => d.id) : [],
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const deptChoices = divisionId
    ? data.departments.filter((d: any) => String(d.divisionId) === divisionId)
    : data.departments;

  async function save() {
    setBusy(true); setErr('');
    const body: any = {
      name, email, title, role,
      divisionId: divisionId ? Number(divisionId) : null,
      isActive,
    };
    if (role === 'DIRECTOR') body.departmentIds = deptIds;
    if (password) body.password = password;

    const res = await fetch(isNew ? '/api/admin/users' : `/api/admin/users/${user!.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? 'Could not save'); return; }
    onSaved(isNew
      ? `${name} can now sign in with ${email}.`
      : `${name}'s account has been updated.${password ? ' Their password was reset.' : ''}`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="card-head sticky top-0 bg-white z-10">
          <h3 className="card-title">{isNew ? 'Add a person' : `Edit ${user!.name}`}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Full name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ayesha Tariq Malik" />
            </div>
            <div>
              <label className="label">Corporate email — this is their username</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="name@jazz.com.pk" />
            </div>
          </div>

          <div>
            <label className="label">Job title <span className="font-normal text-ink-500">(shown in the header, optional)</span></label>
            <input className="input" value={title ?? ''} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Head of Technology" />
          </div>

          <div>
            <label className="label">Role — this decides what they can see</label>
            <select className="input" value={role} onChange={(e) => { setRole(e.target.value); setDeptIds([]); }}>
              {data.roles.map((r: string) => <option key={r} value={r}>{humanStatus(r)}</option>)}
            </select>
            <p className="text-2xs text-ink-600 mt-1 bg-ink-50 border border-ink-200 rounded px-2.5 py-1.5">
              {ROLE_HELP[role]}
            </p>
          </div>

          {(role === 'HOD' || role === 'DIRECTOR') && (
            <div>
              <label className="label">
                Division {role === 'HOD' && <span className="text-jazz-600">*</span>}
              </label>
              <select className="input" value={divisionId} onChange={(e) => { setDivisionId(e.target.value); setDeptIds([]); }}>
                <option value="">— choose a division —</option>
                {data.divisions.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employees} employees){d.hodUserId && d.hodUserId !== user?.id ? ` — currently headed by ${d.hodName}` : ''}
                  </option>
                ))}
              </select>
              {role === 'HOD' && divisionId && (
                <p className="text-2xs text-ink-500 mt-1">
                  They will see every employee in this division and be the one who submits it to HR.
                  Assigning them replaces the current Head of Department.
                </p>
              )}
            </div>
          )}

          {role === 'DIRECTOR' && (
            <div>
              <label className="label">Departments they are responsible for <span className="text-jazz-600">*</span></label>
              <div className="max-h-52 overflow-y-auto border border-ink-200 rounded-md p-2 space-y-0.5">
                {deptChoices.length === 0 && <p className="text-2xs text-ink-500 px-1 py-2">Choose a division first.</p>}
                {deptChoices.map((d: any) => (
                  <label key={d.id} className="flex items-center gap-2 text-[13px] px-1.5 py-1 hover:bg-ink-50 rounded cursor-pointer">
                    <input type="checkbox" className="accent-jazz-600"
                      checked={deptIds.includes(d.id)}
                      onChange={(e) => setDeptIds(e.target.checked ? [...deptIds, d.id] : deptIds.filter((x) => x !== d.id))} />
                    <span className="flex-1">{d.name}</span>
                    <span className="text-2xs text-ink-500">{d.employees} employees</span>
                    {d.directorUserId && d.directorUserId !== user?.id && (
                      <span className="text-2xs text-amber-700">now: {d.directorName}</span>
                    )}
                  </label>
                ))}
              </div>
              <p className="text-2xs text-ink-500 mt-1">
                They will see only the employees in the departments ticked here — not the rest of the division.
              </p>
            </div>
          )}

          <div>
            <label className="label">
              {isNew ? 'Temporary password' : 'Reset password'}
              {!isNew && <span className="font-normal text-ink-500"> — leave blank to keep the current one</span>}
            </label>
            <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={isNew ? 'At least 8 characters' : 'Leave blank to keep unchanged'} />
            <p className="text-2xs text-ink-500 mt-1">
              Share this with them directly, and ask them to tell you once they have signed in.
            </p>
          </div>

          {!isNew && user!.id !== currentUserId && (
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" className="accent-jazz-600" checked={!isActive}
                onChange={(e) => setIsActive(!e.target.checked)} />
              <span>
                <span className="font-medium text-ink-900">Deactivate this account</span>
                <span className="block text-2xs text-ink-500">
                  They lose access immediately, but everything they did stays in the audit trail.
                  Any division or department they owned becomes unassigned.
                </span>
              </span>
            </label>
          )}

          {err && <p className="text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Create account' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
