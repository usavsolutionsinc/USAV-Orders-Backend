export function dispatchDashboardAndStationRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
}

export function dispatchCloseShippedDetails(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('close-shipped-details'));
}
