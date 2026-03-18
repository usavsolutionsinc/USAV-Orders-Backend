/**
 * Capitalises the first letter of a string.
 * @example capitalize('hello') → 'Hello'
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Converts camelCase or PascalCase to Title Case.
 * @example toTitleCase('myVariableName') → 'My Variable Name'
 */
export function toTitleCase(s: string): string {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Truncates string to maxLength with ellipsis.
 * @example truncate('Hello World', 8) → 'Hello...'
 */
export function truncate(s: string, maxLength: number, suffix = '...'): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Converts a string to a URL-safe slug.
 * @example slugify('Hello World!') → 'hello-world'
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strips HTML tags from a string.
 */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

/**
 * Returns true if a string is null, undefined, or empty after trimming.
 */
export function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim().length === 0;
}

/**
 * Pads a string/number to a fixed width with a given character.
 * @example padStart(5, 3, '0') → '005'
 */
export function padStart(value: string | number, length: number, char = ' '): string {
  return String(value).padStart(length, char);
}
