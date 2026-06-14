import { requirePermission } from '@/lib/auth/page-guard';
import { StudioShell } from '@/components/studio/StudioShell';

/**
 * /studio — the Operations Studio (ST1: read-only shell).
 *
 * One full-page canvas where the whole operation is modeled and observed:
 * L0 business map (department groups) ⇄ L1 flow graph (process nodes with
 * numbered lifecycle states), with the Library and Inspector panes alongside.
 * View state (?v=&focus=&z=) lives in the URL so any view is shareable.
 *
 * Read-only by design at this phase — editing (draft → publish) unlocks at
 * ST4 behind studio.manage. See docs/operations-studio/operations-studio-plan.md.
 */
export const metadata = { title: 'Operations Studio' };

export default async function StudioPage() {
  await requirePermission('studio.view');
  return <StudioShell />;
}
