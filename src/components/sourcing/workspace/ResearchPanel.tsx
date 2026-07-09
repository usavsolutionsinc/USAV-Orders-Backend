import { ExternalLink } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { Candidate, SourcingResearch } from './sourcing-workspace-types';

/** Hermes-ranked candidate panel — shown under a part row or queue alert. */
export function ResearchPanel({
  research,
  candidates,
  onSave,
  saving,
}: {
  research: SourcingResearch;
  candidates: Candidate[];
  onSave: (candidate: Candidate) => void;
  saving?: boolean;
}) {
  const byExternalId = new Map(candidates.map((candidate) => [candidate.externalId, candidate]));
  const byTitle = new Map(candidates.map((candidate) => [candidate.title, candidate]));

  return (
    <div className="mt-3 border-t border-border-hairline pt-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-default">{research.summary || 'Hermes ranked the current listings.'}</p>
          <p className="truncate text-caption text-text-soft">Query: {research.recommendedQuery}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold text-text-soft">{research.model}</span>
      </div>

      {research.rankedCandidates.length > 0 ? (
        <ul className="space-y-1.5">
          {research.rankedCandidates.map((ranked, index) => {
            const candidate = byExternalId.get(ranked.externalId) ?? byTitle.get(ranked.title);
            return (
              <li key={`${ranked.externalId ?? ranked.title}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-surface-canvas px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-micro font-bold uppercase ${ranked.nextAction === 'save' ? 'bg-emerald-50 text-emerald-700' : ranked.nextAction === 'skip' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                      {ranked.nextAction}
                    </span>
                    <p className="truncate text-sm font-semibold text-text-default">{ranked.title}</p>
                  </div>
                  <p className="mt-0.5 text-caption text-text-muted">{ranked.rationale}</p>
                  {ranked.riskFlags.length > 0 ? <p className="mt-1 truncate text-caption font-medium text-amber-700">{ranked.riskFlags.join(' · ')}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Score label="fit" value={ranked.fitScore} />
                  <Score label="price" value={ranked.priceScore} />
                  {candidate?.url ? (
                    <HoverTooltip label="Open listing" asChild>
                      <a href={candidate.url} target="_blank" rel="noreferrer" aria-label="Open listing" className="rounded-md p-1.5 text-text-faint hover:bg-surface-card hover:text-blue-600">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </HoverTooltip>
                  ) : null}
                  {candidate ? (
                    <Button variant="ghost" size="sm" onClick={() => onSave(candidate)} disabled={saving} className="text-emerald-700 hover:bg-surface-card hover:text-emerald-700">
                      Save
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-caption text-text-faint">No ranked candidates returned.</p>
      )}

      {research.cautions.length > 0 ? <p className="mt-2 text-caption text-amber-700">{research.cautions.join(' · ')}</p> : null}
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="w-11 text-right">
      <p className="text-xs font-bold text-text-default">{value}</p>
      <p className="text-eyebrow font-semibold uppercase text-text-faint">{label}</p>
    </div>
  );
}
