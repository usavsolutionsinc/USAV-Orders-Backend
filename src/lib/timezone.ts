/**
 * Timezone utilities for PST/PDT (America/Los_Angeles)
 */

/**
 * Get current timestamp in PST/PDT timezone
 * @returns Date object representing current time in PST/PDT
 */
export function getCurrentPSTTime(): Date {
  // Create date in PST timezone
  const pstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return pstDate;
}

/**
 * Format a date as MM/DD/YYYY HH:mm:ss in PST timezone
 * @param date Optional date to format (defaults to current PST time)
 * @returns Formatted date string in PST
 */
export function formatPSTTimestamp(date?: Date): string {
  const pstDate = date || getCurrentPSTTime();
  
  // Ensure the date is interpreted in PST
  const pstString = pstDate.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse the localized string to get individual components
  const [datePart, timePart] = pstString.split(', ');
  const [month, day, year] = datePart.split('/');
  
  return `${month}/${day}/${year} ${timePart}`;
}

/**
 * Convert a timestamp string to ISO format in PST timezone
 * @param timestamp Timestamp string in MM/DD/YYYY HH:mm:ss format
 * @returns ISO string in PST timezone
 */
export function toISOStringPST(timestamp: string): string {
  try {
    if (timestamp && timestamp.includes('/')) {
      const [datePart, timePart] = timestamp.split(' ');
      const [m, d, y] = datePart.split('/');
      
      // Create date as PST by using toLocaleString with timezone
      const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`);
      
      // Convert to PST ISO string
      return date.toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6');
    }
    return timestamp;
  } catch (e) {
    console.error('Error converting timestamp to ISO PST:', e);
    return timestamp;
  }
}
