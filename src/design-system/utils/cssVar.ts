export function toCssVarName(tokenName: string): string {
  return `--${tokenName.replace(/\./g, '-').replace(/\s+/g, '-').toLowerCase()}`;
}

export function cssVar(tokenName: string, fallback?: string): string {
  const variableName = toCssVarName(tokenName);
  return fallback ? `var(${variableName}, ${fallback})` : `var(${variableName})`;
}
