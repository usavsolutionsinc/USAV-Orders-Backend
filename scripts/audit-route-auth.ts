/**
 * Route auth audit. Scans every `src/app/api/**\/route.ts` and classifies it by:
 *   - what HTTP methods it exports
 *   - which auth gate it uses (withAuth, isQStashOrigin, getCurrentUser, signature, etc.)
 *   - whether the gate ties to a specific permission
 *
 * The point: surface every route that performs writes WITHOUT an explicit
 * permission gate, so we can triage which ones need locking down.
 *
 * Run via `npm run audit-route-auth`.
 *
 * Exit status:
 *   - 0 if no UNGATED writes (best case)
 *   - 0 with stderr listing risks otherwise (this is an info report, not a
 *     CI gate — fixing each route requires human judgement on the right
 *     permission)
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

interface RouteInfo {
  path: string;
  methods: string[];
  /** First matching auth pattern, if any. */
  gate: string;
  /** Permission string if route declares one via `{ permission: 'foo' }`. */
  permission: string | null;
  /** Why this route is exempt from a permission gate (anonymous flow, webhook, qstash, health). */
  exemptReason: string | null;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function classifyExemption(path: string): string | null {
  if (path.includes('/api/auth/')) return 'auth-flow (sign-in / passkey / pin)';
  if (path.includes('/api/qstash/')) return 'qstash (gated by isQStashOrigin)';
  if (path.includes('/api/webhooks/')) return 'webhook (gated by signature)';
  if (path.includes('/api/health')) return 'health probe';
  if (path.includes('/api/cron/')) return 'cron endpoint';
  return null;
}

function detectGate(src: string): { gate: string; permission: string | null } {
  // Anonymous-permitted withAuth — explicitly OK.
  if (/withAuth\s*\([^)]*allowAnonymous\s*:\s*true/s.test(src)) {
    return { gate: 'withAuth (anonymous OK)', permission: null };
  }
  // Permission-gated withAuth.
  const permMatch = src.match(/withAuth\([^]*?permission\s*:\s*['"]([\w.]+)['"]/);
  if (permMatch) return { gate: 'withAuth', permission: permMatch[1] };

  // withAuth with no permission (still gated to authenticated users).
  if (/\bwithAuth\b/.test(src)) return { gate: 'withAuth (no permission)', permission: null };

  if (/\bisQStashOrigin\b/.test(src)) return { gate: 'isQStashOrigin', permission: null };
  if (/\brequirePermission\b/.test(src)) return { gate: 'requirePermission (page guard)', permission: null };
  // Inline permission gate: `await requireRoutePerm(req, 'foo.bar')`
  const routePermMatch = src.match(/requireRoutePerm\([^,]+,\s*['"]([\w.]+)['"]/);
  if (routePermMatch) return { gate: 'requireRoutePerm', permission: routePermMatch[1] };
  if (/\brequireRoutePerm\b/.test(src)) return { gate: 'requireRoutePerm (no permission)', permission: null };
  if (/\bgetCurrentUser\b/.test(src)) return { gate: 'getCurrentUser (ad-hoc)', permission: null };
  if (/verify[A-Z]\w*Signature|verifyWebhookSignature|verifySignature/.test(src)) return { gate: 'signature', permission: null };
  if (/ENROLL_TOKEN_SECRET|verifyEnrollToken/.test(src)) return { gate: 'enrollment token', permission: null };
  if (/\brequireInternalToken\b/.test(src)) return { gate: 'requireInternalToken (service-to-service)', permission: null };

  return { gate: 'NONE', permission: null };
}

function detectMethods(src: string): string[] {
  const re = /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm;
  const found = new Set<string>();
  for (const m of src.matchAll(re)) found.add(m[1]);
  return Array.from(found);
}

function main(): void {
  const apiDir = 'src/app/api';
  const files = walk(apiDir);
  const routes: RouteInfo[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const methods = detectMethods(src);
    if (methods.length === 0) continue;
    const exemptReason = classifyExemption(f);
    const { gate, permission } = detectGate(src);
    routes.push({ path: f.replace(/^src\/app/, ''), methods, gate, permission, exemptReason });
  }

  // ─── Risk buckets ─────────────────────────────────────────────────────
  const ungatedWrite = routes.filter(
    (r) =>
      r.gate === 'NONE' &&
      !r.exemptReason &&
      r.methods.some((m) => m !== 'GET'),
  );
  const ungatedReadOnly = routes.filter(
    (r) =>
      r.gate === 'NONE' &&
      !r.exemptReason &&
      r.methods.every((m) => m === 'GET'),
  );
  const authedNoPermission = routes.filter(
    (r) =>
      r.gate === 'withAuth (no permission)' &&
      !r.exemptReason &&
      r.methods.some((m) => m !== 'GET'),
  );

  console.log('Total route files:', routes.length);
  console.log('');
  console.log('=== HIGH RISK: WRITE methods with NO gate ===');
  if (ungatedWrite.length === 0) {
    console.log('  ✓ none');
  } else {
    for (const r of ungatedWrite) {
      console.log(`  ✗ ${r.methods.join(',').padEnd(20)} ${r.path}`);
    }
  }

  console.log('');
  console.log('=== MEDIUM: WRITE methods with withAuth but NO permission declared ===');
  if (authedNoPermission.length === 0) {
    console.log('  ✓ none');
  } else {
    for (const r of authedNoPermission) {
      console.log(`  ⚠ ${r.methods.join(',').padEnd(20)} ${r.path}`);
    }
  }

  console.log('');
  console.log('=== LOWER RISK: READ-only routes with no gate (still auth-gated by proxy cookie) ===');
  if (ungatedReadOnly.length === 0) {
    console.log('  ✓ none');
  } else {
    for (const r of ungatedReadOnly) {
      console.log(`  ⓘ ${r.methods.join(',').padEnd(20)} ${r.path}`);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('  high-risk ungated writes:', ungatedWrite.length);
  console.log('  authed-but-no-permission writes:', authedNoPermission.length);
  console.log('  ungated reads:', ungatedReadOnly.length);
  console.log('  total routes:', routes.length);
}

main();
