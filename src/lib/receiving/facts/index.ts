/**
 * Receiving typed-facts — barrel.
 * Registry (pure, code-validated discriminator) + store (org-scoped DB helpers).
 * See docs/todo/polymorphic-tables-database-refactor-plan.md §4/§5.
 */
export * from './registry';
export * from './store';
export * from './narrow';
