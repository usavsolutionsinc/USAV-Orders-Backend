export type AiConfidence = 'high' | 'medium' | 'low';

export type AiChatMode = 'assistant' | 'hybrid' | 'local_ops' | 'rag';

export interface AiTimeframe {
  kind: 'today' | 'yesterday' | 'this_week' | 'last_week';
  label: string;
  exactLabel: string;
  start: string;
  end: string;
  timezone: 'America/Los_Angeles';
  explicit: boolean;
  weekOffset?: number;
}

export interface AiMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface AiBreakdownRow {
  id: string;
  label: string;
  value: number;
  detail?: string;
  href?: string;
}

export interface AiSampleRecord {
  id: string;
  primary: string;
  secondary?: string;
  href?: string;
}

export interface AiSourceReference {
  id: string;
  label: string;
  detail?: string;
}

export interface AiActionLink {
  label: string;
  href: string;
}

export interface AiStructuredAnswer {
  kind: 'shipping_summary' | 'notice' | 'repair_diagnostics';
  title: string;
  summary: string;
  confidence: AiConfidence;
  modeLabel: string;
  timeframe?: AiTimeframe;
  metrics?: AiMetric[];
  breakdownTitle?: string;
  breakdown?: AiBreakdownRow[];
  sampleTitle?: string;
  sampleRecords?: AiSampleRecord[];
  sources: AiSourceReference[];
  followUps?: string[];
  actions?: AiActionLink[];
}

export interface AiChatRouteResponse {
  reply: string;
  sessionId: string;
  mode?: AiChatMode;
  analysis?: AiStructuredAnswer | null;
}
