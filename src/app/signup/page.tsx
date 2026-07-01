'use client';

/**
 * /signup — public account creation.
 *
 * One-screen flow: company name, your full name, email, PIN. On submit we
 * call /api/auth/signup which creates the org, the first admin staff,
 * hashes the PIN, and mints a session cookie. We then land them at
 * /dashboard.
 *
 * Visual language mirrors /signin (same dotted background, same rounded
 * pill toggles, same scale). A returning user lands here by mistake
 * sometimes — the bottom link sends them back to /signin.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/design-system/primitives';

interface FormState {
  companyName: string;
  fullName: string;
  email: string;
  pin: string;
  pinConfirm: string;
}

const EMPTY: FormState = {
  companyName: '',
  fullName: '',
  email: '',
  pin: '',
  pinConfirm: '',
};

function humanError(code: string | undefined): string {
  switch (code) {
    case 'INVALID_INPUT':   return 'Check your inputs and try again.';
    case 'WEAK_PIN':        return 'PIN is too obvious — avoid 0000, 1234, 1111, etc.';
    case 'RATE_LIMITED':    return 'Too many sign-ups from this network. Try again in a few minutes.';
    case 'INTERNAL':        return 'Something went wrong. Try again.';
    default:                return 'Sign-up failed. Try again.';
  }
}

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = useCallback(<K extends keyof FormState>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const valid =
    form.companyName.trim().length > 0 &&
    form.fullName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    /^\d{4,12}$/.test(form.pin) &&
    form.pin === form.pinConfirm;

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          pin: form.pin,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(humanError((data as { error?: string }).error));
        setSubmitting(false);
        return;
      }
      const data = await r.json().catch(() => ({}));
      const target = (data as { defaultHomePath?: string }).defaultHomePath || '/dashboard';
      router.replace(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }, [valid, submitting, form, router]);

  return (
    <Shell>
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Create your workspace</h1>
          <p className="mt-1.5 text-sm text-gray-500">14-day free trial. No credit card.</p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          <Field
            label="Workspace name"
            value={form.companyName}
            onChange={(v) => onChange('companyName', v)}
            placeholder="Acme Logistics"
            autoComplete="organization"
            autoFocus
          />
          <Field
            label="Your name"
            value={form.fullName}
            onChange={(v) => onChange('fullName', v)}
            placeholder="Sam Rivera"
            autoComplete="name"
          />
          <Field
            label="Work email"
            value={form.email}
            onChange={(v) => onChange('email', v)}
            placeholder="sam@acme.com"
            type="email"
            autoComplete="email"
          />
          <Field
            label="PIN (4–12 digits)"
            value={form.pin}
            onChange={(v) => onChange('pin', v.replace(/\D/g, '').slice(0, 12))}
            placeholder="••••"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
          />
          <Field
            label="Confirm PIN"
            value={form.pinConfirm}
            onChange={(v) => onChange('pinConfirm', v.replace(/\D/g, '').slice(0, 12))}
            placeholder="••••"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
          />

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="brand"
            disabled={!valid || submitting}
            className="mt-2 h-auto w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-gray-900/[0.06] hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:opacity-100"
          >
            {submitting ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>

        <p className="mt-6 text-center text-label text-gray-500">
          Already have an account?{' '}
          <a href="/signin" className="font-medium text-slate-900 hover:underline">Sign in</a>
        </p>
      </div>
    </Shell>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'email';
  autoComplete?: string;
  autoFocus?: boolean;
}

function Field({ label, value, onChange, placeholder, type = 'text', inputMode, autoComplete, autoFocus }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-medium uppercase tracking-[0.12em] text-gray-500">{label}</span>
      <input
        className="block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm shadow-gray-900/[0.02] transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-b from-gray-50 via-white to-gray-50 antialiased">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #000 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
        aria-hidden
      />
      <div className="relative flex min-h-full flex-col items-center justify-start px-6 pt-16 pb-24 sm:pt-24">
        {children}
      </div>
    </div>
  );
}
