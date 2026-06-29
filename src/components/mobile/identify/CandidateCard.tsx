'use client';

import { useState } from 'react';
import { Camera, Check, Loader2, AlertTriangle } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import type { LabelCandidate } from '@/lib/vision-identify';

export function CandidateCard({
  c, primary, adding, canAdd, onAdd, onCreateSku, onFlagMissing,
}: {
  c: LabelCandidate;
  primary: boolean;
  adding: boolean;
  canAdd: boolean;
  onAdd: (c: LabelCandidate) => void;
  onCreateSku: (c: LabelCandidate, sku: string) => void;
  onFlagMissing: (c: LabelCandidate) => void;
}) {
  const title = c.product_title ?? c.item_name ?? c.model;
  // OCR resolved to a real catalog product → the existing one-tap Add path.
  // OCR read a label that ISN'T in the system yet → one-step Create-SKU OR
  // Flag-missing (P2-AI-01). `expand` reveals the inline SKU field for create.
  const [expand, setExpand] = useState(false);
  const [skuInput, setSkuInput] = useState(c.sku ?? '');
  const unresolved = !c.resolved;

  return (
    <div className={`rounded-2xl p-3 ${primary ? 'bg-white/[0.06] ring-1 ring-emerald-500/40' : 'bg-white/[0.03]'}`}>
      <div className="flex items-center gap-3">
        {c.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-white/40">
            <Camera className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
            {c.sku ? <span className="tabular-nums">SKU {c.sku}</span> : <span>no SKU</span>}
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-micro font-semibold text-emerald-300">
              <Check className="h-3 w-3" /> label match
            </span>
            {unresolved && <span className="text-amber-300/80">· not in system</span>}
          </div>
        </div>
        {!unresolved && (
          // ds-raw-button: solid-emerald CTA when primary (emerald-500/text-black) — no green Button variant; conditional fill override unreliable vs variant bg
          <button
            disabled={!canAdd || adding}
            onClick={() => onAdd(c)}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold ${
              primary ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white'
            } disabled:opacity-40`}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </button>
        )}
      </div>

      {/* Not-in-system → one-step: create a SKU, or flag it missing. */}
      {unresolved && (
        <div className="mt-3 space-y-2">
          {!expand ? (
            <div className="flex gap-2">
              {/* ds-raw-button: solid-emerald CTA (emerald-500/text-black) — no green Button variant */}
              <button
                disabled={adding}
                onClick={() => setExpand(true)}
                className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
              >
                {adding ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Create SKU'}
              </button>
              <Button
                variant="ghost"
                disabled={adding}
                onClick={() => onFlagMissing(c)}
                icon={<AlertTriangle />}
                className="bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
              >
                Flag missing
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                inputMode="text"
                autoFocus
                placeholder="New SKU (e.g. AWRCC1)"
                className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              <div className="flex gap-2">
                {/* ds-raw-button: solid-emerald CTA (emerald-500/text-black) — no green Button variant */}
                <button
                  disabled={adding || !skuInput.trim()}
                  onClick={() => onCreateSku(c, skuInput)}
                  className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
                >
                  {adding ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : canAdd ? 'Create + Add' : 'Create SKU'}
                </button>
                <Button
                  variant="ghost"
                  disabled={adding}
                  onClick={() => setExpand(false)}
                  className="bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
