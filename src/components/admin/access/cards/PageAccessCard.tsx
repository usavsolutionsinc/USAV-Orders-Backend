'use client';

import type { StationTheme } from '@/utils/staff-colors';
import { Button } from '@/design-system/primitives';
import { PageAccessSwitch } from '../PageAccessSwitch';
import type { PageAccessMatrix } from '../page-access-matrix';

interface PageAccessCardProps {
  matrix: PageAccessMatrix;
  isAdmin: boolean;
  theme: StationTheme;
  borderClass: string;
  busy: boolean;
  hasOverrides: boolean;
  onToggle: (permission: string) => void;
  onResetOverrides: () => void;
}

export function PageAccessCard({
  matrix, isAdmin, theme, borderClass, busy, hasOverrides, onToggle, onResetOverrides,
}: PageAccessCardProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-white shadow-sm`}>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">.access</h2>
          <p className="mt-0.5 text-caption text-gray-500">
            {isAdmin
              ? 'Admin role grants everything. Remove the admin role to customise.'
              : 'Toggle to grant or revoke individual pages on top of the role.'}
          </p>
        </div>
        {!isAdmin && hasOverrides && (
          <Button type="button" variant="secondary" size="sm" onClick={onResetOverrides} disabled={busy}>
            Reset overrides
          </Button>
        )}
      </header>
      <ul className="divide-y divide-gray-100">
        {matrix.rows.map((row) => (
          <PageAccessSwitch
            key={row.item.id}
            label={row.item.label}
            permission={row.permission}
            enabled={row.enabled}
            source={row.source}
            theme={theme}
            disabled={isAdmin}
            busy={busy}
            onToggle={() => { if (!isAdmin) onToggle(row.permission); }}
          />
        ))}
      </ul>
    </section>
  );
}
