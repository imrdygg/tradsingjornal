import React, { useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/**
 * The sign-in / sign-up screen.
 *
 * Only reachable when the build has Supabase credentials; a local-only build boots straight
 * into the journal. Extracted from App so the shell is about composing state rather than
 * carrying a second screen's form along with it.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === 'sign-up' && !result.data.session) setMessage('Check your email to confirm your account, then sign in.');
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl space-y-5">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 mb-3"><Cloud className="w-5 h-5" /><span className="text-xs font-mono uppercase tracking-wider">Private cloud journal</span></div>
          <h1 className="text-2xl font-bold">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="text-sm text-zinc-400 mt-1">Your journal syncs securely across your phone and computer.</p>
        </div>
        {message && <div className="rounded-xl border border-amber-800/70 bg-amber-950/40 p-3 text-xs text-amber-200">{message}</div>}
        <label className="block text-xs text-zinc-400">Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-600" /></label>
        <label className="block text-xs text-zinc-400">Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={6} required className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-600" /></label>
        <button disabled={busy} className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50 flex items-center justify-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'sign-in' ? 'Log in' : 'Sign up'}</button>
        <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(null); }} className="w-full text-xs text-zinc-400 hover:text-zinc-200">{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Log in'}</button>
      </form>
    </div>
  );
}
