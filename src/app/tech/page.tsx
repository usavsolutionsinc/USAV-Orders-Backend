import { TechSurfacePage } from '@/components/tech/TechSurfacePage';

/**
 * /tech — legacy alias for the Testing station. Graduated to `/test` (the
 * first-class Test surface, operator-surfaces refactor Phase 8); the proxy
 * redirects `/tech` (incl. `?view=testing`) → `/test` on desktop, so this page
 * only renders when the proxy is bypassed. It delegates to the same shared shell
 * so the legacy URL keeps working (the reversible-cut discipline the plan intends).
 */
export default function TechPage() {
  return <TechSurfacePage fallbackPath="/tech" />;
}
