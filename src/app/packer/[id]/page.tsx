import { redirect } from 'next/navigation';

/**
 * Legacy deep link `/packer/[id]` — see `/tech/[id]` for the rationale.
 */
export default async function PackerIdPage() {
  redirect('/packer');
}
