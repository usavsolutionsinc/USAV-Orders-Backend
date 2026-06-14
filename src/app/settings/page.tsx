'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HardwareSection } from '@/components/settings/sections/HardwareSection';
import { WorkstationSection } from '@/components/settings/sections/WorkstationSection';
import { QuickAccessSection } from '@/components/settings/sections/QuickAccessSection';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';
import { AboutSection } from '@/components/settings/sections/AboutSection';
import { SecuritySection } from '@/components/settings/sections/SecuritySection';
import { StaffSection } from '@/components/settings/sections/StaffSection';
import { SessionsSection } from '@/components/settings/sections/SessionsSection';
import { AuditSection } from '@/components/settings/sections/AuditSection';
import { OperationsLogSection } from '@/components/settings/sections/OperationsLogSection';
import { getActiveSettingsSection } from '@/components/sidebar/SettingsSidebarPanel';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = getActiveSettingsSection(searchParams?.get('section'));

  // Billing lives at its own route; ?section=billing is just a deep-link alias.
  useEffect(() => {
    if (active === 'billing') router.replace('/settings/billing');
  }, [active, router]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          {active === 'hardware' && <HardwareSection />}
          {active === 'workstation' && <WorkstationSection />}
          {active === 'quick-access' && <QuickAccessSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'staff' && <StaffSection />}
          {active === 'sessions' && <SessionsSection />}
          {active === 'audit' && <AuditSection />}
          {active === 'operations-log' && <OperationsLogSection />}
          {active === 'about' && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
