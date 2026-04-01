import { baseColors } from './base';

export const semanticColors = {
  text: {
    primary: baseColors.gray[900],
    secondary: baseColors.gray[700],
    muted: baseColors.gray[500],
    inverse: baseColors.white,
    accent: baseColors.navy[700],
    success: baseColors.green[600],
    warning: baseColors.orange[600],
    danger: baseColors.red[600],
    label: baseColors.gray[500],
    value: baseColors.gray[900],
    technical: baseColors.gray[900],
  },
  background: {
    canvas: baseColors.gray[50],
    surface: baseColors.white,
    subtle: baseColors.gray[100],
    inverse: baseColors.navy[900],
    accent: baseColors.navy[700],
    success: baseColors.green[500],
    warning: baseColors.orange[500],
    danger: baseColors.red[500],
  },
  surface: {
    background: baseColors.gray[50],
    containerLowest: baseColors.white,
    containerLow: baseColors.gray[50],
    container: baseColors.gray[100],
    containerHigh: baseColors.gray[200],
    containerHighest: baseColors.gray[300],
    dim: 'rgba(2, 6, 23, 0.04)',
  },
  border: {
    subtle: baseColors.gray[200],
    strong: baseColors.gray[300],
    accent: baseColors.navy[600],
    success: baseColors.green[400],
    warning: baseColors.orange[400],
    danger: baseColors.red[400],
    ghost: 'rgba(100, 116, 139, 0.10)',
  },
  outline: {
    variant: 'rgba(100, 116, 139, 0.20)',
    ghost: 'rgba(100, 116, 139, 0.10)',
    highContrast: baseColors.gray[900],
  },
  functional: {
    repair: baseColors.orange[500],
    inventoryAlert: baseColors.red[500],
    identifier: '#6B7280',
    logistics: baseColors.blue[500],
    successInbound: baseColors.green[500],
    fulfillment: baseColors.purple[500],
    queued: baseColors.yellow[400],
  },
  status: {
    active: baseColors.green[600],
    inactive: '#6B7280',
    confirmed: baseColors.blue[600],
    shipped: baseColors.purple[600],
    delivered: baseColors.green[600],
    invoiced: '#0891B2',
    paid: baseColors.green[600],
    overdue: baseColors.red[600],
    void: '#6B7280',
    draft: '#D97706',
    outOfStock: baseColors.red[600],
    lowStock: '#F59E0B',
  },
  gradient: {
    primary: baseColors.navy[700],
    primaryDim: baseColors.navy[600],
  },
  overlay: {
    scrim: 'rgba(2, 6, 23, 0.38)',
    glass: 'rgba(255, 255, 255, 0.85)',
  },
  tonalNesting: {
    recessed: baseColors.gray[200],
    neutral: baseColors.gray[100],
    lifted: baseColors.white,
  },
  dashboard: {
    all: {
      primary: baseColors.blue[600],
      pastel: '#E6F0FF', // Very light blue
      accent: baseColors.blue[700],
    },
    tested: {
      primary: baseColors.green[600],
      pastel: '#E6F6EB', // Very light green
      accent: baseColors.green[700],
    },
    repair: {
      primary: baseColors.orange[500],
      pastel: '#FFF4E6', // Very light orange
      accent: baseColors.orange[600],
    },
    outOfStock: {
      primary: baseColors.red[500],
      pastel: '#FEE2E2', // Very light red
      accent: baseColors.red[600],
    },
    fba: {
      primary: baseColors.purple[500],
      pastel: '#F3E8FF', // Very light purple
      accent: baseColors.purple[600],
    },
    pendingLate: {
      primary: baseColors.yellow[500],
      pastel: '#FEF9C3', // Very light yellow
      accent: baseColors.yellow[600],
    },
  },
} as const;

export type SemanticColors = typeof semanticColors;
