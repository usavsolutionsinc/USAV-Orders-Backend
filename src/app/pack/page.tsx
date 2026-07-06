import { PackerSurfacePage } from '@/components/packer/PackerSurfacePage';

/**
 * `/pack` — the Packing operator surface as a first-class, semantic route
 * (Studio-driven operator surfaces refactor Phase 7). The URL names the
 * operator's job. Legacy `/packer` redirects here via the proxy; on phones both
 * `/pack` and `/packer` UA-rewrite to the `/m/pack` mobile shell.
 */
export default function PackPage() {
  return <PackerSurfacePage fallbackPath="/pack" />;
}
