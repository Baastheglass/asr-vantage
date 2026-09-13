'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { JazzLogo } from '@/components/ui';

const DEMO = [
  { role: 'HR Manager', email: 'hr.manager@jazz.com.pk', desc: 'Full ASR cycle, all divisions, budget control' },
  { role: 'Head of Department', email: 'hod.tech@jazz.com.pk', desc: 'Technology division only' },
  { role: 'Director', email: 'dir.tech.nw@jazz.com.pk', desc: 'Network Engineering department only' },
  { role: 'GSM President', email: 'gsm.president@jazz.com.pk', desc: 'Final approval authority' },
  { role: 'Rewards', email: 'rewards@jazz.com.pk', desc: 'Uploads the master sheet, receives the approved ASR' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('hr.manager@jazz.com.pk');
  const [password, setPassword] = useState('Jazz@2027');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign in failed');
      router.push(data.landing);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-[#1d2430] text-white p-10 relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-jazz-600/20 blur-3xl" />
        <div className="absolute -left-16 bottom-10 w-72 h-72 rounded-full bg-jazz-600/10 blur-3xl" />
        <JazzLogo light />
        <div className="relative max-w-lg">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight">
            The Annual Salary Review, without the spreadsheets.
          </h1>
          <p className="mt-4 text-white/70 text-[15px] leading-relaxed">
            One controlled workflow from the Rewards master file to final approval — with
            confidential salary data visible only to the people who need it, live budget
            control at every level, and a complete audit trail of every decision.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/75">
            {[
              'Automatic division split — no manual Excel cleaning',
              'Role-based access enforced in the database, not by passwords',
              'Live budget tracking with hard over-spend prevention',
              'Formal budget exception workflow instead of silent overruns',
              'Full version history on every increment and bonus',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-jazz-500 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-2xs text-white/40">
          Confidential — authorised personnel only. All access is logged.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><JazzLogo /></div>
          <h2 className="text-xl font-semibold text-ink-900">Sign in</h2>
          <p className="text-[13px] text-ink-500 mt-1">
            Use your corporate account to continue.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">Corporate email</label>
              <input id="email" className="input" type="email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            {error && (
              <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button className="btn-primary w-full py-2" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-ink-200">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
              Demo accounts · password <span className="font-mono text-ink-700">Jazz@2027</span>
            </p>
            <div className="space-y-1">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => { setEmail(d.email); setPassword('Jazz@2027'); }}
                  className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-ink-50 border border-transparent hover:border-ink-200 transition-colors"
                >
                  <span className="block text-[13px] font-medium text-ink-800">{d.role}</span>
                  <span className="block text-2xs text-ink-500 font-mono">{d.email}</span>
                  <span className="block text-2xs text-ink-400">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
