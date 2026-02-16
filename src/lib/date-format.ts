import { toPSTDateKey } from './timezone';

export function formatDateWithOrdinal(dateStr: string): string {
  try {
    if (!dateStr) return 'Unknown';

    const getOrdinal = (n: number) => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    let date: Date;
    const pstDateKey = toPSTDateKey(dateStr);
    if (pstDateKey) {
      const [year, month, day] = pstDateKey.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else {
      date = new Date(dateStr);
    }

    if (isNaN(date.getTime())) return dateStr;

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const dayNum = date.getDate();

    return `${dayName}, ${monthName} ${getOrdinal(dayNum)}`;
  } catch {
    return dateStr;
  }
}
