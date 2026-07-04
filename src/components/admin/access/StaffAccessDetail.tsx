'use client';

/**
 * Admin → Access lives at /settings/access&staffId=N — focused detail view for one staff.
 *
 * Cards (single column, max-w-3xl): Identity, Roles, Stations, Landing page,
 * .access (page permissions), Credentials, Mobile display, Audit.
 *
 * Server state lives in useStaffAccessDetail (the detail envelope + every
 * mutation) and useStaffStations. Permission math is in page-access-matrix
 * (pure + unit-tested). This component only composes those and owns the two
 * bits of ephemeral UI state: the reset-PIN QR modal and the set-PIN dialog.
 */

import { useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/design-system/primitives';
import { isAdminRoleKey, type StaffRole } from '@/lib/auth/permissions-shared';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useConfirmedAction } from '@/hooks';
import { buildPageAccessMatrix } from './page-access-matrix';
import { useStaffAccessDetail } from './useStaffAccessDetail';
import { useStaffStations } from './useStaffStations';
import { SetPinDialog } from './SetPinDialog';
import { IdentityCard } from './cards/IdentityCard';
import { RolesCard } from './cards/RolesCard';
import { StationsCard } from './cards/StationsCard';
import { LandingPageCard } from './cards/LandingPageCard';
import { PageAccessCard } from './cards/PageAccessCard';
import { CredentialsCard } from './cards/CredentialsCard';
import { MobileDisplayCard } from './cards/MobileDisplayCard';
import { AuditCard } from './cards/AuditCard';

interface StaffAccessDetailProps { staffId: number }

export function StaffAccessDetail({ staffId }: StaffAccessDetailProps) {
  const { detail, mutations, actionError, anyBusy } = useStaffAccessDetail(staffId);
  const stations = useStaffStations(staffId);

  const [qrUrl, setQrUrl] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const {
    patchBasic, patchPermissions, setRoles, resetPin, setPin,
    revokePasskey, revokeSession, revokeAllSessions, patchMobileConfig,
  } = mutations;

  const confirmResetPin = useConfirmedAction(async () => {
    try {
      const data = await resetPin.mutateAsync();
      setQrUrl({ url: data.url, expiresAt: data.expiresAt });
    } catch { /* surfaced via actionError */ }
  }, "Reset this staff's PIN and send them an enrollment QR?");

  const confirmRevokePasskey = useConfirmedAction(
    (pid: number) => { revokePasskey.mutate(pid); }, 'Revoke this passkey?');
  const confirmRevokeSession = useConfirmedAction(
    (sid: string) => { revokeSession.mutate(sid); }, 'Revoke this session?');
  const confirmRevokeAll = useConfirmedAction(
    () => { revokeAllSessions.mutate(); }, 'Revoke ALL active sessions for this staff?');

  const env = detail.data;
  const isAdmin = useMemo(() => {
    if (!env) return false;
    const role = (env.roles[0]?.key ?? env.staff.role) as StaffRole;
    return isAdminRoleKey(role) || env.roles.some((r) => isAdminRoleKey(r.key));
  }, [env]);
  const matrix = useMemo(
    () => (env ? buildPageAccessMatrix(env, isAdmin) : null),
    [env, isAdmin],
  );

  if (detail.isLoading) {
    return <div className="p-8 text-center text-sm text-text-soft">Loading staff…</div>;
  }
  if (detail.error) {
    return <div className="m-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detail.error.message}</div>;
  }
  if (!env || !matrix) return null;

  const { staff, passkeys, sessions, audit, roles, availableRoles } = env;
  const role = (roles[0]?.key ?? staff.role) as StaffRole;
  const theme = getStaffThemeById(staff.id);
  const sc = stationThemeColors[theme];
  const added = staff.permissions_added ?? [];
  const removed = staff.permissions_removed ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {actionError && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}

      <IdentityCard
        staff={staff}
        roles={roles}
        availableRoles={availableRoles}
        isAdmin={isAdmin}
        borderClass={sc.border}
        avatarBgClass={sc.bg}
        busyBasic={patchBasic.isPending}
        busyRoles={setRoles.isPending}
        onPatchBasic={patchBasic.mutate}
        onSetRoles={setRoles.mutate}
      />

      {!isAdmin && (
        <RolesCard
          roles={roles}
          availableRoles={availableRoles}
          borderClass={sc.border}
          busyRoles={setRoles.isPending}
          onSetRoles={setRoles.mutate}
        />
      )}

      <StationsCard
        stations={stations.stations}
        borderClass={sc.border}
        busy={stations.save.isPending}
        onSave={stations.save.mutate}
      />

      <LandingPageCard
        borderClass={sc.border}
        permissions={matrix.effectivePermissions}
        desktopPath={staff.default_home_path}
        mobilePath={staff.default_home_path_mobile}
        primaryRoleKey={role}
        busy={patchBasic.isPending}
        onSave={patchBasic.mutate}
      />

      <PageAccessCard
        matrix={matrix}
        isAdmin={isAdmin}
        theme={theme}
        borderClass={sc.border}
        busy={patchPermissions.isPending}
        hasOverrides={added.length > 0 || removed.length > 0}
        onToggle={(permission) => patchPermissions.mutate(matrix.toggle(permission))}
        onResetOverrides={() => patchPermissions.mutate({ add: [], remove: [] })}
      />

      <CredentialsCard
        staff={staff}
        passkeys={passkeys}
        sessions={sessions}
        borderClass={sc.border}
        anyBusy={anyBusy}
        busyResetPin={resetPin.isPending}
        busyBasic={patchBasic.isPending}
        busyRevokePasskey={revokePasskey.isPending}
        busyRevokeSession={revokeSession.isPending}
        busyRevokeAll={revokeAllSessions.isPending}
        onUpdatePin={() => setPinDialogOpen(true)}
        onResetPin={confirmResetPin}
        onRevokePasskey={confirmRevokePasskey}
        onRevokeSession={confirmRevokeSession}
        onRevokeAll={confirmRevokeAll}
        onChangeSessionPolicy={(value) => patchBasic.mutate({ sessionPolicy: value })}
      />

      <MobileDisplayCard
        borderClass={sc.border}
        rolesForResolve={roles}
        staffOverride={staff.mobile_display_config}
        busy={patchMobileConfig.isPending}
        onSave={(config) => patchMobileConfig.mutate(config)}
        onReset={() => patchMobileConfig.mutate(null)}
      />

      <AuditCard audit={audit} borderClass={sc.border} />

      {/* Reset PIN — enrollment QR modal */}
      {qrUrl && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4" onClick={() => setQrUrl(null)}>
          <div className="w-full max-w-md rounded-3xl bg-surface-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-text-default">Reset PIN for {staff.name}</h2>
            <p className="mt-1 text-xs text-text-soft">
              Have them scan this on their phone to pick a new PIN. Expires {new Date(qrUrl.expiresAt).toLocaleString()}.
            </p>
            <div className="my-5 inline-block rounded-2xl border border-border-soft bg-surface-card p-4">
              <QRCode value={qrUrl.url} size={220} level="M" />
            </div>
            <p className="break-all text-micro text-text-faint">{qrUrl.url}</p>
            <Button variant="brand" size="lg" onClick={() => setQrUrl(null)} className="mt-5">
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Update PIN dialog */}
      <SetPinDialog
        open={pinDialogOpen}
        staffName={staff.name}
        onClose={() => setPinDialogOpen(false)}
        onSubmit={async (pin) => {
          try {
            await setPin.mutateAsync(pin);
            return { ok: true as const };
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : 'Could not set PIN.' };
          }
        }}
      />
    </div>
  );
}
