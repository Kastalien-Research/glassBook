import type { Budgets } from '../types.mjs';

/**
 * A NotebookTemplate defines the section order, default per-section cell
 * budgets, and the notebook title. v0 ships a single template: codebase-update.
 */
export interface NotebookTemplate {
  readonly id: string;
  readonly title: (prompt: string) => string;
  readonly defaultBudgets: () => Budgets;
}

export const codebaseUpdateTemplate: NotebookTemplate = {
  id: 'codebase-update',
  title: (prompt) => {
    const trimmed = prompt.trim().replace(/\s+/g, ' ');
    return `glassBook: ${trimmed.length > 50 ? trimmed.slice(0, 50) + '…' : trimmed}`;
  },
  defaultBudgets: () => ({
    loadPackages: { limit: 1, used: 0 },
    initialize: { limit: 1, used: 0 },
    research: { limit: 4, used: 0 },
    workPlan: { limit: 1, used: 0 },
    // workExecution budget is interpreted by Ulysses as the max number of turns.
    workExecution: { limit: 6, used: 0 },
    evaluation: { limit: 2, used: 0 },
  }),
};

export const templates: Record<string, NotebookTemplate> = {
  [codebaseUpdateTemplate.id]: codebaseUpdateTemplate,
};

export function getTemplate(id: string): NotebookTemplate | undefined {
  return templates[id];
}
