'use client';

// MOUNT: render <WorkspaceSwitcher /> inside OrganizationSection.tsx (e.g. just
// below ActiveWorkspaceCard) — self-contained, reads memberships from useAuth().

/**
 * Settings → Organization · "Switch workspace".
 *
 * Lists every OTHER workspace the signed-in account can act in (memberships
 * from the auth envelope, minus the current org) and switches the active tenant
 * via POST /api/auth/switch-org { organizationId }. The whole block renders only
 * when the account belongs to >1 workspace — a single-org account sees nothing.
 *
 * On success the server revokes the old session and mints a new one for the
 * target org's staff profile (overwriting the cookie), so we HARD-reload to the
 * new workspace home — never router.push — to reset React Query caches, Ably
 * subscriptions, and the RLS GUC cleanly to the new tenant.
 *
 * switch-org response shape coded against (see src/app/api/auth/switch-org):
 *   200 { ok: true, organizationId, unchanged?: true, staffId?, session? }
 *   400 { error: 'INVALID_REQUEST' }    409 { error: 'MULTI_ORG_NOT_PROVISIONED' }
 *   401 { error: 'NOT_AUTHENTICATED' }  403 { error: 'NOT_A_MEMBER' }
 *   500 { error: 'INTERNAL' }
 */

import { useState } from 'react';
import { Button } from '@/design-system/primitives';
import { useAuth } from '@/contexts/AuthContext';

function orgInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'W'
  );
}

/** Map a switch-org error code to a friendly, human line. */
function switchErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'MULTI_ORG_NOT_PROVISIONED':
      return 'Multi-workspace switching isn’t set up for this account yet. Contact your administrator.';
    case 'NOT_A_MEMBER':
      return 'You’re not a member of that workspace.';
    case 'NOT_AUTHENTICATED':
      return 'Your session has expired — please sign in again.';
    default:
      return 'Couldn’t switch workspace. Please try again.';
  }
}

export function WorkspaceSwitcher() {
  const { user } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchErr, setSwitchErr] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const others = memberships.filter((m) => !m.isCurrent);

  // Only surface the switcher when the account has another workspace to go to.
  if (!user || memberships.length <= 1 || others.length === 0) return null;

  const switchTo = async (organizationId: string, name: string) => {
    if (switching) return;
    if (
      !window.confirm(
        `Switch to ${name}? Your current view and any unsaved scan state will close.`,
      )
    ) {
      return;
    }
    setSwitching(organizationId);
    setSwitchErr(null);
    try {
      const r = await fetch('/api/auth/switch-org', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setSwitchErr(switchErrorMessage(data.error));
        setSwitching(null);
        return;
      }
      // Hard reload so caches / realtime subscriptions / RLS context reset
      // cleanly to the new tenant. NOT router.push.
      window.location.assign('/dashboard');
    } catch {
      setSwitchErr(switchErrorMessage(undefined));
      setSwitching(null);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-900">Switch workspace</h3>
        <p className="text-xs text-gray-500">
          This account can act in {memberships.length} workspaces. Switching closes
          your current view and reloads into the selected workspace.
        </p>
      </div>

      {switchErr && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
          {switchErr}
        </div>
      )}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
        {others.map((m) => (
          <div
            key={m.organizationId}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-xs font-bold text-gray-700">
              {orgInitials(m.organizationName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-900">
                {m.organizationName}
              </div>
              <div className="truncate text-xs text-gray-500">
                {m.organizationSlug ?? '—'}
                {m.role ? ` · ${m.role.replace(/_/g, ' ')}` : ''}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={switching === m.organizationId}
              disabled={!!switching}
              onClick={() => void switchTo(m.organizationId, m.organizationName)}
            >
              {switching === m.organizationId ? 'Switching…' : 'Switch'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkspaceSwitcher;
