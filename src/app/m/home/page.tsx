'use client';

/**
 * Mobile homepage — scan-first cockpit.
 *
 * On a warehouse phone the only legitimate jobs are: scan something,
 * head to the receiving station, head to the packing station, head to
 * the testing station. This page surfaces exactly those four actions and
 * nothing else. Every other back-office route on the same device is
 * blocked by the mobile allowlist in `sidebar-navigation.ts` and redirected
 * here.
 *
 * Layout:
 *   • Greeting + signed-in name
 *   • Hero "Open scanner" tile that fills the upper half of the screen
 *     (the headline action — tap here for any QR / barcode / bin / rack)
 *   • Recent scans (last 5, surfaces deep links)
 *   • Three station tiles below: Receiving · Packing · Testing — each
 *     only visible when the user's role has access. Mirrors the
 *     MOBILE_ROLE_HOME map in /signin so the homepage doubles as the
 *     "switch station" surface.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffRole } from '@/hooks/useStaffRole';
import {
  Barcode,
  PackageCheck,
  ShoppingCart,
  Wrench,
  ClipboardList,
} from '@/components/Icons';

interface StationTile {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: ReadonlyArray<string>;
}

const STATION_TILES: ReadonlyArray<StationTile> = [
  {
    id: 'receiving',
    label: 'Receiving',
    description: 'Open today’s POs',
    href: '/m/receiving',
    icon: PackageCheck,
    roles: ['admin', 'receiving'],
  },
  {
    id: 'packing',
    label: 'Packing',
    description: 'Orders to pack',
    href: '/m/pick',
    icon: ShoppingCart,
    roles: ['admin', 'packer'],
  },
  {
    id: 'testing',
    label: 'Testing',
    description: 'Service & repair',
    href: '/tech',
    icon: Wrench,
    roles: ['admin', 'technician'],
  },
];

interface RecentScan {
  id: string;
  code: string;
  label: string;
  href: string;
  at: number;
}

const RECENT_SCANS_KEY = 'usav.recent.scans';
const MAX_RECENT = 5;

function readRecent(): RecentScan[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SCANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export default function MobileHomePage() {
  const router = useRouter();
  const { user, isLoaded } = useAuth();
  const { role } = useStaffRole();
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [greeting] = useState(() => greetingFor(new Date()));

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) router.replace('/signin?next=/m/home');
  }, [isLoaded, user, router]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  const stations = useMemo(
    () => STATION_TILES.filter((s) => s.roles.includes(role)),
    [role],
  );

  if (!isLoaded || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-label text-gray-400">
        Loading…
      </div>
    );
  }

  const displayName = (user as { name?: string } | null)?.name ?? 'there';
  const firstName = displayName.split(' ')[0];

  return (
    <div className="flex min-h-full flex-col gap-4 bg-gradient-to-b from-blue-50/40 via-white to-white px-4 pb-6 pt-5">
      {/* Greeting */}
      <header className="px-1">
        <p className="text-caption font-bold uppercase tracking-[0.16em] text-blue-600">
          {greeting}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
          {firstName}
        </h1>
        <p className="mt-0.5 text-[12.5px] leading-snug text-gray-500">
          Tap below to scan. Every job on this device starts with a scan.
        </p>
      </header>

      {/* Hero scan tile — the headline action. Sized to dominate the
          viewport so the operator never has to hunt for it. */}
      <Link
        href="/m/scan"
        className="group relative overflow-hidden rounded-[28px] bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 text-white shadow-[0_18px_40px_rgba(37,99,235,0.45)] transition-transform active:scale-[0.985]"
        style={{ aspectRatio: '5 / 4' }}
      >
        {/* Decorative orbs */}
        <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute -bottom-16 -left-12 h-56 w-56 rounded-full bg-blue-300/30 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.15),transparent_55%)]" />

        <div className="relative flex h-full flex-col justify-between p-6">
          <div className="flex items-start justify-between">
            <span className="rounded-full bg-white/15 px-3 py-1 text-micro font-bold uppercase tracking-[0.18em] text-blue-50 ring-1 ring-white/20 backdrop-blur">
              Tap to scan
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-base text-white transition-transform group-active:translate-x-0.5">
              →
            </div>
          </div>

          <div>
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <Barcode className="h-10 w-10 text-white" />
            </div>
            <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight">
              Open scanner
            </h2>
            <p className="mt-1 max-w-[28ch] text-sm leading-snug text-blue-50/85">
              Bin, rack, carton, SKU, serial — anything with a barcode or QR.
              We route the next step automatically.
            </p>
          </div>
        </div>
      </Link>

      {/* Stations — only the ones the user can access. */}
      {stations.length > 0 && (
        <section>
          <h3 className="px-1 text-caption font-bold uppercase tracking-[0.16em] text-gray-500">
            Your stations
          </h3>
          <div
            className={`mt-2 grid gap-2.5 ${
              stations.length === 1
                ? 'grid-cols-1'
                : stations.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-3'
            }`}
          >
            {stations.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.id}
                  href={s.href}
                  className="group flex flex-col items-start gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-gray-200/70 transition-all active:scale-[0.98] active:bg-gray-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/70 ring-1 ring-blue-100">
                    <Icon className="h-4.5 w-4.5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-gray-900">
                      {s.label}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-gray-500">
                      {s.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent scans */}
      <section className="mt-1">
        <h3 className="px-1 text-caption font-bold uppercase tracking-[0.16em] text-gray-500">
          Recent scans
        </h3>
        {recent.length === 0 ? (
          <div className="mt-2 rounded-2xl border border-dashed border-gray-200 bg-white p-5 text-center">
            <ClipboardList className="mx-auto h-6 w-6 text-gray-300" />
            <p className="mt-2 text-[12.5px] font-semibold text-gray-700">
              No scans yet
            </p>
            <p className="mt-0.5 text-caption text-gray-500">
              Codes you scan today will appear here so you can jump back in.
            </p>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors active:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12.5px] font-semibold text-gray-900">
                      {r.code}
                    </p>
                    <p className="mt-0.5 truncate text-[10.5px] text-gray-500">
                      {r.label}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-gray-400">
                    {formatAge(Date.now() - r.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Late night';
}

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
