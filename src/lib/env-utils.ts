export function normalizeEnvValue(value: string | null | undefined): string {
  if (value == null) return '';

  const trimmed = String(value).trim();
  const wrapped = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (wrapped ? wrapped[2] : trimmed).trim();
}

/** Public app origin (no trailing slash) for OAuth callbacks, invite links, etc. */
export function resolvePublicAppUrl(): string {
  const explicit =
    normalizeEnvValue(process.env.APP_URL) ||
    normalizeEnvValue(process.env.NEXT_PUBLIC_APP_URL) ||
    (process.env.VERCEL_URL
      ? `https://${normalizeEnvValue(process.env.VERCEL_URL)}`
      : '');

  // Vercel env paste occasionally leaves a literal "\n" on the value.
  return explicit.replace(/\\n/g, '').replace(/\/+$/, '');
}

export function normalizeMultilineEnvValue(value: string | null | undefined): string {
  return normalizeEnvValue(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}
