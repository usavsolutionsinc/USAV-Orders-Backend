/**
 * Workspace mode registry — the single source of truth for "what is each mode".
 *
 * Three surfaces share the receiving/tech workspace cards but are distinct mode
 * DISPLAYS, not one panel with bits hidden:
 *   - `unbox`   (/receiving)            — scan → identify → serial → print · receive
 *   - `triage`  (/receiving?mode=triage)— fast classify pass → save for unbox
 *   - `testing` (/tech?view=testing)    — verdict pills → pass · print
 *
 * Per-mode CARD VISIBILITY for the shared unbox/triage body lives in
 * `workspace-capabilities.ts` (the `caps` matrix). This registry owns the
 * cross-mode chrome config the unified pane header needs — which toolbar
 * actions a mode shows and which rail/table navigation channel its prev/next
 * drives — so the header is one primitive configured by data, not a bespoke
 * toolbar per mode. Adding a mode = one row here.
 */

export type WorkspaceMode = 'unbox' | 'triage' | 'testing';

/** Pane-header action buttons. The header renders the subset each mode lists. */
export type HeaderActionKey =
  | 'refresh' // re-sync this line from Zoho by tracking number
  | 'share' // copy/native-share a deep link to this package
  | 'phone' // push a "take photos" sheet to the paired phone
  | 'audit' // open the inventory-events audit modal
  | 'copy' // copy package + PO details to the clipboard
  | 'pair' // open the cross-platform SKU pairing modal (testing only)
  | 'details'; // right-slot Info → receiving-details overlay

/**
 * Custom-event name a mode's prev/next chevrons dispatch. Receiving navigates
 * the table/rail; testing navigates the tech rail (different feed, different
 * event) — so the shared header reads this instead of hard-coding the channel.
 */
export type NavChannel = 'receiving-navigate-table' | 'testing-navigate-rail';

export interface ModeDef {
  /** Human label (rail header / a11y). */
  label: string;
  /** Toolbar actions shown in the pane header, left → right. */
  headerActions: HeaderActionKey[];
  /** Right-slot Info button → receiving-details overlay (receiving modes only). */
  showDetails: boolean;
  /** Which navigation event prev/next dispatches for this mode. */
  navChannel: NavChannel;
}

export const WORKSPACE_MODES: Record<WorkspaceMode, ModeDef> = {
  unbox: {
    label: 'Unbox',
    headerActions: ['refresh', 'share', 'audit', 'copy', 'phone'],
    showDetails: true,
    navChannel: 'receiving-navigate-table',
  },
  triage: {
    label: 'Receiving',
    headerActions: ['refresh', 'share', 'audit', 'copy', 'phone'],
    showDetails: true,
    navChannel: 'receiving-navigate-table',
  },
  testing: {
    label: 'Testing',
    headerActions: ['audit', 'pair', 'copy'],
    showDetails: false,
    navChannel: 'testing-navigate-rail',
  },
};

export function workspaceMode(mode: WorkspaceMode): ModeDef {
  return WORKSPACE_MODES[mode] ?? WORKSPACE_MODES.unbox;
}
