/**
 * Receiving workspace capabilities — the single source of truth for "what does
 * this receiving workspace mode show". The right pane (`LineEditPanel`) is shared
 * across modes; each mode passes a `variant` and the editor reads `caps.X` to
 * gate the mode-specific sections, instead of scattering `mode === 'triage'`
 * checks through the JSX.
 *
 * `triage` (the "Receiving" identify-before-unbox step) hides the unbox-only
 * actions — photos, claim, label preview, print·receive, and serial scan
 * (serials are captured only at unbox). Everything else (carton context,
 * classify pills, add-item, PO# link, notes) stays on in every mode.
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
}

export const WORKSPACE_CAPABILITIES: Record<ReceivingWorkspaceVariant, WorkspaceCapabilities> = {
  unbox: {
    photos: true, claim: true, labelPreview: true, receiveBar: true,
    serialScan: true, editLines: true, saveBar: false,
  },
  triage: {
    photos: false, claim: false, labelPreview: false, receiveBar: false,
    serialScan: false, editLines: false, saveBar: true,
  },
};

export function workspaceCapabilities(variant: ReceivingWorkspaceVariant): WorkspaceCapabilities {
  return WORKSPACE_CAPABILITIES[variant] ?? WORKSPACE_CAPABILITIES.unbox;
}
