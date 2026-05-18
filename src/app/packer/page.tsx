import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { PackerPageContent } from '@/components/packer/PackerPageContent';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * /packer — the packer station landing.
 *
 * Identity from the verified session cookie. Staff switching happens via the
 * FAB's SwitchStaffSheet, not the URL.
 */
export default async function PackerPage() {
  const user = await getCurrentUser();
  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || '/packer';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  return <PackerPageContent packerId={String(user.staffId)} />;
}
