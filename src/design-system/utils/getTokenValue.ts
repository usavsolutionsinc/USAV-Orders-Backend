type TokenDictionary = Record<string, unknown>;

export function getTokenValue<T = unknown>(tokens: TokenDictionary, path: string): T | undefined {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as TokenDictionary)[segment];
  }, tokens) as T | undefined;
}
