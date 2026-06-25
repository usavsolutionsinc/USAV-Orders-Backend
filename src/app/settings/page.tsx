'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HardwareSection } from '@/components/settings/sections/HardwareSection';
import { WorkstationSection } from '@/components/settings/sections/WorkstationSection';
import { QuickAccessSection } from '@/components/settings/sections/QuickAccessSection';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';
import { AboutSection } from '@/components/settings/sections/AboutSection';
import { SecuritySection } from '@/components/settings/sections/SecuritySection';
import { SessionsSection } from '@/components/settings/sections/SessionsSection';
import { CatalogSection } from '@/components/settings/sections/CatalogSection';
import { LegalSection } from '@/components/settings/sections/LegalSection';
import { getActiveSettingsSection } from '@/components/settings/settings-sections';

const LEGACY_REDIRECTS: Record<string, string> = {
  staff: '/settings/staff',
  team: '/settings/staff',
  billing: '/settings/billing',
  integrations: '/settings/integrations',
  audit: '/settings/audit',
  organization: '/settings/organization',
  roles: '/settings/roles',
  access: '/settings/access',
  'operations-log': '/admin?section=logs',
};

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSection = searchParams?.get('section');
  const active = getActiveSettingsSection(rawSection);

  useEffect(() => {
    if (!rawSection) return;
    const target = LEGACY_REDIRECTS[rawSection.toLowerCase()];
    if (target) router.replace(target);
  }, [rawSection, router]);

  if (rawSection && LEGACY_REDIRECTS[rawSection.toLowerCase()]) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          {active === 'hardware' && <HardwareSection />}
          {active === 'workstation' && <WorkstationSection />}
          {active === 'quick-access' && <QuickAccessSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'sessions' && <SessionsSection />}
          {active === 'catalog' && <CatalogSection />}
          {active === 'about' && <AboutSection />}
          {active === 'legal' && <LegalSection />}
        </div>
      </main>
    </div>
  );
}
