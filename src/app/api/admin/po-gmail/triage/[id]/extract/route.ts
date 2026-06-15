/**
 * POST /api/admin/po-gmail/triage/[id]/extract
 *
 * Run the LLM extractor (Claude Haiku 4.5) on this email's body and
 * merge the results into triage_state.fields. Per field we store
 * { value, source: 'llm', confidence, extracted_at } — *unconfirmed*.
 * The checklist UI requires explicit human confirmation before any
 * AI-extracted value is considered actionable.
 *
 * This endpoint is intentionally idempotent at the schema level: re-
 * running clobbers prior LLM extractions but preserves any field that
 * the user has already confirmed (source='user'). Triggered manually by
 * the "Extract with AI" button.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { ApiError, errorResponse } from '@/lib/api';
import { fetchMessage } from '@/lib/po-gmail/messages';
import { extractWithLlm, type LlmFieldResult } from '@/lib/po-gmail/extract-llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface TriageRowMinimal {
  id: string;
  gmail_msg_id: string;
  email_subject: string | null;
  email_from: string | null;
  po_numbers: string[];
  triage_state: Record<string, unknown>;
}

type FieldSource = 'regex_labeled' | 'regex_unlabeled' | 'mirror' | 'llm' | 'user';

interface StoredField {
  value: string;
  source: FieldSource;
  confidence?: 'high' | 'medium' | 'low';
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  extracted_at?: string;
}

const LLM_FIELD_KEYS = ['vendor', 'po_date', 'total', 'currency', 'line_items_count', 'ship_to'] as const;
type LlmFieldKey = (typeof LLM_FIELD_KEYS)[number];

// Piles the model may suggest — excludes `done`, which is a Zoho-mirror
// terminal state, not something to infer from an email body.
const SUGGESTABLE_PILES = new Set(['upload', 'ignore', 'inbox']);

function existingField(state: Record<string, unknown>, key: string): StoredField | null {
  const fields = state?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const f = (fields as Record<string, unknown>)[key];
  if (!f || typeof f !== 'object') return null;
  return f as StoredField;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'admin.view');
  if (gate.denied) return gate.denied;
  const { organizationId } = gate.ctx;

  try {
    const { id } = await params;
    if (!id) throw ApiError.badRequest('id is required');

    const { rows } = await pool.query<TriageRowMinimal>(
      `SELECT id, gmail_msg_id, email_subject, email_from, po_numbers, triage_state
         FROM email_missing_purchase_orders
        WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw ApiError.notFound('email_missing_purchase_orders', id);
    const row = rows[0];
    if (!row.gmail_msg_id) throw ApiError.badRequest('row has no gmail_msg_id');

    const envelope = await fetchMessage(row.gmail_msg_id, organizationId);
    const llm = await extractWithLlm({
      subject: row.email_subject ?? envelope.subject,
      from: row.email_from ?? envelope.from,
      bodyText: envelope.bodyText,
      knownPoNumbers: row.po_numbers,
    });

    // Merge LLM results into triage_state.fields. Skip any field the human
    // has already confirmed — confirmation is sticky.
    const now = new Date().toISOString();
    const nextFields: Record<string, StoredField> = {};

    for (const key of LLM_FIELD_KEYS) {
      const llmResult = llm.fields[key] as LlmFieldResult | undefined;
      if (!llmResult) continue;
      const prior = existingField(row.triage_state, key);
      if (prior?.source === 'user' && prior.confirmed_at) {
        // Keep the human-confirmed value untouched.
        continue;
      }
      nextFields[key] = {
        value: String(llmResult.value),
        source: 'llm',
        confidence: llmResult.confidence,
        confirmed_at: null,
        confirmed_by: null,
        extracted_at: now,
      };
    }

    // Pile suggestion is advisory routing, not a PO field — store it under a
    // sibling `suggested_pile` key (never the `pile` column). The UI surfaces
    // it as a one-click confirm; the agent never moves the email itself.
    // Re-running refreshes it freely (no sticky human state to protect).
    const pileResult = llm.fields.triage_pile;
    const suggestedPile =
      pileResult && SUGGESTABLE_PILES.has(pileResult.value)
        ? {
            value: pileResult.value,
            confidence: pileResult.confidence,
            source: 'llm' as const,
            extracted_at: now,
          }
        : null;

    // Persist via JSONB deep-merge (`||`) on `fields`, plus a whole-value
    // replace of `suggested_pile` when present. Sibling top-level keys
    // (notes, etc.) are left untouched.
    const fieldsPatch = JSON.stringify(nextFields);
    const setExpr = suggestedPile
      ? `jsonb_set(
             jsonb_set(
               triage_state, '{fields}',
               COALESCE(triage_state->'fields', '{}'::jsonb) || ($2::jsonb), true
             ),
             '{suggested_pile}', ($3::jsonb), true
           )`
      : `jsonb_set(
             triage_state, '{fields}',
             COALESCE(triage_state->'fields', '{}'::jsonb) || ($2::jsonb), true
           )`;
    const sqlParams: unknown[] = suggestedPile
      ? [id, fieldsPatch, JSON.stringify(suggestedPile)]
      : [id, fieldsPatch];

    const { rows: updated } = await pool.query(
      `UPDATE email_missing_purchase_orders
          SET triage_state = ${setExpr}
        WHERE id = $1
        RETURNING id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
                  email_subject, email_from, email_received, scanned_at,
                  pile, status, notes, assigned_to,
                  zoho_uploaded_po_number, zoho_uploaded_at,
                  triage_state, resolved_at`,
      sqlParams,
    );

    return NextResponse.json({
      ok: true,
      row: updated[0],
      extracted: nextFields,
      suggested_pile: suggestedPile,
      usage: llm.usage,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/po-gmail/triage/[id]/extract');
  }
}
