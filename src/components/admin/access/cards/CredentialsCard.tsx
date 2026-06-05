'use client';

import { fmtRelative, type DetailEnvelope } from '../staff-access-shared';

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
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-white shadow-sm`}>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Credentials</h2>
          <p className="mt-0.5 text-caption text-gray-500">PIN, passkeys, and active sessions.</p>
        </div>
      </header>
      <div className="divide-y divide-gray-100">
        {/* PIN */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">PIN</div>
            <div className="mt-0.5 text-caption text-gray-500">
              {staff.has_pin ? `Set ${staff.pin_set_at ? fmtRelative(staff.pin_set_at) : ''}` : 'Not set'}
              {staff.pin_locked_until && new Date(staff.pin_locked_until).getTime() > Date.now() && (
                <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-amber-900">
                  Locked until {new Date(staff.pin_locked_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onUpdatePin}
              disabled={anyBusy}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            >
              Update PIN
            </button>
            <button
              type="button"
              onClick={onResetPin}
              disabled={busyResetPin}
              className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-amber-800 hover:bg-amber-100"
            >
              {busyResetPin ? 'Resetting…' : 'Reset PIN'}
            </button>
          </div>
        </div>

        {/* Passkeys */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Passkeys</div>
            <div className="text-caption text-gray-500">{passkeys.length}</div>
          </div>
          {passkeys.length === 0 ? (
            <p className="mt-1 text-caption text-gray-400">No passkeys registered.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-gray-800">{p.device_label || 'Unlabeled device'}</div>
                    <div className="truncate text-micro text-gray-500">
                      added {fmtRelative(p.created_at)}{p.last_used_at && ` · used ${fmtRelative(p.last_used_at)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevokePasskey(p.id)}
                    disabled={busyRevokePasskey}
                    className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Session policy */}
        <div className="border-t border-gray-100 px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900">Session length</div>
              <p className="mt-0.5 text-caption text-gray-500">
                How long this staff stays signed in before being asked again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={staff.session_policy}
                onChange={(e) => onChangeSessionPolicy(e.target.value)}
                disabled={busyBasic}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="default">Default</option>
                <option value="extended">Extended</option>
                <option value="persistent">Persistent</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-micro text-gray-500">
            {staff.session_policy === 'default' && '8h station · 30d personal · 4h phone (with idle timeouts).'}
            {staff.session_policy === 'extended' && 'Personal devices: 7d idle / 90d absolute. Station and phone unchanged.'}
            {staff.session_policy === 'persistent' && 'No idle timeout. Session refreshed on every use — stays signed in indefinitely.'}
          </p>
        </div>

        {/* Sessions */}
        <div className="border-t border-gray-100 px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Active sessions</div>
            <div className="flex items-center gap-2">
              <div className="text-caption text-gray-500">{sessions.length}</div>
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={onRevokeAll}
                  disabled={busyRevokeAll}
                  className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                >
                  Revoke all
                </button>
              )}
            </div>
          </div>
          {sessions.length === 0 ? (
            <p className="mt-1 text-caption text-gray-400">No active sessions.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
              {sessions.map((s) => (
                <li key={s.sid} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-gray-800">
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-gray-600 mr-1.5">{s.device_kind}</span>
                      {s.device_label || 'Unlabeled'}
                    </div>
                    <div className="truncate text-micro text-gray-500">
                      {s.ip || 'no-ip'} · seen {fmtRelative(s.last_seen_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevokeSession(s.sid)}
                    disabled={busyRevokeSession}
                    className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
