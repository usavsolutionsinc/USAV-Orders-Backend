export interface RankedSearchVariant {
  predicate: string;
  score: number | string;
  enabled?: boolean;
}

export interface BuildTextSearchVariantsArgs {
  expression: string;
  exactParam?: string | null;
  prefixParam?: string | null;
  likeParam?: string | null;
  fuzzyParam?: string | null;
  exactScore?: number;
  prefixScore?: number;
  containsScore?: number;
  fuzzyBaseScore?: number;
  fuzzyScale?: number;
  fuzzyThreshold?: number;
  enableExact?: boolean;
  enablePrefix?: boolean;
  enableContains?: boolean;
  enableFuzzy?: boolean;
}

export function buildRankedSearchSql(variants: RankedSearchVariant[]) {
  const enabled = variants.filter((variant) => {
    if (variant.enabled === false) return false;
    return Boolean(String(variant.predicate || '').trim());
  });

  if (enabled.length === 0) {
    return {
      whereClause: 'FALSE',
      rankClause: '0',
    };
  }

  return {
    whereClause: enabled.map((variant) => `(${variant.predicate})`).join('\n         OR '),
    rankClause: `GREATEST(\n           ${enabled
      .map((variant) => `CASE WHEN (${variant.predicate}) THEN ${variant.score} ELSE 0 END`)
      .join(',\n           ')}\n         )`,
  };
}

export function buildTextSearchVariants({
  expression,
  exactParam,
  prefixParam,
  likeParam,
  fuzzyParam,
  exactScore = 0,
  prefixScore = 0,
  containsScore = 0,
  fuzzyBaseScore = 0,
  fuzzyScale = 100,
  fuzzyThreshold = 0.2,
  enableExact = true,
  enablePrefix = true,
  enableContains = true,
  enableFuzzy = true,
}: BuildTextSearchVariantsArgs): RankedSearchVariant[] {
  const normalizedExpression = `LOWER(BTRIM(${expression}))`;
  const variants: RankedSearchVariant[] = [];

  if (enableExact && exactParam) {
    variants.push({
      predicate: `${normalizedExpression} = LOWER(${exactParam})`,
      score: exactScore,
    });
  }

  if (enablePrefix && prefixParam) {
    variants.push({
      predicate: `${expression} ILIKE ${prefixParam}`,
      score: prefixScore,
    });
  }

  if (enableContains && likeParam) {
    variants.push({
      predicate: `${expression} ILIKE ${likeParam}`,
      score: containsScore,
    });
  }

  if (enableFuzzy && fuzzyParam) {
    const similarityExpression = `GREATEST(
      similarity(${normalizedExpression}, LOWER(${fuzzyParam})),
      word_similarity(LOWER(${fuzzyParam}), ${normalizedExpression})
    )`;
    variants.push({
      predicate: `${similarityExpression} >= ${fuzzyThreshold}`,
      score: `${fuzzyBaseScore} + (${similarityExpression} * ${fuzzyScale})`,
    });
  }

  return variants;
}
