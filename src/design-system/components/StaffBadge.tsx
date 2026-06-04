import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

interface StaffBadgeProps {
  /** Staff ID — used to resolve the theme color. Null/undefined renders uncolored. */
  staffId: number | null | undefined;
  /** Display name. Defaults to '---' when empty. */
  name?: string | null;
  /** Additional Tailwind classes. */
  className?: string;
  /** Render as a pill with light background + border. */
  pill?: boolean;
}

/**
 * Renders a staff name colored by their station theme.
 * Encapsulates the `stationThemeColors[getStaffThemeById(id)].text` pattern
 * used across 15+ files.
 */
export function StaffBadge({ staffId, name, className = '', pill = false }: StaffBadgeProps) {
  const display = name?.trim() || '---';
  if (!staffId) {
    return <span className={className}>{display}</span>;
  }

  const theme = getStaffThemeById(staffId);
  const colors = stationThemeColors[theme];

  if (pill) {
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${colors.light} ${colors.text} border ${colors.border} ${className}`.trim()}>
        {display}
      </span>
    );
  }

  return <span className={`${colors.text} ${className}`.trim()}>{display}</span>;
}

/**
 * Returns the staff theme text color class for a given staff ID.
 * Convenience for cases where a full component isn't needed (e.g. inline spans).
 */
export function getStaffTextColor(staffId: number | null | undefined): string | undefined {
  if (!staffId) return undefined;
  return stationThemeColors[getStaffThemeById(staffId)].text;
}

/**
 * Initials for an avatar: first letters of the first two words, or the first
 * two characters of a single-word name (so "Thuy" → "TH" and "Tuan" → "TU"
 * stay distinguishable, not both "T").
 */
export function staffInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '').slice(0, 2).toUpperCase();
}

interface StaffInitialsProps {
  /** Staff ID — resolves the theme color. */
  staffId: number | null | undefined;
  /** Display name — drives initials + the hover tooltip. */
  name?: string | null;
  /** Additional Tailwind classes. */
  className?: string;
}

/**
 * Compact "who" indicator for dense tables: the staff member's first two
 * initials, tinted in their station theme text color, with the full name on
 * hover. Fixed 2-char footprint keeps columns aligned regardless of name length
 * (a long "Michael" takes the same width as "Thuy"). Renders a muted "--" when
 * unassigned so the column stays rigid.
 */
export function StaffInitials({ staffId, name, className = '' }: StaffInitialsProps) {
  const display = (name ?? '').trim();
  const isAssigned = !!staffId && !!display && display !== '---';

  if (!isAssigned) {
    return <span className={`text-gray-300 ${className}`.trim()} aria-hidden>--</span>;
  }

  const colors = stationThemeColors[getStaffThemeById(staffId)];
  return (
    <span title={display} aria-label={display} className={`${colors.text} ${className}`.trim()}>
      {staffInitials(display)}
    </span>
  );
}
