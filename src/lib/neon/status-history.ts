export interface StatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string;
}

/**
 * Append a new status to the status history
 */
export function appendStatusHistory(
  currentHistory: string | null,
  newStatus: string,
  previousStatus?: string
): string {
  const history = parseStatusHistory(currentHistory);
  
  // Only append if status actually changed
  if (history.length > 0 && history[history.length - 1].status === newStatus) {
    return JSON.stringify(history);
  }
  
  history.push({
    status: newStatus,
    timestamp: new Date().toISOString(),
    previous_status: previousStatus,
  });
  
  return JSON.stringify(history);
}

/**
 * Parse status history from JSON string
 */
export function parseStatusHistory(
  historyString: string | null
): StatusHistoryEntry[] {
  if (!historyString || historyString === '') return [];
  try {
    return JSON.parse(historyString);
  } catch {
    return [];
  }
}

/**
 * Get the timestamp of the last status change to a specific status
 */
export function getLastStatusChange(
  historyString: string | null,
  targetStatus: string
): string | null {
  const history = parseStatusHistory(historyString);
  const entry = history.find(h => h.status === targetStatus);
  return entry?.timestamp || null;
}

/**
 * Format ISO timestamp to readable format
 */
export function formatStatusTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get all status changes in chronological order
 */
export function getStatusHistoryTimeline(
  historyString: string | null
): StatusHistoryEntry[] {
  return parseStatusHistory(historyString).reverse(); // Most recent first
}
