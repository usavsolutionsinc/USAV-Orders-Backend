export function normalizeEnvValue(value: string | null | undefined): string {
  if (value == null) return '';

  const trimmed = String(value).trim();
  const wrapped = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (wrapped ? wrapped[2] : trimmed).trim();
}

export function normalizeMultilineEnvValue(value: string | null | undefined): string {
  return normalizeEnvValue(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}
