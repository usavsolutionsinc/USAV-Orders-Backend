'use client';

/**
 * Mobile homepage — scan history hub.
 * Scanner entry is the centre tab on the bottom bar; this screen lists recent scans.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ClipboardList } from '@/components/Icons';

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
  const [recent, setRecent] = useState<RecentScan[]>([]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) router.replace('/signin?next=/m/home');
  }, [isLoaded, user, router]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  if (!isLoaded || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-label text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-gradient-to-b from-blue-50/40 via-white to-white px-4 pb-6">
      <section
        className="flex flex-1 flex-col justify-center gap-3 py-6"
        aria-labelledby="recent-scans-heading"
      >
        <h2
          id="recent-scans-heading"
          className="text-center text-caption font-bold uppercase tracking-[0.16em] text-gray-500"
        >
          Recent scans
        </h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-5 text-center">
            <ClipboardList className="mx-auto h-6 w-6 text-gray-300" />
            <p className="mt-2 text-[12.5px] font-semibold text-gray-700">
              No scans yet
            </p>
            <p className="mt-0.5 text-caption text-gray-500">
              Codes you scan today will appear here so you can jump back in.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70">
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

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
