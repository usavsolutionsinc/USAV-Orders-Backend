const ABLY_KEY_PATTERN = /^[^.:\s]+\.[^:\s]+:[^\s]+$/;

export function getValidatedAblyApiKey(): string | null {
  const raw = process.env.ABLY_API_KEY;
  if (!raw) return null;

  const key = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!ABLY_KEY_PATTERN.test(key)) {
    throw new Error('ABLY_API_KEY is malformed. Expected "<appId>.<keyId>:<secret>" with no spaces or quotes.');
  }

  return key;
}
