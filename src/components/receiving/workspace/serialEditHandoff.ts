/**
 * Cross-remount handoff for "Edit serial from a non-active accordion row".
 *
 * Clicking Edit on a collapsed PO-item row ({@link PoLinesAccordion}) activates
 * that line via `dispatchSelectLine`. In the receiving flow the workspace
 * (`LineEditPanel`) REMOUNTS on the line switch — `ReceivingLineWorkspace` keys
 * its body by `row.id` — so a React-state "pending edit" would be wiped before
 * it could apply. This module-scoped store survives the remount: the accordion
 * stashes the target here, and the freshly-mounted (or re-rendered) workspace
 * consumes it for the now-active line.
 *
 * A single global is fine — only one receiving/testing workspace is open at a
 * time, and the handoff is consumed on the very next line activation.
 */
export interface PendingSerialEdit {
  id?: number;
  serial_number: string;
  condition_grade?: string | null;
}

let pending: { lineId: number; serial: PendingSerialEdit } | null = null;

/** Stash an edit target for `lineId`, to be consumed once that line is active. */
export function setSerialEditHandoff(lineId: number, serial: PendingSerialEdit): void {
  pending = { lineId, serial };
}

/** Return and clear the pending edit if it targets `lineId`; otherwise null. */
export function takeSerialEditHandoff(lineId: number): PendingSerialEdit | null {
  if (pending && pending.lineId === lineId) {
    const serial = pending.serial;
    pending = null;
    return serial;
  }
  return null;
}
