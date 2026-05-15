import { messagesEn, type MessageKey } from './messages.en';
import { messagesEs } from './messages.es';

export type Locale = 'en' | 'es';

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: messagesEn,
  es: messagesEs,
};

/**
 * Lookup a UI string for the active locale, with English fallback.
 *
 * Placeholders use {name} syntax — pass values via the `vars` arg:
 *   t('numpad.confirmed', { sign: '−', qty: 3 })
 *
 * Designed as the smallest opt-in surface so we can migrate strings
 * gradually without breaking anything. When we graduate to next-intl,
 * this helper becomes a thin shim over `useTranslations()`.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
  locale: Locale = 'en',
): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  const template = dict[key] ?? messagesEn[key] ?? String(key);
  if (!vars) return template;
  return Object.keys(vars).reduce(
    (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k])),
    template,
  );
}

/**
 * Detect the active locale from a request header or browser. Defaults to
 * English. Conservative — only flips to a non-English locale when the
 * browser explicitly prefers it.
 */
export function detectLocale(acceptLanguage: string | null | undefined): Locale {
  const header = (acceptLanguage || '').toLowerCase();
  if (header.startsWith('es')) return 'es';
  return 'en';
}
