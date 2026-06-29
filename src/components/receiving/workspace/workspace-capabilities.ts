/**
 * Receiving workspace capabilities — the single source of truth for "what does
 * this receiving workspace mode show". The right pane (`LineEditPanel`) is shared
 * across modes; each mode passes a `variant` and the editor reads `caps.X` to
 * gate the mode-specific sections, instead of scattering `mode === 'triage'`
 * checks through the JSX.
 *
 * `triage` (the "Receiving" identify-before-unbox step) is a fast priority
 * pass: the carton top bar (classify pills, PO#/tracking/listing chips, photos
 * + claim), a read-only PO-items view, the Package-Pairing section (pair the
 * inbound/return package to a Zendesk claim ticket / repair service / Ecwid
 * order) and the operator notes card. Unbox-only actions — label preview,
 * print·receive, serial scan (serials are captured only at unbox) — stay hidden.
 *
 * `unbox` also shows the Package-Pairing section, but only for UNFOUND (unmatched)
 * cartons — an operator unboxing a no-PO box needs the same Zendesk/repair/Ecwid
 * pairing affordances as triage. Matched POs in unbox keep the plain PO-items
 * editor. `matching` (does this mode offer pairing) and `poItems` (does this mode
 * show the PO-items card) are independent so unbox can show BOTH.
 *
 * Adding a new mode/use-case = one row here; the editor never changes.
 */

export type ReceivingWorkspaceVariant = 'unbox' | 'triage';

export interface WorkspaceCapabilities {
  /** "+ click to add photos" dropzone (carton staff row). */
  photos: boolean;
  /** CLAIM button (carton staff row). */
  claim: boolean;
  /** Label preview card. */
  labelPreview: boolean;
  /** Sticky Print·receive action bar. */
  receiveBar: boolean;
  /** Serial-number entry (unmatched "scan a serial" card + matched active row). */
  serialScan: boolean;
  /**
   * PO-items accordion interactivity — expand chevron, "Click to switch", row
   * click, condition edit. Off in triage: you can't change a line until it's
   * unboxed, so the accordion is a flat read-only display.
   */
  editLines: boolean;
  /** Sticky "Save for unbox" bar (triage's terminal action — there is no receive). */
  saveBar: boolean;
  /** Standalone notes card. Off in triage — fast classification only, no prose. */
  notes: boolean;
  /**
   * Offer the unmatched-carton "open in unbox" jump. On in triage (identify →
   * hand to unbox); off in unbox (you're already there). Routing it through caps
   * keeps the cards free of any `variant === 'triage'` knowledge.
   */
  openInUnbox: boolean;
  /**
   * Package-Pairing section — pair the inbound (return) package to a real
   * Zendesk claim ticket / repair service / Ecwid order. On in triage (the
   * identify step) and in unbox for UNFOUND cartons (the no-PO unbox case).
   */
  matching: boolean;
  /**
   * PO-items card (`LinePoItemsSection`). On in unbox (where you edit lines /
   * add to an unmatched carton); off in triage, where the Package-Pairing hub
   * subsumes the carton actions. Independent of `matching` so unbox can show the
   * pairing section AND the PO-items card together for an unfound carton.
   */
  poItems: boolean;
}

export const WORKSPACE_CAPABILITIES: Record<ReceivingWorkspaceVariant, WorkspaceCapabilities> = {
  unbox: {
    photos: true, claim: true, labelPreview: true, receiveBar: true,
    serialScan: true, editLines: true, saveBar: false, notes: true,
    openInUnbox: false, matching: true, poItems: true,
  },
  triage: {
    photos: true, claim: true, labelPreview: false, receiveBar: false,
    serialScan: false, editLines: false, saveBar: true, notes: true,
    openInUnbox: true, matching: true, poItems: false,
  },
};

export function workspaceCapabilities(variant: ReceivingWorkspaceVariant): WorkspaceCapabilities {
  return WORKSPACE_CAPABILITIES[variant] ?? WORKSPACE_CAPABILITIES.unbox;
}
