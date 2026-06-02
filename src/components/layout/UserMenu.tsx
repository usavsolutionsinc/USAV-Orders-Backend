'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, ChevronDown, Settings } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

/**
 * Account control for the global header's persistent right zone.
 *
 * A compact avatar/role button that opens a small popover with account context
 * (role, device) and the sign-out action. Backed by {@link useAuth}.
 */
export function UserMenu() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setOpen(false);
      router.push('/signin');
    }
  }, [signOut, router]);

  if (!user) return null;

  const role = user.role.replace(/_/g, ' ');

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-label="Account menu"
        aria-expanded={open}
        title="Account"
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 text-gray-700 transition-colors hover:bg-gray-50 active:scale-95',
          open && 'bg-gray-100',
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white">
          <User className="h-3.5 w-3.5" />
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="text-sm font-semibold capitalize text-gray-900">{role}</div>
            <div className="mt-0.5 text-micro uppercase tracking-wider text-gray-400">
              {user.session.deviceLabel || user.session.deviceKind} · Staff #{user.staffId}
            </div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); router.push('/settings'); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Settings className="h-4 w-4 text-gray-400" />
              Settings
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              <span className="flex h-4 w-4 items-center justify-center text-rose-500">⏏</span>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
