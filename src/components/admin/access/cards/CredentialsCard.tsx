'use client';

import { fmtRelative, type DetailEnvelope } from '../staff-access-shared';
import { Button } from '@/design-system/primitives';

interface CredentialsCardProps {
  staff: DetailEnvelope['staff'];
  passkeys: DetailEnvelope['passkeys'];
  sessions: DetailEnvelope['sessions'];
  borderClass: string;
  anyBusy: boolean;
  busyResetPin: boolean;
  busyBasic: boolean;
  busyRevokePasskey: boolean;
  busyRevokeSession: boolean;
  busyRevokeAll: boolean;
  onUpdatePin: () => void;
  onResetPin: () => void;
  onRevokePasskey: (pid: number) => void;
  onRevokeSession: (sid: string) => void;
  onRevokeAll: () => void;
  onChangeSessionPolicy: (value: string) => void;
}

export function CredentialsCard({
  staff, passkeys, sessions, borderClass, anyBusy, busyResetPin, busyBasic,
  busyRevokePasskey, busyRevokeSession, busyRevokeAll,
  onUpdatePin, onResetPin, onRevokePasskey, onRevokeSession, onRevokeAll, onChangeSessionPolicy,
}: CredentialsCardProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-surface-card shadow-sm`}>
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-default">Credentials</h2>
          <p className="mt-0.5 text-caption text-text-soft">PIN, passkeys, and active sessions.</p>
        </div>
      </header>
      <div className="divide-y divide-border-hairline">
        {/* PIN */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-text-default">PIN</div>
            <div className="mt-0.5 text-caption text-text-soft">
              {staff.has_pin ? `Set ${staff.pin_set_at ? fmtRelative(staff.pin_set_at) : ''}` : 'Not set'}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onUpdatePin} disabled={anyBusy}>
              Update PIN
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onResetPin}
              disabled={busyResetPin}
              className="border border-amber-200 bg-amber-50 text-amber-800 ring-0 hover:bg-amber-100"
            >
              {busyResetPin ? 'Resetting…' : 'Reset PIN'}
            </Button>
          </div>
        </div>

        {/* Passkeys */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-text-default">Passkeys</div>
            <div className="text-caption text-text-soft">{passkeys.length}</div>
          </div>
          {passkeys.length === 0 ? (
            <p className="mt-1 text-caption text-text-faint">No passkeys registered.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border-hairline rounded-lg border border-border-hairline">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-default">{p.device_label || 'Unlabeled device'}</div>
                    <div className="truncate text-micro text-text-soft">
                      added {fmtRelative(p.created_at)}{p.last_used_at && ` · used ${fmtRelative(p.last_used_at)}`}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRevokePasskey(p.id)}
                    disabled={busyRevokePasskey}
                    className="border border-red-200 text-red-700 ring-0 hover:bg-red-50"
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Session policy */}
        <div className="border-t border-border-hairline px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-default">Session length</div>
              <p className="mt-0.5 text-caption text-text-soft">
                How long this staff stays signed in before being asked again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={staff.session_policy}
                onChange={(e) => onChangeSessionPolicy(e.target.value)}
                disabled={busyBasic}
                className="rounded-md border border-border-default bg-surface-card px-2 py-1 text-xs font-medium text-text-default focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="default">Default</option>
                <option value="extended">Extended</option>
                <option value="persistent">Persistent</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-micro text-text-soft">
            {staff.session_policy === 'default' && '8h station · 30d personal · 4h phone (with idle timeouts).'}
            {staff.session_policy === 'extended' && 'Personal devices: 7d idle / 90d absolute. Station and phone unchanged.'}
            {staff.session_policy === 'persistent' && 'No idle timeout. Session refreshed on every use — stays signed in indefinitely.'}
          </p>
        </div>

        {/* Sessions */}
        <div className="border-t border-border-hairline px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-text-default">Active sessions</div>
            <div className="flex items-center gap-2">
              <div className="text-caption text-text-soft">{sessions.length}</div>
              {sessions.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRevokeAll}
                  disabled={busyRevokeAll}
                  className="border border-red-200 text-red-700 ring-0 hover:bg-red-50"
                >
                  Revoke all
                </Button>
              )}
            </div>
          </div>
          {sessions.length === 0 ? (
            <p className="mt-1 text-caption text-text-faint">No active sessions.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border-hairline rounded-lg border border-border-hairline">
              {sessions.map((s) => (
                <li key={s.sid} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-default">
                      <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-text-muted mr-1.5">{s.device_kind}</span>
                      {s.device_label || 'Unlabeled'}
                    </div>
                    <div className="truncate text-micro text-text-soft">
                      {s.ip || 'no-ip'} · seen {fmtRelative(s.last_seen_at)}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRevokeSession(s.sid)}
                    disabled={busyRevokeSession}
                    className="border border-red-200 text-red-700 ring-0 hover:bg-red-50"
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
