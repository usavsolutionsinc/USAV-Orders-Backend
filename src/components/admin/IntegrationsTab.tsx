import { getCurrentUser } from '@/lib/auth/current-user';
import pool from '@/lib/db';
import { IntegrationCard } from './IntegrationCard';

const PROVIDER_CATALOG = [
  { key: 'ebay',          label: 'eBay',          description: 'Storefront sync + token refresh.' },
  { key: 'zoho',          label: 'Zoho Inventory', description: 'Sales orders, POs, invoices.' },
  { key: 'ecwid',         label: 'Ecwid',         description: 'Storefront catalog + orders.' },
  { key: 'square',        label: 'Square',        description: 'In-store POS + walk-ins.' },
  { key: 'ups',           label: 'UPS',           description: 'Tracking + webhook callbacks.' },
  { key: 'fedex',         label: 'FedEx',         description: 'Shipment tracking.' },
  { key: 'usps',          label: 'USPS',          description: 'OAuth + label tracking.' },
  { key: 'zendesk',       label: 'Zendesk',       description: 'Customer ticket linkage.' },
  { key: 'google_sheets', label: 'Google Sheets', description: 'Order transfer pipelines.' },
  { key: 'ably',          label: 'Ably',          description: 'Realtime channel auth.' },
  { key: 'ollama',        label: 'Ollama (AI)',   description: 'Local LLM via Cloudflare tunnel.' },
  { key: 'stripe',        label: 'Stripe',        description: 'Per-tenant payments override.' },
] as const;

interface IntegrationRow {
  provider: string;
  status: string;
  display_label: string | null;
  last_used_at: Date | null;
  last_error: string | null;
  scope: string | null;
  updated_at: Date;
}

export async function IntegrationsTab() {
  const user = await getCurrentUser();
  if (!user) return null;
  const r = await pool.query<IntegrationRow>(
    `SELECT provider, status, display_label, last_used_at, last_error, scope, updated_at
       FROM organization_integrations
      WHERE organization_id = $1
      ORDER BY provider ASC, scope NULLS FIRST`,
    [user.organizationId],
  );
  const byProvider = new Map<string, IntegrationRow>();
  for (const row of r.rows) {
    if (!byProvider.has(row.provider)) byProvider.set(row.provider, row);
  }

  return (
    <div className="min-h-screen bg-gray-50 antialiased">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header>
          <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Integrations</h1>
          <p className="mt-1 text-[13px] text-gray-500">
            Connected services for this workspace. Credentials are encrypted at rest with the workspace vault.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDER_CATALOG.map((p) => (
            <IntegrationCard
              key={p.key}
              providerKey={p.key}
              providerLabel={p.label}
              description={p.description}
              row={byProvider.get(p.key) ?? null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
