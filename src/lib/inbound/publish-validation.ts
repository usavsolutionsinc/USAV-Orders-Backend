/**
 * Studio publish validation for Universal Incoming (plan §8.3, §9.6).
 *
 * When a tenant publishes a station whose blocks bind the inbound data sources,
 * this gate enforces:
 *   1. eBay-binding sources require the org's `incoming_universal` flag AND at
 *      least one connected, active buyer account (no dead eBay checklist);
 *   2. every source a block pins to a specific inbound source_type must be in the
 *      org's `enabledSources` policy (organizations.settings.inbound).
 *
 * Pure over the config + a small set of injected async facts (flag, buyer-account
 * presence, enabled sources) so it runs DB-free in tests. Called from
 * POST /api/stations/publish AFTER the registry-shape validation.
 */

import type { StationConfig } from '@/lib/stations/contract';

/**
 * The inbound data sources and how a binding to them implies an inbound
 * source_type. `ebayFixed` sources always bind eBay; `byInboundFilter` sources
 * bind whatever their `inbound` filter selects (default 'all' pins nothing).
 */
const EBAY_FIXED_SOURCES = new Set(['receiving.incoming_ebay', 'receiving.awaiting_zoho_link']);
const ZOHO_FIXED_SOURCES = new Set(['receiving.incoming_zoho']);
const BY_INBOUND_FILTER_SOURCES = new Set(['receiving.incoming_all', 'receiving.awaiting_tracking_pos']);

export interface BoundInbound {
  /** True when any bound block requires eBay purchasing (flag + buyer account). */
  needsEbay: boolean;
  /** Inbound source_types the config pins a block to (must be org-enabled). */
  pinnedSources: Set<string>;
}

/** Walk a station config and collect the inbound source_types it binds. */
export function collectBoundInboundSources(config: StationConfig): BoundInbound {
  const result: BoundInbound = { needsEbay: false, pinnedSources: new Set() };
  if (!config || config.slots === 'legacy' || typeof config.slots !== 'object') return result;

  for (const instances of Object.values(config.slots)) {
    for (const inst of instances ?? []) {
      const sourceId = inst.source?.id;
      if (!sourceId) continue;
      if (EBAY_FIXED_SOURCES.has(sourceId)) {
        result.needsEbay = true;
        result.pinnedSources.add('ebay');
      } else if (ZOHO_FIXED_SOURCES.has(sourceId)) {
        result.pinnedSources.add('zoho');
      } else if (BY_INBOUND_FILTER_SOURCES.has(sourceId)) {
        const inbound = String(inst.source?.filters?.inbound ?? 'all').toLowerCase();
        if (inbound === 'ebay') {
          result.needsEbay = true;
          result.pinnedSources.add('ebay');
        } else if (inbound !== 'all' && inbound !== '') {
          result.pinnedSources.add(inbound);
        }
      }
    }
  }
  return result;
}

export interface InboundPublishDeps {
  /** Is `incoming_universal` on for this org? */
  isFlagOn: () => Promise<boolean>;
  /** Does the org have ≥1 connected, active eBay buyer account? */
  hasConnectedBuyerAccount: () => Promise<boolean>;
  /** The org's enabled inbound source_types (organizations.settings.inbound). */
  getEnabledSources: () => Promise<string[]>;
}

/**
 * Returns a list of blocking issue strings (empty = OK). Short-circuits the DB
 * checks when the config binds no inbound source.
 */
export async function validateInboundPublish(
  config: StationConfig,
  deps: InboundPublishDeps,
): Promise<string[]> {
  const bound = collectBoundInboundSources(config);
  if (!bound.needsEbay && bound.pinnedSources.size === 0) return [];

  const issues: string[] = [];
  const enabled = new Set((await deps.getEnabledSources()).map((s) => s.toLowerCase()));

  for (const src of bound.pinnedSources) {
    if (!enabled.has(src)) {
      issues.push(`Inbound source "${src}" is not enabled for this organization (enable it in Settings → Inbound before publishing).`);
    }
  }

  if (bound.needsEbay) {
    if (!(await deps.isFlagOn())) {
      issues.push('eBay incoming sources require the Universal Incoming feature (incoming_universal) to be enabled for this organization.');
    }
    if (!(await deps.hasConnectedBuyerAccount())) {
      issues.push('eBay incoming sources require at least one connected eBay buyer account.');
    }
  }

  return issues;
}
