import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * GET /api/architecture
 *
 * Returns the latest generated architecture diagrams as JSON so the admin
 * Architecture tab can render them live with Mermaid in the browser.
 *
 * Reads from `<repo-root>/docs/architecture/`:
 *   - manifest.json (generated_at, project_name, diagram metadata)
 *   - diagrams/*.mmd (raw Mermaid source per diagram)
 *
 * The generator is at:
 *   ~/.hermes-usav/skills/software-development/codebase-visualizer/scripts/generate.py
 * It runs on every commit via .git/hooks/post-commit (installed by install-hook.sh).
 *
 * Response shape:
 *   { ok: true, manifest: {...}, diagrams: { [key]: { title, description, mermaid } } }
 *
 * If the architecture folder doesn't exist (never generated), returns
 *   { ok: false, reason: 'not_generated', hint: '...' }
 *
 * This endpoint reads files from disk on every request — fine for a low-traffic
 * admin tool, no caching needed. Next.js needs `dynamic = 'force-dynamic'` to
 * avoid build-time file reads.
 */
export const dynamic = 'force-dynamic';

type DiagramMeta = { title: string; description?: string };

type Manifest = {
  generated_at: string;
  project_name: string;
  files_scanned: number;
  git_head: string;
  diagrams: Record<string, DiagramMeta>;
};

type DiagramPayload = {
  title: string;
  description: string;
  mermaid: string;
};

const DIAGRAM_DESCRIPTIONS: Record<string, string> = {
  mindmap: 'High-level mind map of the codebase structure.',
  modules: 'Top-level folders and how they import each other. Click a node to see its file path.',
  routes: 'Pages and API routes under src/app.',
  data_flow: 'Typical request/response sequence for this stack.',
  recent: 'Git commits in the last 14 days.',
};

type CustomManifest = { diagrams?: Record<string, DiagramMeta> };

// Hand-authored diagrams live in docs/architecture/diagrams/custom/. They
// survive the post-commit regeneration (generate.py only touches the parent
// manifest + sibling .mmd files), and they get merged in *after* generated
// diagrams so they appear at the bottom of the tab list.
async function loadCustomDiagrams(archDir: string): Promise<{
  meta: Record<string, DiagramMeta>;
  payloads: Record<string, DiagramPayload>;
}> {
  const customDir = path.join(archDir, 'diagrams', 'custom');
  const customManifestPath = path.join(customDir, 'manifest.json');

  let raw: string;
  try {
    raw = await fs.readFile(customManifestPath, 'utf-8');
  } catch {
    return { meta: {}, payloads: {} };
  }

  let parsed: CustomManifest;
  try {
    parsed = JSON.parse(raw) as CustomManifest;
  } catch {
    return { meta: {}, payloads: {} };
  }

  const meta: Record<string, DiagramMeta> = {};
  const payloads: Record<string, DiagramPayload> = {};
  for (const [key, m] of Object.entries(parsed.diagrams ?? {})) {
    const mmdPath = path.join(customDir, `${key}.mmd`);
    try {
      const mermaid = await fs.readFile(mmdPath, 'utf-8');
      meta[key] = m;
      payloads[key] = {
        title: m.title,
        description: m.description ?? '',
        mermaid,
      };
    } catch {
      // Skip — manifest references a .mmd that isn't on disk yet.
    }
  }
  return { meta, payloads };
}

export async function GET() {
  const repoRoot = process.cwd();
  const archDir = path.join(repoRoot, 'docs', 'architecture');
  const manifestPath = path.join(archDir, 'manifest.json');

  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, 'utf-8');
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reason: 'not_generated',
        hint:
          'Run the generator: python3 ~/.hermes-usav/skills/software-development/codebase-visualizer/scripts/generate.py',
      },
      { status: 404 },
    );
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestRaw) as Manifest;
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: 'manifest_parse_error', error: String(err) },
      { status: 500 },
    );
  }

  const diagrams: Record<string, DiagramPayload> = {};
  for (const [key, meta] of Object.entries(manifest.diagrams ?? {})) {
    const mmdPath = path.join(archDir, 'diagrams', `${key}.mmd`);
    try {
      const mermaid = await fs.readFile(mmdPath, 'utf-8');
      diagrams[key] = {
        title: meta.title,
        description: meta.description ?? DIAGRAM_DESCRIPTIONS[key] ?? '',
        mermaid,
      };
    } catch {
      // Skip missing diagrams — manifest may reference one whose .mmd was deleted.
    }
  }

  const custom = await loadCustomDiagrams(archDir);
  for (const [key, payload] of Object.entries(custom.payloads)) {
    diagrams[key] = payload;
    manifest.diagrams[key] = custom.meta[key];
  }

  return NextResponse.json({ ok: true, manifest, diagrams });
}
