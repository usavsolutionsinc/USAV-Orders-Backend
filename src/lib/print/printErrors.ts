/**
 * Turn a raw WebUSB / Web Serial failure reason into an actionable message.
 * Shared by the Settings → Hardware test buttons and the live print paths so
 * an operator sees WHY a silent print fell back to the dialog.
 *
 * The most common cause is a printer the OS driver already owns
 * (USB "Access denied" / can't claim the interface, or the serial port in use).
 */
export function friendlyPrintError(reason: string | null | undefined): string {
  const r = (reason || '').toLowerCase();
  if (
    r.includes('access denied') ||
    r.includes('claiminterface') ||
    r.includes('unable to claim') ||
    r.includes('the device is in use')
  ) {
    return 'This USB printer is held by the OS driver, so the browser can’t send to it directly. Pair it as a serial port instead, or remove the driver to use WebUSB.';
  }
  if (r.includes('failed to open') && r.includes('serial')) {
    return 'Couldn’t open the serial port — it’s likely in use by the matching printer. Remove the conflicting printer/driver, then retry.';
  }
  if (
    r.includes('not connected') ||
    r.includes('not available') ||
    r.includes('re-pair') ||
    r.includes('no device')
  ) {
    return 'Printer not reachable — check it’s powered on and connected, then re-pair it in Settings.';
  }
  if (r.includes('bulk out')) {
    return 'This device doesn’t expose a printer endpoint the browser can use. Pair it as a serial (COM) port instead.';
  }
  return reason || 'Print failed.';
}
