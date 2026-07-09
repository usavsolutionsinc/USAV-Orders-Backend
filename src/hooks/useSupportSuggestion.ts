'use client';

import { useMutation } from '@tanstack/react-query';
import type { SuggestionConfidence } from '@/lib/support/suggest-reply';

export interface SupportSuggestionResult {
  suggestion: string;
  sources: string[];
  confidence: SuggestionConfidence;
  mode: 'local';
  model: string;
  grounded: boolean;
}

export interface SupportSuggestionVars {
  ticketId: number;
  subject?: string;
  question: string;
}

async function fetchSuggestion(vars: SupportSuggestionVars): Promise<SupportSuggestionResult> {
  const res = await fetch('/api/support/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vars),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Suggestion failed (${res.status})`);
  return data as SupportSuggestionResult;
}

/** Mutation that asks the local model for a draft support reply for a ticket. */
export function useSupportSuggestion() {
  return useMutation({ mutationFn: fetchSuggestion });
}
