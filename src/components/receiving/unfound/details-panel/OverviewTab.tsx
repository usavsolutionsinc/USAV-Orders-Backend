import { ExternalLink } from '@/components/Icons';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { formatDateTimePST } from '@/utils/date';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import type { TriageDetail } from '@/components/po-triage/types';
import type { UnfoundQueueDetailsRow } from '../unfound-triage-types';
import { Section, Row } from './details-primitives';
import { ZendeskPushSection } from './ZendeskPushSection';

interface OverviewTabProps {
  row: UnfoundQueueDetailsRow;
  subjectPrefix: string;
  poNumbers: string[];
  pushing: boolean;
  onPushToZendesk: (overrides?: { subject: string; description: string }) => void;
  detail: TriageDetail | null;
}

export function OverviewTab({
  row,
  subjectPrefix,
  poNumbers,
  pushing,
  onPushToZendesk,
  detail,
}: OverviewTabProps) {
  return (
    <div className="space-y-5">
      {row.kind === 'email_po' && poNumbers.length > 0 && (
        <Section title="PO numbers">
          <div className="flex flex-wrap items-center gap-1.5">
            {poNumbers.map((po) => (
              <PoChip key={po} value={po} display={getLast4(po)} />
            ))}
          </div>
        </Section>
      )}

      {row.kind !== 'email_po' && row.context && (
        <Section title="Tracking">
          <TrackingChip
            value={
              row.kind === 'station_exception'
                ? row.context.split(' · ')[0]!
                : row.context
            }
            display={getLast4(
              row.kind === 'station_exception'
                ? row.context.split(' · ')[0]!
                : row.context,
            )}
          />
          {row.kind === 'station_exception' && (
            <p className="mt-1 text-micro text-text-soft">{row.context}</p>
          )}
        </Section>
      )}

      {subjectPrefix && row.kind === 'email_po' && (
        <Section title="Subject">
          <p className="text-label text-text-muted">{subjectPrefix}</p>
          {detail?.row.email_from && (
            <p className="mt-0.5 text-micro text-text-soft">
              {detail.row.email_from}
            </p>
          )}
        </Section>
      )}

      {row.product_title && row.kind !== 'email_po' && (
        <Section title="Product">
          <p className="text-label font-semibold text-text-default">
            {row.product_title}
          </p>
        </Section>
      )}

      <Section title="Zendesk">
        {row.zendesk_ticket_id ? (
          <div className="space-y-0.5">
            {(() => {
              const url = zendeskTicketUrl(row.zendesk_ticket_id);
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-label font-bold text-emerald-700 underline-offset-2 hover:underline"
                >
                  {row.zendesk_ticket_id}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="font-mono text-label font-bold text-emerald-700">
                  {row.zendesk_ticket_id}
                </p>
              );
            })()}
            {row.zendesk_synced_at && (
              <p className="text-micro text-text-soft">
                synced {formatDateTimePST(row.zendesk_synced_at)}
              </p>
            )}
          </div>
        ) : (
          <ZendeskPushSection row={row} pushing={pushing} onPush={onPushToZendesk} />
        )}
      </Section>

      {(row.usa_team_note || row.vietnam_team_note) && (
        <Section title="Team notes">
          {row.usa_team_note && (
            <div className="mb-2">
              <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
                USA
              </p>
              <p className="whitespace-pre-wrap text-label text-text-muted">
                {row.usa_team_note}
              </p>
            </div>
          )}
          {row.vietnam_team_note && (
            <div>
              <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
                Vietnam
              </p>
              <p className="whitespace-pre-wrap text-label text-text-muted">
                {row.vietnam_team_note}
              </p>
            </div>
          )}
        </Section>
      )}

      <Section title="Timing">
        <dl className="space-y-1 text-label">
          <Row label="Created" value={formatDateTimePST(row.created_at)} />
          <Row
            label="Follow-up"
            value={row.follow_up_at ? formatDateTimePST(row.follow_up_at) : '—'}
          />
          <Row
            label="Checked"
            value={row.checked_at ? formatDateTimePST(row.checked_at) : '—'}
          />
        </dl>
      </Section>
    </div>
  );
}
