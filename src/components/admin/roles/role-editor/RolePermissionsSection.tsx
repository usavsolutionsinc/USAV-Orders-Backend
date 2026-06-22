'use client';

import { PERMISSION_CATEGORIES, type PermissionString } from '@/lib/auth/permissions-shared';
import { APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';
import { PermissionToggle } from '../PermissionToggle';

/**
 * Card B.0 (.access page-view shortcuts) + Card B (the full permission grid
 * grouped by PERMISSION_CATEGORIES). Both flip the same `.view`/permission
 * strings via `onToggle`.
 */
export function RolePermissionsSection({
  roleColor,
  isAdminRole,
  enabledSet,
  busy,
  onToggle,
}: {
  roleColor: string;
  isAdminRole: boolean;
  enabledSet: Set<string>;
  busy: string | null;
  onToggle: (perm: PermissionString) => void;
}) {
  return (
    <>
      {/* Card B.0 — .access shortcut (per-page view toggles) */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">.access</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              Quick-toggle which sidebar pages this role can see. Each toggle flips the matching <code className="font-mono">.view</code> permission below.
            </p>
          </div>
        </header>
        <ul className="divide-y divide-gray-100">
          {APP_SIDEBAR_NAV.filter((item) => item.requires).map((item) => {
            const perm = item.requires as PermissionString;
            const enabled = isAdminRole || enabledSet.has(perm);
            return (
              <PermissionToggle
                key={item.id}
                label={item.label}
                permission={perm}
                enabled={enabled}
                color={roleColor}
                disabled={isAdminRole || busy === `perm:${perm}`}
                onToggle={() => onToggle(perm)}
              />
            );
          })}
        </ul>
      </section>

      {/* Card B — Permissions */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Permissions</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              {isAdminRole
                ? 'Admin role grants every permission and cannot be customised.'
                : `Toggle what staff in this role can do. ${enabledSet.size} of many enabled.`}
            </p>
          </div>
        </header>
        {PERMISSION_CATEGORIES.map((cat) => (
          <div key={cat.id} className="border-b border-gray-100 last:border-b-0">
            <div className="bg-gray-50/60 px-5 py-2 text-micro font-bold uppercase tracking-widest text-gray-500">{cat.label}</div>
            <ul className="divide-y divide-gray-100">
              {cat.permissions.map((perm) => (
                <PermissionToggle
                  key={perm}
                  label={perm.replace(/^[a-z_]+\./, '').replace(/_/g, ' ')}
                  permission={perm}
                  enabled={isAdminRole || enabledSet.has(perm)}
                  color={roleColor}
                  disabled={isAdminRole || busy === `perm:${perm}`}
                  onToggle={() => onToggle(perm)}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
