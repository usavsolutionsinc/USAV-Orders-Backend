'use client';

/**
 * Registry icon names → local icon components. Definitions in src/lib/stations
 * declare icons as strings (lucide-style names) so the lib layer stays free of
 * React imports; this map is the single client-side resolver.
 */

import {
  ClipboardList,
  Check,
  X,
  Inbox,
  Mail,
  List,
  Box,
  Truck,
  Clock,
} from '@/components/Icons';

const ICONS: Record<string, React.FC<{ className?: string }>> = {
  ListChecks: ClipboardList,
  ClipboardList,
  Check,
  X,
  Inbox,
  Mail,
  List,
  Box,
  Truck,
  Clock,
};

export function StationIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Box;
  return <Icon className={className} />;
}
