'use client';

import { useMemo, useState } from 'react';
import MarkdownRenderer from '@/components/ai/MarkdownRenderer';
import { Button, Panel } from '@/design-system/primitives';
import { LEGAL_DOCS, LEGAL_INDEX_BLURB, type LegalDoc } from '@/content/legal';

/**
 * Settings → Legal & Policies.
 *
 * Read-only viewer for the CycleForge legal baseline (Terms of Service, Privacy
 * Policy, Data Processing Agreement). The documents are the SAME ones published
 * on the marketing site at cycleforge.com/legal; the markdown source lives in
 * src/content/legal/*.json. They are working drafts pending counsel review, so
 * we surface a persistent disclaimer banner above the body.
 */
export function LegalSection() {
  const [activeSlug, setActiveSlug] = useState<LegalDoc['slug']>(LEGAL_DOCS[0].slug);
  const active = useMemo(
    () => LEGAL_DOCS.find((d) => d.slug === activeSlug) ?? LEGAL_DOCS[0],
    [activeSlug],
  );

  function download(doc: LegalDoc) {
    const blob = new Blob([doc.md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cycleforge-${doc.slug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-bold text-text-default">Legal &amp; Policies</h2>
        <p className="text-sm text-text-muted">{LEGAL_INDEX_BLURB}</p>
      </header>

      {/* Draft disclaimer — these are pre-counsel working drafts. */}
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
          Draft — pending legal review
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-800">
          These documents reflect CycleForge’s actual architecture and data practices but have not
          yet been reviewed by a licensed attorney and are not legal advice. Bracketed placeholders
          (e.g. <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">[LEGAL ENTITY NAME]</code>)
          must be completed before publication.
        </p>
      </div>

      {/* Document switcher — Terms / Privacy / DPA. */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Legal documents">
        {LEGAL_DOCS.map((doc) => {
          const selected = doc.slug === activeSlug;
          return (
            <Button
              key={doc.slug}
              type="button"
              role="tab"
              aria-selected={selected}
              variant={selected ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setActiveSlug(doc.slug)}
              className="px-3 py-1.5 text-xs"
            >
              {doc.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => download(active)}
          className="ml-auto px-3 py-1.5 text-xs text-text-muted"
        >
          Download .md
        </Button>
      </div>

      <Panel padding="lg">
        <article className="legal-doc max-w-none">
          <MarkdownRenderer content={active.md} />
        </article>
      </Panel>
    </div>
  );
}
