/**
 * Cross-remount handoff for "Open item description from a non-active accordion row".
 *
 * Clicking the product title on a collapsed PO-item row activates that line via
 * `dispatchSelectLine`. In the receiving flow the workspace remounts on the line
 * switch (`ReceivingLineWorkspace` keys its body by `row.id`), so React state for
 * `descShown` would be wiped before it could apply. This module-scoped flag
 * survives the remount: the accordion stashes the target here, and the freshly
 * mounted accordion consumes it for the now-active line.
 */

let pendingLineId: number | null = null;

/** Stash a request to open the Zoho item-description editor for `lineId`. */
export function setItemDescHandoff(lineId: number): void {
  pendingLineId = lineId;
}

/** Return true and clear if a handoff targets `lineId`; otherwise false. */
export function takeItemDescHandoff(lineId: number): boolean {
  if (pendingLineId === lineId) {
    pendingLineId = null;
    return true;
  }
  return false;
}
