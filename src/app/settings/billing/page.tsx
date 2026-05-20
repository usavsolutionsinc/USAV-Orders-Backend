/**
 * /settings/billing — tenant billing dashboard.
 *
 * Server component. Loads the org + subscription, renders a card-per-plan
 * with the current one highlighted, and surfaces the Stripe billing portal
 * link for everything Stripe owns (payment method, invoices, cancel).
 *
 * Gated by admin.view at the page level — non-admins shouldn't see billing.
 */

import { requirePermission } from '@/lib/auth/page-guard';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getSubscription } from '@/lib/billing/subscriptions';
import { entitlementsForPlan, PLAN_PRICE_IDS } from '@/lib/billing/plans';
import type { PlatformPlan } from '@/lib/tenancy/constants';
import { BillingActions } from './BillingActions';

const PLAN_LABELS: Record<PlatformPlan, { label: string; tagline: string }> = {
  trial:      { label: 'Trial',      tagline: 'Try everything for 14 days.' },
  starter:    { label: 'Starter',    tagline: 'For small teams getting started.' },
  growth:     { label: 'Growth',     tagline: 'FBA, repair, advanced roles.' },
  pro:        { label: 'Pro',        tagline: 'Automations + webhooks + audit log export.' },
  enterprise: { label: 'Enterprise', tagline: 'SSO, priority support, custom contracts.' },
};

const UPGRADABLE: ReadonlyArray<PlatformPlan> = ['starter', 'growth', 'pro'];

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function BillingPage() {
  const user = await requirePermission('admin.view');
  const [org, sub] = await Promise.all([
    getOrganization(user.organizationId),
    getSubscription(user.organizationId),
  ]);

  if (!org) {
    return <Shell><Card>Organization not found.</Card></Shell>;
  }

  const ent = entitlementsForPlan(org.plan);

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header>
          <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Billing</h1>
          <p className="mt-1 text-[13px] text-gray-500">Workspace: <span className="font-medium text-gray-700">{org.name}</span></p>
        </header>

        <Card>
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">Current plan</div>
              <div className="mt-1 text-[22px] font-semibold text-gray-900">{PLAN_LABELS[org.plan].label}</div>
              <p className="mt-1 text-[12.5px] text-gray-500">{PLAN_LABELS[org.plan].tagline}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12px]">
                <dt className="text-gray-500">Status</dt>
                <dd className="font-medium text-gray-900">{sub?.status ?? org.status}</dd>
                <dt className="text-gray-500">Trial ends</dt>
                <dd className="font-medium text-gray-900">{fmtDate(org.trialEndsAt)}</dd>
                {sub && (
                  <>
                    <dt className="text-gray-500">Current period ends</dt>
                    <dd className="font-medium text-gray-900">{fmtDate(sub.currentPeriodEnd)}</dd>
                    <dt className="text-gray-500">Cancels at period end</dt>
                    <dd className="font-medium text-gray-900">{sub.cancelAtPeriodEnd ? 'Yes' : 'No'}</dd>
                  </>
                )}
              </dl>
            </div>
            <BillingActions hasStripeCustomer={!!org.stripeCustomerId} />
          </div>
        </Card>

        <Card>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">Entitlements</div>
          <ul className="mt-3 grid grid-cols-2 gap-y-1.5 text-[12.5px] text-gray-700 sm:grid-cols-3">
            {Object.entries(ent.features).map(([key, on]) => (
              <li key={key} className="flex items-center gap-2">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className={on ? 'text-gray-900' : 'text-gray-400'}>{key}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-[12px] text-gray-500">
            Caps: {ent.maxStaff || '∞'} staff · {ent.maxMonthlyOrders || '∞'} orders/mo ·{' '}
            {ent.maxWarehouses || '∞'} warehouses · {ent.maxIntegrations || '∞'} integrations
          </div>
        </Card>

        <Card>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">Change plan</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {UPGRADABLE.map((plan) => {
              const labels = PLAN_LABELS[plan];
              const current = plan === org.plan;
              // UPGRADABLE is narrowed to the keys present in PLAN_PRICE_IDS.
              const configured = !!PLAN_PRICE_IDS[plan as Exclude<PlatformPlan, 'trial' | 'enterprise'>];
              return (
                <div
                  key={plan}
                  className={`rounded-2xl border p-4 ${current ? 'border-slate-900 bg-slate-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="text-[14px] font-semibold text-gray-900">{labels.label}</div>
                  <p className="mt-0.5 text-[12px] text-gray-500">{labels.tagline}</p>
                  <div className="mt-3">
                    {current ? (
                      <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-white">Current</span>
                    ) : configured ? (
                      <form action="/api/billing/checkout" method="post">
                        <input type="hidden" name="plan" value={plan} />
                        <BillingActions.UpgradeButton plan={plan} />
                      </form>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700">Not configured</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-gray-500">
            Enterprise is sales-assisted — <a className="font-medium text-slate-900 hover:underline" href="mailto:sales@usav.example.com">contact us</a>.
          </p>
        </Card>
      </div>
    </Shell>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm shadow-gray-900/[0.02]">
      {children}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50 antialiased">{children}</div>;
}
