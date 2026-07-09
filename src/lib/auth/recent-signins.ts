/** Client-side "recent sign-ins" list for the staff picker (localStorage). */

export const RECENT_SIGNINS_KEY = 'usav.recentSignins';
export const MAX_RECENT_SIGNINS = 3;

export function readRecentSignins(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SIGNINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number');
  } catch {
    return [];
  }
}

export function writeRecentSignin(staffId: number): void {
  try {
    const prev = readRecentSignins().filter((n) => n !== staffId);
    const next = [staffId, ...prev].slice(0, MAX_RECENT_SIGNINS);
    window.localStorage.setItem(RECENT_SIGNINS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
