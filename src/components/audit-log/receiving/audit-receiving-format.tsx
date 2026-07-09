import { formatPSTTimestamp } from '@/utils/date';
import { AlertTriangle, Box, Camera, Package, User } from '@/components/Icons';

/** Pure formatters + the event-kind metadata/icon map for the receiving audit log. */

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatPSTTimestamp(new Date(iso));
  } catch {
    return iso;
  }
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

type IconName = 'box' | 'check' | 'photo' | 'user' | 'warn' | 'tag' | 'sync';

const KIND_META: Record<string, { label: string; tone: string; icon: IconName }> = {
  CARTON_CREATED:      { label: 'Package created',     tone: 'bg-surface-sunken text-text-muted ring-border-soft',   icon: 'box' },
  CARTON_RECEIVED:     { label: 'Package received',    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  CARTON_UNBOXED:      { label: 'Package unboxed',     tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'box' },
  LINE_CREATED:        { label: 'Line synced',        tone: 'bg-surface-sunken text-text-muted ring-border-soft',   icon: 'sync' },
  RECEIVED:            { label: 'Line received',      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  TEST_START:          { label: 'Test started',       tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  TEST_PASS:           { label: 'Test passed',        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'check' },
  TEST_FAIL:           { label: 'Test failed',        tone: 'bg-rose-50 text-rose-700 ring-rose-200',       icon: 'warn' },
  PUTAWAY:             { label: 'Put away in bin',    tone: 'bg-violet-50 text-violet-700 ring-violet-200', icon: 'tag' },
  MOVED:               { label: 'Moved to new bin',   tone: 'bg-violet-50 text-violet-700 ring-violet-200', icon: 'tag' },
  PICKED:              { label: 'Picked',             tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'tag' },
  PACKED:              { label: 'Packed',             tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'tag' },
  SHIPPED:             { label: 'Shipped',            tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200', icon: 'tag' },
  ADJUSTED:            { label: 'Stock adjusted',     tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  RETURNED:            { label: 'Returned',           tone: 'bg-amber-50 text-amber-700 ring-amber-200',    icon: 'warn' },
  SCRAPPED:            { label: 'Scrapped',           tone: 'bg-rose-50 text-rose-700 ring-rose-200',       icon: 'warn' },
  NOTE:                { label: 'Note',               tone: 'bg-surface-sunken text-text-muted ring-border-soft',   icon: 'tag' },
  DISPOSITION_CHANGED: { label: 'Disposition changed', tone: 'bg-amber-50 text-amber-700 ring-amber-200',   icon: 'tag' },
  PHOTO_ADDED:         { label: 'Photo added',        tone: 'bg-sky-50 text-sky-700 ring-sky-200',          icon: 'photo' },
};

export function kindMeta(kind: string) {
  return (
    KIND_META[kind] ?? {
      label: kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      tone: 'bg-surface-sunken text-text-muted ring-border-soft',
      icon: 'tag' as const,
    }
  );
}

export function KindIcon({ name }: { name: IconName }) {
  const cls = 'w-3.5 h-3.5';
  switch (name) {
    case 'box':   return <Box className={cls} />;
    case 'photo': return <Camera className={cls} />;
    case 'user':  return <User className={cls} />;
    case 'warn':  return <AlertTriangle className={cls} />;
    case 'sync':  return <Package className={cls} />;
    case 'check': return (
      <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
    );
    case 'tag':
    default:
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/></svg>
      );
  }
}

export function hasNonTrivialDetail(d: Record<string, unknown>): boolean {
  if (!d) return false;
  const keys = Object.keys(d).filter((k) => d[k] != null && d[k] !== '' && k !== 'url');
  return keys.length > 0;
}
