import { getHermesApiUrl, getHermesHeaders } from '@/lib/ai/hermes-client';
import type { NormalizedCandidate } from '@/lib/sourcing/normalize';

export interface SourcingResearchCandidate {
  externalId: string | null;
  title: string;
  fitScore: number;
  priceScore: number;
  riskFlags: string[];
  rationale: string;
  nextAction: 'save' | 'compare' | 'skip';
}

export interface SourcingResearchResult {
  summary: string;
  recommendedQuery: string;
  rankedCandidates: SourcingResearchCandidate[];
  cautions: string[];
  model: string;
}

interface ResearchToolArgs {
  summary?: unknown;
  recommended_query?: unknown;
  ranked_candidates?: unknown;
  cautions?: unknown;
}

const SYSTEM_PROMPT = [
  'You help a used-electronics operations team source replacement products and parts.',
  'You are given the search target plus normalized marketplace candidates.',
  'Return strict JSON only. No markdown, no prose outside JSON.',
  '',
  'Rules:',
  '- Use only the candidate data provided. Do not invent listings, prices, sellers, or compatibility.',
  '- Rank practical buys for a small used-electronics shop: correct item first, then total cost, condition, seller signal, and disclosure risk.',
  '- Flag ambiguous titles, for-parts condition, missing price, high price, missing seller, and compatibility uncertainty.',
  '- Keep the summary short and operational.',
  '',
  'Required JSON shape:',
  '{',
  '  "summary": "short operational summary",',
  '  "recommended_query": "best query to rerun or watch",',
  '  "ranked_candidates": [',
  '    {',
  '      "key": "candidate key exactly as provided",',
  '      "fit_score": 0,',
  '      "price_score": 0,',
  '      "risk_flags": ["short risk"],',
  '      "rationale": "one sentence",',
  '      "next_action": "save|compare|skip"',
  '    }',
  '  ],',
  '  "cautions": ["short caution"]',
  '}',
].join('\n');

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 8);
}

function candidateKey(candidate: NormalizedCandidate): string {
  return candidate.externalId || candidate.title;
}

function extractJsonObject(text: string): ResearchToolArgs {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Hermes returned no JSON object for sourcing research');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as ResearchToolArgs;
}

export async function researchSourcingCandidates(input: {
  query: string;
  modelNumber?: string | null;
  partRole?: string | null;
  maxPriceCents?: number | null;
  candidates: NormalizedCandidate[];
}): Promise<SourcingResearchResult> {
  const candidateLookup = new Map(input.candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const compactCandidates = input.candidates.slice(0, 20).map((candidate) => ({
    key: candidateKey(candidate),
    externalId: candidate.externalId,
    title: candidate.title,
    condition: candidate.condition,
    priceCents: candidate.priceCents,
    shippingCents: candidate.shippingCents,
    currency: candidate.currency,
    sellerName: candidate.sellerName,
    source: candidate.source,
  }));

  const model = String(process.env.HERMES_MODEL || 'hermes-agent').trim();
  const res = await fetch(`${getHermesApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHermesHeaders({ 'content-type': 'application/json', 'X-Source': 'usav-sourcing-research' }),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1600,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(
      {
        target: {
          query: input.query,
          modelNumber: input.modelNumber ?? null,
          partRole: input.partRole ?? null,
          maxPriceCents: input.maxPriceCents ?? null,
        },
        candidates: compactCandidates,
      },
      null,
      2,
          ),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw new Error(`Hermes sourcing research ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? '');
  const args = extractJsonObject(content);
  const reportedModel = String(data?.model || model);

  if (!Array.isArray(args.ranked_candidates)) {
    throw new Error('Hermes sourcing research returned invalid ranked_candidates');
  }

  const rankedCandidates = Array.isArray(args.ranked_candidates)
    ? args.ranked_candidates.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const key = String(row.key ?? '').trim();
        const source = candidateLookup.get(key);
        if (!source) return [];
        const nextAction = ['save', 'compare', 'skip'].includes(String(row.next_action))
          ? (String(row.next_action) as SourcingResearchCandidate['nextAction'])
          : 'compare';
        return [{
          externalId: source.externalId,
          title: source.title,
          fitScore: clampScore(row.fit_score),
          priceScore: clampScore(row.price_score),
          riskFlags: cleanStringArray(row.risk_flags),
          rationale: String(row.rationale ?? '').trim(),
          nextAction,
        }];
      })
    : [];

  return {
    summary: String(args.summary ?? '').trim(),
    recommendedQuery: String(args.recommended_query ?? input.query).trim() || input.query,
    rankedCandidates,
    cautions: cleanStringArray(args.cautions),
    model: reportedModel,
  };
}
