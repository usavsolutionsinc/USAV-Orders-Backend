'use client';

/**
 * /admin?section=roles — thin shell. Reads ?roleId from URL and renders
 * RoleEditor or an empty state.
 */

import { useSearchParams } from 'next/navigation';
import { RoleEditor } from './roles/RoleEditor';

export function RolesAdminTab() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('roleId');
  const roleId = (() => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  if (roleId == null) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50/30 p-6">
        <div className="max-w-md rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Pick a role</h2>
          <p className="mt-1 text-[12px] text-gray-500">
            Choose a role from the sidebar to edit its permissions, color, and members. Drag to reorder priority. Click + to create a new role.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <RoleEditor key={roleId} roleId={roleId} />
    </div>
  );
}
