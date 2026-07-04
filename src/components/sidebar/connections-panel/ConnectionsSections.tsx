import Link from 'next/link';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { sectionLabel, dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';
import { SidebarSection, LineItem, ActionButton } from './connections-panel-pieces';
import type { ConnectionsPanelController } from './useConnectionsPanel';

export function OrdersSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Orders" expanded={c.showOrders} onToggle={() => c.setShowOrders((v) => !v)}>
      <LineItem label="Run Full Order Sync" detail="Run eBay sync, Ecwid exception sync, then clear resolved exceptions" right={<ActionButton onClick={() => c.fullIntegrityMutation.mutate()} loading={c.fullIntegrityMutation.isPending} title="Run full order sync" tone="green" />} />
      <LineItem label="Sync eBay Orders" detail="Pull eBay changes and reconcile order exceptions" right={<ActionButton onClick={() => c.ebaySyncMutation.mutate()} loading={c.ebaySyncMutation.isPending} title="Sync eBay orders" tone="blue" />} />
      <LineItem label="Sync Ecwid Exceptions" detail="Copy tracking updates onto open Ecwid exceptions" right={<ActionButton onClick={() => c.ecwidExceptionTrackingMutation.mutate()} loading={c.ecwidExceptionTrackingMutation.isPending} title="Sync Ecwid exceptions" tone="blue" />} />
      <LineItem label="Clear Resolved Exceptions" detail="Remove exception rows that no longer need attention" right={<ActionButton onClick={() => c.exceptionsSyncMutation.mutate()} loading={c.exceptionsSyncMutation.isPending} title="Clear resolved exceptions" tone="green" />} />
      <LineItem label="Upload ShipStation CSV" detail="Import a local ShipStation export" right={/* ds-raw-button: flush w-12 h-full cell action mirroring ActionButton geometry — not a Button shape */<button type="button" onClick={() => c.shipStationFileInputRef.current?.click()} className={`ds-raw-button h-full w-12 border-l border-border-soft ${sectionLabel} text-text-muted hover:bg-surface-sunken`}>Up</button>} />
      {c.tokenAccounts.map((account) => {
        const minutesLeft = Math.floor((new Date(account.token_expires_at).getTime() - c.now.getTime()) / 60000);
        const isRefreshing = c.refreshTokenMutation.isPending && c.refreshTokenMutation.variables === account.account_name;
        return (
          <LineItem
            key={account.id}
            label={account.account_name}
            detail={minutesLeft <= 0 ? 'Token expired' : `Token expires in ${minutesLeft} min`}
            right={<ActionButton onClick={() => c.refreshTokenMutation.mutate(account.account_name)} loading={isRefreshing} title={`Refresh ${account.account_name}`} />}
          />
        );
      })}
    </SidebarSection>
  );
}

export function ZohoSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Zoho" expanded={c.showZoho} onToggle={() => c.setShowZoho((v) => !v)}>
      <div className="border-b border-border-soft bg-surface-card px-4 py-3">
        <Link
          href="/admin?section=connections&page=zoho-management"
          className={`inline-flex border-b border-border-strong py-1 ${sectionLabel} text-text-default`}
        >
          Open Zoho Tools
        </Link>
      </div>
      <LineItem label="Refresh Token" detail="Refresh the Zoho auth token before syncing" right={<ActionButton onClick={() => c.zohoRefreshMutation.mutate()} loading={c.zohoRefreshMutation.isPending} title="Refresh Zoho token" />} />
      <LineItem label="Sync Expected POs" detail="Load expected inbound lines before receiving starts" right={<ActionButton onClick={() => c.zohoSyncMutation.mutate()} loading={c.zohoSyncMutation.isPending} title="Sync Zoho purchase orders" tone="green" />} />
      <div className="border-b border-border-soft bg-surface-card px-4 py-3">
        <p className={dataValue}>Import One Purchase Receive</p>
        <div className="mt-2 flex items-stretch gap-0 border border-border-soft">
          <input
            value={c.purchaseReceiveId}
            onChange={(e) => c.setPurchaseReceiveId(e.target.value)}
            placeholder="Paste purchase receive ID"
            className={`flex-1 bg-surface-canvas px-2 py-2 ${sectionLabel} text-text-default outline-none`}
          />
          {/* ds-raw-button: flush w-12 input-adjoined cell action (no rounding, border-l seam) — not a Button shape */}
          <button
            type="button"
            onClick={() => c.zohoImportOneMutation.mutate(c.purchaseReceiveId.trim())}
            disabled={!c.purchaseReceiveId.trim() || c.zohoImportOneMutation.isPending}
            className={`ds-raw-button w-12 border-l border-blue-300 bg-blue-50 ${sectionLabel} text-blue-700 disabled:opacity-50`}
          >
            {c.zohoImportOneMutation.isPending ? '...' : 'Run'}
          </button>
        </div>
      </div>
    </SidebarSection>
  );
}

export function BackfillSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Backfill" expanded={c.showBackfill} onToggle={() => c.setShowBackfill((v) => !v)}>
      <LineItem label="Backfill eBay Orders" detail="Fill only missing order fields from eBay" right={<ActionButton onClick={() => c.ebayBackfillMutation.mutate()} loading={c.ebayBackfillMutation.isPending} title="Backfill eBay orders" tone="indigo" />} />
      <LineItem label="Backfill Ecwid Orders" detail="Fill only missing order fields from Ecwid" right={<ActionButton onClick={() => c.ecwidBackfillMutation.mutate()} loading={c.ecwidBackfillMutation.isPending} title="Backfill Ecwid orders" tone="indigo" />} />
    </SidebarSection>
  );
}

export function CatalogSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Catalog" expanded={c.showCatalog} onToggle={() => c.setShowCatalog((v) => !v)}>
      <LineItem label="Preview Ecwid to Square Sync" detail="See what the enabled product sync would change" right={<ActionButton onClick={() => c.ecwidSquareSyncMutation.mutate({ dryRun: true })} loading={c.ecwidSquareSyncMutation.isPending && c.ecwidSquareSyncMutation.variables?.dryRun === true} title="Preview Ecwid to Square sync" />} />
      <LineItem label="Run Ecwid to Square Sync" detail="Push enabled Ecwid products into Square" right={<ActionButton onClick={() => c.ecwidSquareSyncMutation.mutate({ dryRun: false })} loading={c.ecwidSquareSyncMutation.isPending && c.ecwidSquareSyncMutation.variables?.dryRun === false} title="Run Ecwid to Square sync" tone="blue" />} />
    </SidebarSection>
  );
}

export function ShippingSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Shipping Tracking" expanded={c.showShipping} onToggle={() => c.setShowShipping((v) => !v)}>
      {(['USPS', 'UPS', 'FEDEX'] as const).map((carrier) => {
        const isSyncing = c.carrierSyncMutation.isPending && c.carrierSyncMutation.variables === carrier;
        return (
          <LineItem
            key={carrier}
            label={carrier}
            detail="Run due tracking updates for this carrier"
            right={<ActionButton onClick={() => c.carrierSyncMutation.mutate(carrier)} loading={isSyncing} title={`Sync ${carrier}`} tone="blue" />}
          />
        );
      })}
    </SidebarSection>
  );
}

export function AmazonSection({ c }: { c: ConnectionsPanelController }) {
  return (
    <SidebarSection title="Amazon" expanded={c.showAmazon} onToggle={() => c.setShowAmazon((v) => !v)}>
      <LineItem
        label="Connect via OAuth"
        detail="Authorize Amazon for this organization (multi-tenant)"
        right={
          <HoverTooltip label="Connect Amazon via OAuth" asChild>
            {/* ds-raw-button: navigation <a> (href), flush w-12 cell — not a Button (renders <button>) */}
            <a
              href="/api/amazon/oauth/start"
              className={`ds-raw-button inline-flex h-full w-12 items-center justify-center border-l border-indigo-300 bg-indigo-50 ${sectionLabel} text-indigo-700 hover:bg-indigo-100`}
              aria-label="Connect Amazon via OAuth"
            >
              Go
            </a>
          </HoverTooltip>
        }
      />
      <LineItem
        label="Check Connection"
        detail="Verify stored Amazon credentials reach SP-API"
        right={<ActionButton onClick={() => c.amazonHealthMutation.mutate()} loading={c.amazonHealthMutation.isPending} title="Check Amazon connection" tone="green" />}
      />
      <LineItem
        label="Sync Orders"
        detail="Import tracked Amazon orders (by SKU / FBA item)"
        right={<ActionButton onClick={() => c.amazonSyncMutation.mutate(false)} loading={c.amazonSyncMutation.isPending && c.amazonSyncMutation.variables === false} title="Sync Amazon orders" tone="blue" />}
      />
      <LineItem
        label="Sync All Orders"
        detail="Import every order, including untracked SKUs"
        right={<ActionButton onClick={() => c.amazonSyncMutation.mutate(true)} loading={c.amazonSyncMutation.isPending && c.amazonSyncMutation.variables === true} title="Sync all Amazon orders" tone="indigo" />}
      />
      <div className="border-b border-border-soft bg-surface-card px-4 py-3">
        <p className={dataValue}>Connect with Refresh Token</p>
        <p className={`mt-0.5 ${fieldLabel} text-text-soft`}>Self-authorized private app (bootstrap)</p>
        <div className="mt-2 space-y-2">
          <input
            value={c.amazonRefreshToken}
            onChange={(e) => c.setAmazonRefreshToken(e.target.value)}
            placeholder="Paste LWA refresh token (Atzr|…)"
            className={`w-full border border-border-soft bg-surface-canvas px-2 py-2 ${sectionLabel} text-text-default outline-none`}
          />
          <div className="flex items-stretch gap-2">
            <input
              value={c.amazonSellerId}
              onChange={(e) => c.setAmazonSellerId(e.target.value)}
              placeholder="Seller ID (optional)"
              className={`min-w-0 flex-1 border border-border-soft bg-surface-canvas px-2 py-2 ${sectionLabel} text-text-default outline-none`}
            />
            <select
              value={c.amazonRegion}
              onChange={(e) => c.setAmazonRegion(e.target.value as 'NA' | 'EU' | 'FE')}
              className={`border border-border-soft bg-surface-canvas px-2 py-2 ${sectionLabel} text-text-default outline-none`}
            >
              <option value="NA">NA</option>
              <option value="EU">EU</option>
              <option value="FE">FE</option>
            </select>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => c.amazonConnectMutation.mutate()}
            disabled={!c.amazonRefreshToken.trim() || c.amazonConnectMutation.isPending}
            className="w-full bg-blue-50 text-blue-700 ring-blue-300 ring-inset hover:bg-blue-100"
          >
            {c.amazonConnectMutation.isPending ? 'Verifying…' : 'Verify & Connect'}
          </Button>
        </div>
      </div>
      {c.amazonAccounts.map((acc) => (
        <LineItem
          key={acc.id}
          label={acc.account_name}
          detail={acc.last_error ? `Error: ${acc.last_error}` : `${acc.region} · ${acc.status}`}
          right={
            <HoverTooltip label={`Disconnect ${acc.account_name}`} asChild>
              {/* ds-raw-button: flush w-12 h-full cell action mirroring ActionButton geometry — not a Button shape */}
              <button
                type="button"
                onClick={() => c.amazonDisconnectMutation.mutate(acc.id)}
                disabled={c.amazonDisconnectMutation.isPending && c.amazonDisconnectMutation.variables === acc.id}
                className={`ds-raw-button h-full w-12 border-l border-border-soft ${sectionLabel} text-text-muted hover:bg-surface-sunken disabled:opacity-50`}
                aria-label={`Disconnect ${acc.account_name}`}
              >
                Off
              </button>
            </HoverTooltip>
          }
        />
      ))}
    </SidebarSection>
  );
}
