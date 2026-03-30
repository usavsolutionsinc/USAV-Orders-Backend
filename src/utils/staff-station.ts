export type StationType = 'TECH' | 'PACK' | 'UNBOX' | 'SALES';

const PREFIXES: StationType[] = ['TECH', 'PACK', 'UNBOX', 'SALES'];

/** Derive station type from employeeId prefix (e.g. 'TECH001' → 'TECH'). */
export function getStationFromEmployeeId(employeeId: string | null | undefined): StationType {
  if (!employeeId) return 'TECH';
  const upper = employeeId.toUpperCase();
  return PREFIXES.find((p) => upper.startsWith(p)) ?? 'TECH';
}
