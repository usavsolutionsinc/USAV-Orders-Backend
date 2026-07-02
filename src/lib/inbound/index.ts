/**
 * Universal Incoming — polymorphic purchase-identity barrel.
 *
 * source-registry (pure discriminator SoT) + the three org-scoped, Deps-injected
 * writers over the polymorphic inbound tables (links / mirror / equivalence).
 * See docs/incoming-universal-purchase-orders-plan.md §3.
 */
export * from './source-registry';
export * from './purchase-links';
export * from './mirror';
export * from './equivalence';
export * from './ingest-purchase';
export * from './merge-purchase-lines';
export * from './sync-ebay-purchases';
