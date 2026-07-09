import { PackerSurfacePage } from '@/components/packer/PackerSurfacePage';

/**
 * /packer — legacy alias for the Packing station. Graduated to `/pack` (the
 * first-class Pack surface, operator-surfaces refactor Phase 7); the proxy
 * redirects bare `/packer` → `/pack` on desktop, so this page only renders when
 * the proxy is bypassed. It delegates to the same shared shell so the legacy
 * URL keeps working (the reversible-cut discipline the plan intends).
 */
export default function PackerPage() {
  return <PackerSurfacePage fallbackPath="/packer" />;
}
