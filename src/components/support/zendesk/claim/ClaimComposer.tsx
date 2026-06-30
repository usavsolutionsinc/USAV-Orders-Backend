'use client';

import { AtSign, Globe, Lock } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { ZendeskSelect } from '../ZendeskSelect';
import { TagInput } from '../TagInput';
import { ClaimAttachments } from './ClaimAttachments';
import { ClaimTicketPicker } from './ClaimTicketPicker';
import { PRIORITY_OPTIONS } from './claim-types';
import type { ZendeskClaimController } from './useZendeskClaimController';

const labelCls = 'text-micro font-black uppercase tracking-widest text-gray-500';
const inputCls =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

/** Internal-note ↔ public-reply segmented toggle. */
function VisibilityToggle({
  value,
  onChange,
  internalLabel,
  publicLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  internalLabel: string;
  publicLabel: string;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          'ds-raw-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-bold transition',
          !value ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
        )}
      >
        <Lock className="h-3.5 w-3.5" /> {internalLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          'ds-raw-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-bold transition',
          value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
        )}
      >
        <Globe className="h-3.5 w-3.5" /> {publicLabel}
      </button>
    </div>
  );
}

/** The mode-specific form body + the shared attachments section. */
export function ClaimComposer({ c }: { c: ZendeskClaimController }) {
  return (
    <div className="space-y-5">
      {c.mode === 'create' ? (
        <>
          <div className="space-y-1.5">
            <label className={labelCls}>Subject</label>
            <input
              value={c.subject}
              onChange={(e) => c.setSubject(e.target.value)}
              placeholder="Short summary of the issue"
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Description</label>
            <textarea
              value={c.description}
              onChange={(e) => c.setDescription(e.target.value)}
              rows={4}
              placeholder="What happened? Include any context the agent needs."
              className={cn(inputCls, 'resize-none leading-relaxed')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <label className={labelCls}>Priority</label>
              <ZendeskSelect
                value={c.priority}
                options={PRIORITY_OPTIONS}
                onChange={(v) => c.setPriority(v as typeof c.priority)}
                size="field"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Tags</label>
              <TagInput tags={c.tags} onChange={c.setTags} placeholder="Add tags…" />
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl bg-gray-50/80 p-3.5 ring-1 ring-inset ring-gray-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-label font-bold text-gray-700">First message</p>
                <p className="text-caption text-gray-500">
                  {c.createPublic ? 'Emails the requester below.' : 'Internal note — nobody is emailed.'}
                </p>
              </div>
              <VisibilityToggle
                value={c.createPublic}
                onChange={c.setCreatePublic}
                internalLabel="Internal"
                publicLabel="Email"
              />
            </div>
            {c.createPublic ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input
                  value={c.requesterName}
                  onChange={(e) => c.setRequesterName(e.target.value)}
                  placeholder="Requester name"
                  className={inputCls}
                />
                <div className="relative">
                  <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={c.requesterEmail}
                    onChange={(e) => c.setRequesterEmail(e.target.value)}
                    placeholder="requester@email.com"
                    className={cn(inputCls, 'pl-9')}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <ClaimTicketPicker ticket={c.ticket} onPick={c.setTicket} />
          {c.ticket ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className={labelCls}>{c.replyPublic ? 'Public reply' : 'Internal note'}</label>
                <VisibilityToggle
                  value={c.replyPublic}
                  onChange={c.setReplyPublic}
                  internalLabel="Note"
                  publicLabel="Reply"
                />
              </div>
              <textarea
                value={c.comment}
                onChange={(e) => c.setComment(e.target.value)}
                rows={4}
                placeholder={c.replyPublic ? 'Write a reply to the customer…' : 'Add an internal note…'}
                className={cn(inputCls, 'resize-none leading-relaxed')}
              />
            </div>
          ) : null}
        </>
      )}

      <ClaimAttachments c={c} />
    </div>
  );
}
