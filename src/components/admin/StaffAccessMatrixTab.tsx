'use client';

/**
 * /admin?section=access — thin shell.
 *
 * The picker now lives in the sidebar (AccessSidebarPanel). This component
 * just reads `?staffId=` from the URL and renders the StaffAccessDetail for
 * that staff, or an empty state if nothing is selected.
 */

import { useSearchParams } from 'next/navigation';
import { StaffAccessDetail } from './access/StaffAccessDetail';

export function StaffAccessMatrixTab() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('staffId');
  const staffId = (() => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  if (staffId == null) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50/30 p-6">
        <div className="max-w-md rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Pick a staff member</h2>
          <p className="mt-1 text-[12px] text-gray-500">
            Choose someone from the sidebar to manage their role, page access, PIN, passkeys, and sessions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <StaffAccessDetail key={staffId} staffId={staffId} />
    </div>
  );
}
