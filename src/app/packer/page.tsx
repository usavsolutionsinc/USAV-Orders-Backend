import { PackerPageContent } from '@/components/packer/PackerPageContent';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * /packer — the packer station landing.
 *
 * Identity from the session cookie. See `/tech` page for the migration
 * notes. Fallback to staff #4 if signed out so the page still renders
 * during rollout.
 */
export default async function PackerPage() {
  const user = await getCurrentUser();
  const packerId = user ? String(user.staffId) : '4';

  return <PackerPageContent packerId={packerId} />;
}
