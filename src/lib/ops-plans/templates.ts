import type { OpsPlanStation } from './constants';

export interface PlanTemplatePhase {
  station: OpsPlanStation;
  title: string;
  tasks: string[];
}

export interface PlanTemplate {
  templateKey: string;
  title: string;
  description: string;
  phases: PlanTemplatePhase[];
}

export const PLAN_TEMPLATES: Record<string, PlanTemplate> = {
  inventory_accuracy_cycle_count: {
    templateKey: 'inventory_accuracy_cycle_count',
    title: 'Inventory accuracy recovery',
    description: 'Bin audit, variance reconciliation, and sign-off cycle for inventory accuracy.',
    phases: [
      {
        station: 'RECEIVING',
        title: 'Bin audit',
        tasks: ['Count aisle assignments', 'Relabel mis-slotted SKUs'],
      },
      {
        station: 'TECH',
        title: 'Variance reconciliation',
        tasks: ['Re-count flagged SKUs', 'Update bin locations'],
      },
      {
        station: 'ADMIN',
        title: 'Sign-off',
        tasks: ['Review variance report', 'Close cycle'],
      },
    ],
  },
};

export function getPlanTemplate(templateKey: string): PlanTemplate | null {
  return PLAN_TEMPLATES[templateKey] ?? null;
}

export function listPlanTemplateKeys(): string[] {
  return Object.keys(PLAN_TEMPLATES);
}
