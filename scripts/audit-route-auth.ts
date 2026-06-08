/**
 * Route auth audit + manifest generator.
 *
 * Three modes:
 *   - default (no flags) : print a human-readable risk report to stdout
 *   - `--emit`           : write the canonical manifest to docs/security/route-permissions.json
 *   - `--check`          : compare the live routes against the committed manifest
 *                          and exit 1 if they diverge. Use in CI.
 *
 * The manifest is the declarative source of truth for the question
 * "which API routes are gated by which permission?" — used by:
 *   - human reviewers reading PR diffs
 *   - SOC2 / compliance inventories
 *   - the Roles admin UI's reverse lookup ("granting this permission opens N routes")
 *   - CI drift detection (`--check`)
 *
 * The manifest is GENERATED, not hand-edited. Anyone changing route auth
 * has to re-run `npm run audit-route-auth -- --emit` and commit the
 * resulting diff alongside their code change. The diff makes the security
 * impact of a PR explicit.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, relative } from 'path';

const MANIFEST_PATH = 'docs/security/route-permissions.json';

interface RouteInfo {
  path: string;
  methods: string[];
  /** First matching auth pattern, if any. */
  gate: string;
  /** Permission string if route declares one. */
  permission: string | null;
  /** Why this route is exempt from a permission gate. */
  exemptReason: string | null;
}

interface Manifest {
  /** Manifest schema version. Bump when the shape changes. */
  version: 1;
  generatedAt: string;
  /** Total route handler files scanned. */
  totalRoutes: number;
  /** Summary counts by risk bucket. */
  summary: {
    permissionGated: number;
    authenticatedNoPermission: number;
    anonymousIntentional: number;
    serviceToService: number;
    ungatedRead: number;
    ungatedWrite: number;
  };
  /** Every route, sorted by path. The shape stays stable so diffs are minimal. */
  routes: Array<{
    path: string;
    methods: string[];
    gate: string;
    permission: string | null;
    exemptReason: string | null;
  }>;
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
  if (path.includes('/api/billing/webhook')) return 'webhook (gated by signature)';
  if (path.includes('/api/health')) return 'health probe';
  if (path.includes('/api/ready')) return 'readiness probe';
  if (path.includes('/api/cron/')) return 'cron endpoint';
  // Dev/LAN NAS file passthrough: returns 404 in production unless NAS_DEV_ROOT
  // is explicitly set, is session-gated by middleware, and is hardened with a
  // path-traversal guard + image-only write restriction. Not permission-gated
  // by design (it serves a single mounted folder to the local picker).
  if (path.includes('/api/nas-dev/')) return 'dev/LAN NAS passthrough (disabled in prod; path-traversal + image-only guarded)';
  return null;
}

function detectGate(src: string): { gate: string; permission: string | null } {
  if (/withAuth\s*\([^)]*allowAnonymous\s*:\s*true/s.test(src)) {
    return { gate: 'withAuth (anonymous OK)', permission: null };
  }
  const permMatch = src.match(/withAuth\([^]*?permission\s*:\s*['"]([\w.]+)['"]/);
  if (permMatch) return { gate: 'withAuth', permission: permMatch[1] };
  if (/\bwithAuth\b/.test(src)) return { gate: 'withAuth (no permission)', permission: null };
  if (/\bisQStashOrigin\b/.test(src)) return { gate: 'isQStashOrigin', permission: null };
  if (/\brequirePermission\b/.test(src)) return { gate: 'requirePermission (page guard)', permission: null };
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
  return Array.from(found).sort();
}

function collectRoutes(): RouteInfo[] {
  const apiDir = 'src/app/api';
  const files = walk(apiDir);
  const routes: RouteInfo[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const methods = detectMethods(src);
    if (methods.length === 0) continue;
    const exemptReason = classifyExemption(f);
    const { gate, permission } = detectGate(src);
    routes.push({
      path: f.replace(/^src\/app/, ''),
      methods,
      gate,
      permission,
      exemptReason,
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

function summarize(routes: RouteInfo[]): Manifest['summary'] {
  const s: Manifest['summary'] = {
    permissionGated: 0,
    authenticatedNoPermission: 0,
    anonymousIntentional: 0,
    serviceToService: 0,
    ungatedRead: 0,
    ungatedWrite: 0,
  };
  for (const r of routes) {
    if (r.permission) {
      s.permissionGated += 1;
    } else if (r.gate === 'withAuth (no permission)') {
      s.authenticatedNoPermission += 1;
    } else if (r.exemptReason) {
      s.anonymousIntentional += 1;
    } else if (r.gate === 'requireInternalToken (service-to-service)' || r.gate === 'signature') {
      s.serviceToService += 1;
    } else if (r.gate === 'NONE') {
      const writes = r.methods.some((m) => m !== 'GET');
      if (writes) s.ungatedWrite += 1;
      else s.ungatedRead += 1;
    } else {
      s.permissionGated += 1;
    }
  }
  return s;
}

function buildManifest(routes: RouteInfo[]): Manifest {
  return {
    version: 1,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    totalRoutes: routes.length,
    summary: summarize(routes),
    routes: routes.map((r) => ({
      path: r.path,
      methods: r.methods,
      gate: r.gate,
      permission: r.permission,
      exemptReason: r.exemptReason,
    })),
  };
}

function printReport(routes: RouteInfo[]): void {
  const ungatedWrite = routes.filter(
    (r) => r.gate === 'NONE' && !r.exemptReason && r.methods.some((m) => m !== 'GET'),
  );
  const ungatedReadOnly = routes.filter(
    (r) => r.gate === 'NONE' && !r.exemptReason && r.methods.every((m) => m === 'GET'),
  );
  const authedNoPermission = routes.filter(
    (r) => r.gate === 'withAuth (no permission)' && !r.exemptReason && r.methods.some((m) => m !== 'GET'),
  );

  console.log('Total route files:', routes.length);
  console.log('');
  console.log('=== HIGH RISK: WRITE methods with NO gate ===');
  if (ungatedWrite.length === 0) console.log('  ✓ none');
  else for (const r of ungatedWrite) console.log(`  ✗ ${r.methods.join(',').padEnd(20)} ${r.path}`);

  console.log('');
  console.log('=== MEDIUM: WRITE methods with withAuth but NO permission declared ===');
  if (authedNoPermission.length === 0) console.log('  ✓ none');
  else for (const r of authedNoPermission) console.log(`  ⚠ ${r.methods.join(',').padEnd(20)} ${r.path}`);

  console.log('');
  console.log('=== LOWER RISK: READ-only routes with no gate (still proxy-cookie gated) ===');
  if (ungatedReadOnly.length === 0) console.log('  ✓ none');
  else for (const r of ungatedReadOnly) console.log(`  ⓘ ${r.methods.join(',').padEnd(20)} ${r.path}`);

  console.log('');
  console.log('=== Summary ===');
  console.log('  high-risk ungated writes:', ungatedWrite.length);
  console.log('  authed-but-no-permission writes:', authedNoPermission.length);
  console.log('  ungated reads:', ungatedReadOnly.length);
  console.log('  total routes:', routes.length);
}

function writeManifest(manifest: Manifest): void {
  const target = MANIFEST_PATH;
  mkdirSync(dirname(target), { recursive: true });
  // Stable formatting — 2-space indent so diffs stay readable.
  writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${target} (${manifest.routes.length} routes)`);
}

function checkAgainstCommittedManifest(routes: RouteInfo[]): number {
  const live = buildManifest(routes);
  let committed: Manifest;
  try {
    committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch (err) {
    console.error(`Failed to read committed manifest at ${MANIFEST_PATH}: ${err}`);
    console.error('Run `npm run audit-route-auth -- --emit` to generate it.');
    return 1;
  }

  // Compare only the substantive shape — ignore the timestamp.
  const stripTs = (m: Manifest) => ({ ...m, generatedAt: '' });
  const liveStr = JSON.stringify(stripTs(live));
  const committedStr = JSON.stringify(stripTs(committed));

  if (liveStr === committedStr) {
    console.log('✓ route-permissions manifest matches live source');
    return 0;
  }

  console.error('✗ route-permissions manifest is OUT OF DATE');
  console.error('');
  console.error('  The live routes diverge from the committed manifest at:');
  console.error(`  ${relative(process.cwd(), MANIFEST_PATH)}`);
  console.error('');
  console.error('  Diff summary:');
  diffRoutes(committed.routes, live.routes);
  console.error('');
  console.error('  Fix: run `npm run audit-route-auth -- --emit` and commit the result.');
  return 1;
}

function diffRoutes(
  before: Manifest['routes'],
  after: Manifest['routes'],
): void {
  const key = (r: { path: string; methods: string[] }) => `${r.path}::${r.methods.join(',')}`;
  const byKeyBefore = new Map(before.map((r) => [key(r), r]));
  const byKeyAfter = new Map(after.map((r) => [key(r), r]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [k, r] of byKeyAfter) {
    const b = byKeyBefore.get(k);
    if (!b) {
      added.push(`+ ${k} → gate=${r.gate}, perm=${r.permission ?? '∅'}`);
    } else if (b.gate !== r.gate || b.permission !== r.permission || b.exemptReason !== r.exemptReason) {
      changed.push(
        `~ ${k}\n      gate: ${b.gate} → ${r.gate}\n      perm: ${b.permission ?? '∅'} → ${r.permission ?? '∅'}`,
      );
    }
  }
  for (const [k] of byKeyBefore) {
    if (!byKeyAfter.has(k)) removed.push(`- ${k}`);
  }

  for (const line of [...added, ...removed, ...changed].slice(0, 50)) {
    console.error('   ', line);
  }
  if (added.length + removed.length + changed.length > 50) {
    console.error(`    … and ${added.length + removed.length + changed.length - 50} more`);
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--check')
    ? 'check'
    : argv.includes('--emit')
      ? 'emit'
      : 'report';

  const routes = collectRoutes();

  if (mode === 'emit') {
    writeManifest(buildManifest(routes));
    return 0;
  }
  if (mode === 'check') {
    return checkAgainstCommittedManifest(routes);
  }
  printReport(routes);
  return 0;
}

process.exit(main());
