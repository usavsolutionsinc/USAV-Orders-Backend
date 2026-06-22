'use client';

import { useSearchParams } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';
import { useSidebarSearchNavigation } from '@/components/sidebar/dashboard-sidebar-hooks';

/**
 * Admin route context panel. Reads the active section from `?section=` and
 * keeps it in sync with the URL, clearing the param when landing on overview so
 * deep-links and the back button resolve cleanly.
 */
export function AdminContextPanel() {
  const searchParams = useSearchParams();
  const updateSearch = useSidebarSearchNavigation();

  const requestedSection = (searchParams.get('section') as AdminSection) || 'overview';
  const activeSection = ADMIN_SECTION_OPTIONS.some((item) => item.value === requestedSection)
    ? requestedSection
    : 'overview';

  return (
    <div className="h-full overflow-hidden">
      <AdminSidebar
        activeSection={activeSection}
        onSectionChange={(nextSection) => {
          if (nextSection === 'overview') {
            updateSearch((params) => { params.delete('section'); }, '/admin');
          } else {
            updateSearch((params) => { params.set('section', nextSection); }, '/admin');
          }
        }}
      />
    </div>
  );
}
