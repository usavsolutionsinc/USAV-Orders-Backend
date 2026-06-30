/**
 * Receiving scan resolution pipeline — public surface.
 *
 * Pure, dependency-injected resolver rungs + their shared types. The React hook
 * (`useTrackingScan`) composes these and owns the side-effects; nothing here
 * touches React or the network directly. See {@link ./types} for the contract.
 */

export * from './types';
export { normalizeScanKey } from './normalize';
export { resolveInternalCode } from './resolvers/internal-code';
export { resolveCachedCarton } from './resolvers/cached-carton';
export { resolveLocalTracking } from './resolvers/local-tracking';
export { resolveViaLookupPo } from './resolvers/lookup-po';
