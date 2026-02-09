/**
 * Formats an ISO date string to M/D/YY format
 * @param dateString - ISO date string (e.g., "2026-02-09T08:00:00.000Z")
 * @returns Formatted date string (e.g., "2/9/26")
 */
export function formatShortDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  
  try {
    const date = new Date(dateString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    
    return `${month}/${day}/${year}`;
  } catch (error) {
    return 'Invalid Date';
  }
}
