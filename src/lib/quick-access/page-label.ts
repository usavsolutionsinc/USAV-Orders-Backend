import { ADMIN_SECTION_OPTIONS, getAdminSection } from '@/components/admin/admin-sections';
import {
  SETTINGS_SECTION_OPTIONS,
  resolveSettingsSectionFromPath,
} from '@/components/settings/settings-sections';
import { PRODUCT_NAME } from '@/lib/branding/constants';
import { getSidebarTitle } from '@/lib/sidebar-titles';

export function resolveQuickAccessHref(
  pathname: string | null,
  searchParams: { toString(): string } | null,
): string {
  if (!pathname) return '';
  const search = searchParams?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * Human-readable label for a stored quick-access href. Uses route + query
 * metadata — never the generic document title / org name fallback.
 */
export function resolveQuickAccessLabel(href: string): string {
  try {
    const url = new URL(href, 'http://local');
    const pathname = url.pathname;
    const section = url.searchParams.get('section');

    if (pathname === '/signin') return 'Sign in';
    if (pathname === '/') return 'Home';

    const settingsFromPath = resolveSettingsSectionFromPath(pathname);
    if (settingsFromPath) {
      const opt = SETTINGS_SECTION_OPTIONS.find((s) => s.id === settingsFromPath);
      if (opt) return opt.label;
    }

    if (pathname === '/settings' && section) {
      const opt = SETTINGS_SECTION_OPTIONS.find((s) => s.id === section);
      if (opt) return opt.label;
    }

    if (pathname === '/admin' || pathname.startsWith('/admin')) {
      const resolved = getAdminSection(section);
      const opt = ADMIN_SECTION_OPTIONS.find((s) => s.value === resolved);
      if (opt) return opt.label;
      return 'Admin';
    }

    return getSidebarTitle(pathname);
  } catch {
    return href;
  }
}

/** Optional eyebrow meta — pathname when it adds disambiguation. */
export function resolveQuickAccessMeta(href: string, label: string): string | null {
  try {
    const url = new URL(href, 'http://local');
    const pathname = url.pathname;
    if (pathname === '/' || pathname === '/signin') return null;
    const bare = pathname + (url.search ? `?${url.search}` : '');
    if (label.toLowerCase() === bare.toLowerCase()) return null;
    return bare;
  } catch {
    return null;
  }
}

/**
 * Label for pinning / recording the current page. Prefers a real page title
 * when available, otherwise falls back to route metadata.
 */
export function resolveQuickAccessLabelFromLocation(
  pathname: string | null,
  searchParams: { toString(): string } | null,
  organizationName?: string | null,
): string {
  if (typeof document !== 'undefined') {
    const title = document.title?.trim();
    if (title && title !== PRODUCT_NAME && title !== organizationName) return title;
  }
  const href = resolveQuickAccessHref(pathname, searchParams);
  return href ? resolveQuickAccessLabel(href) : 'Page';
}
