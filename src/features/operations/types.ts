export type DashboardCategory = 'all' | 'tested' | 'repair' | 'outOfStock' | 'pendingLate' | 'fba';

export interface DashboardData {
  summary: Record<DashboardCategory, { value: number; delta: number }>;
  staffProgress: {
    staffId: number;
    name: string;
    goal: number;
    current: number;
    percent: number;
    status: 'on_track' | 'at_risk' | 'behind';
    daysLate: number;
    station: string;
  }[];
  activityFeed: {
    id: string;
    timestamp: string;
    type: string;
    source: string;
    summary: string;
    staff_id?: number;
    actor_name?: string;
  }[];
}
