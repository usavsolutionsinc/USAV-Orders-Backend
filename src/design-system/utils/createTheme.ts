import { getTokenValue } from './getTokenValue';

type ThemeSource = Record<string, unknown>;

function flattenTheme(source: ThemeSource, prefix = ''): Record<string, string> {
  return Object.entries(source).reduce<Record<string, string>>((accumulator, [key, value]) => {
    const nextKey = prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(accumulator, flattenTheme(value as ThemeSource, nextKey));
      return accumulator;
    }

    accumulator[nextKey] = String(value);
    return accumulator;
  }, {});
}

export function createTheme(theme: ThemeSource) {
  return {
    raw: theme,
    values: flattenTheme(theme),
    get<T = unknown>(path: string) {
      return getTokenValue<T>(theme, path);
    },
  };
}
