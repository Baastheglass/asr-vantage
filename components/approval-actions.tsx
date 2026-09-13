'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Badge } from './ui';

export function ApprovalActions({
  cycleId, cycleName, status, ready, role, divisions,
}: {
  cycleId: number; cycleName: string; status: string; ready: boolean; role: string;
  divisions: { id: number; name: string; status: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<null | 'CHANGES' | 'REJECT' | 'GSM' | 'REWARDS'>(null);
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const isHR = role === 'HR_MANAGER' || role === 'ADMIN';
  const isGSM = role === 'GSM_PRESIDENT';

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError('');
    const res = await fetch(`/api/cycles/${cycleId}/workflow`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, comment, ...extra }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Action failed'); return; }
    setDialog(null); setComment('');
    router.refresh();
  }

  /* ---------------- HR view ---------------- */
  if (isHR) {
    if (status === 'APPROVED') {
      return (
        <Card title="Approved by the GSM President">
          <p className="text-[13px] text-ink-700 mb-3">
            {cycleName} has been approved. Submitting to Rewards freezes an immutable copy of every
            approved figure and releases it to the Rewards department for processing.
          </p>
          {error && <Err msg={error} />}
          <button className="btn-primary" disabled={busy} onClick={() => call('SUBMIT_REWARDS')}>
            {busy ? 'Submitting…' : 'Submit final ASR to Rewards'}
          </button>
        </Card>
      );
    }
    if (status === 'SUBMITTED_TO_REWARDS' || status === 'COMPLETED') {
      return (
        <Card title="ASR complete">
          <p className="text-[13px] text-ink-700">
            The approved ASR has been released to Rewards and the cycle is frozen. No further edits are possible.
          </p>
        </Card>
      );
    }
    if (status === 'PENDING_GSM') {
      return (
        <Card title="Awaiting GSM President approval">
          <p className="text-[13px] text-ink-700">
            {cycleName} was submitted for approval and every division is locked while the President reviews it.
            You will be notified as soon as a decision is recorded.
          </p>
        </Card>
      );
    }
    if (status === 'CHANGES_REQUESTED') {
      return (
        <Card title="Changes requested by the GSM President">
          <p className="text-[13px] text-ink-700 mb-3">
            The affected divisions have been reopened and their HODs notified. Once the revisions are
            submitted, send the ASR back for approval — the divisions that were not returned keep their
            completed work.
          </p>
          {error && <Err msg={error} />}
          <button className="btn-primary" disabled={busy} onClick={() => call('SUBMIT_GSM', { force: !ready })}>
            Re-submit for GSM approval
          </button>
        </Card>
      );
    }

    return (
      <Card title="Proceed to GSM approval">
        <p className="text-[13px] text-ink-700 mb-3">
          {ready
            ? 'All readiness checks have passed. Submitting locks every division and notifies the GSM President.'
            : 'Some readiness checks have not passed. Resolve them, or override with a recorded justification.'}
        </p>
        {error && <Err msg={error} />}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !ready} onClick={() => call('SUBMIT_GSM')}>
            {busy ? 'Submitting…' : 'Proceed to GSM approval'}
          </button>
          {!ready && (
            <button className="btn-secondary" onClick={() => setDialog('GSM')}>
              Override and submit anyway
            </button>
          )}
        </div>

        {dialog === 'GSM' && (
          <Dialog title="Override readiness checks" onClose={() => setDialog(null)}>
            <p className="text-[13px] text-ink-700 mb-3">
              Submitting with failed checks is recorded in the audit trail against your name.
              Explain why this is being escalated now.
            </p>
            <textarea className="input min-h-24" rows={4} value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Two divisions will not complete before the Rewards deadline; the President has agreed to review the remainder." />
            {error && <Err msg={error} />}
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn-danger" disabled={busy || comment.trim().length < 10}
                onClick={() => call('SUBMIT_GSM', { force: true })}>
                Submit with override
              </button>
            </div>
          </Dialog>
        )}
      </Card>
    );
  }

  /* ---------------- GSM view ---------------- */
  if (isGSM) {
    if (status !== 'PENDING_GSM') {
      return (
        <Card title="No approval pending">
          <p className="text-[13px] text-ink-700">
            {status === 'APPROVED' || status === 'SUBMITTED_TO_REWARDS' || status === 'COMPLETED'
              ? 'You have already approved this ASR cycle.'
              : status === 'CHANGES_REQUESTED'
              ? 'You returned this ASR to HR. It will reappear here once the revisions are submitted.'
              : 'HR has not yet submitted this ASR for approval.'}
          </p>
        </Card>
      );
    }

    return (
      <Card title="Your decision" subtitle={`${cycleName} has been submitted for your approval`}>
        {error && <Err msg={error} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn-success" disabled={busy} onClick={() => call('APPROVE')}>
            {busy ? 'Recording…' : 'Approve ASR'}
          </button>
          <button className="btn-secondary" onClick={() => setDialog('CHANGES')}>Request changes</button>
          <button className="btn-danger" onClick={() => setDialog('REJECT')}>Reject</button>
        </div>

        {(dialog === 'CHANGES' || dialog === 'REJECT') && (
          <Dialog title={dialog === 'CHANGES' ? 'Request changes' : 'Reject ASR'} onClose={() => setDialog(null)}>
            <label className="label">What needs to change?</label>
            <textarea className="input min-h-24" rows={4} value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Be specific — this is sent to HR and to the HODs of the divisions you select below." />

            <div className="mt-3">
              <label className="label">
                Return only these divisions <span className="font-normal text-ink-500">(leave empty to return the whole cycle)</span>
              </label>
              <div className="max-h-44 overflow-y-auto border border-ink-200 rounded-md p-2 space-y-1">
                {divisions.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-[13px] px-1 py-0.5 hover:bg-ink-50 rounded cursor-pointer">
                    <input type="checkbox" className="accent-jazz-600"
                      checked={selected.includes(d.id)}
                      onChange={(e) => setSelected(e.target.checked
                        ? [...selected, d.id]
                        : selected.filter((x) => x !== d.id))} />
                    <span className="flex-1">{d.name}</span>
                    <Badge tone="gray">{d.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </label>
                ))}
              </div>
              <p className="text-2xs text-ink-500 mt-1">
                Divisions you do not select keep their completed work and are not reopened.
              </p>
            </div>

            {error && <Err msg={error} />}
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
              <button className={dialog === 'REJECT' ? 'btn-danger' : 'btn-primary'}
                disabled={busy || comment.trim().length < 10}
                onClick={() => call(dialog === 'REJECT' ? 'REJECT' : 'REQUEST_CHANGES', { divisionIds: selected })}>
                {dialog === 'REJECT' ? 'Reject and return' : 'Request changes'}
              </button>
            </div>
          </Dialog>
        )}
      </Card>
    );
  }

  return null;
}

function Err({ msg }: { msg: string }) {
  return <p className="text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 my-2">{msg}</p>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3 className="card-title">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose}>×</button></div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
