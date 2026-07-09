#!/usr/bin/env node
/**
 * Schema drift guard — CI gate for curated dropped-column references.
 *
 * Reads scripts/schema-drift-manifest.json (table + column pairs that must not
 * appear in application SQL/TS). Add a row when a migration DROP COLUMNs a field
 * that app code must stop touching.
 *
 * Usage:
 *   node scripts/schema-drift-guard.mjs
 *   node scripts/schema-drift-guard.mjs --check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const manifestPath = join(repoRoot, 'scripts/schema-drift-manifest.json');
const srcRoot = join(repoRoot, 'src');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function walk(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) {
      if (ent === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|sql)$/.test(ent)) {
      out.push(p);
    }
  }
  return out;
}

function patternsForDrop(table, column) {
  const aliases = [table];
  if (table === 'receiving_lines') aliases.push('rl');
  const pats = [];
  for (const t of aliases) {
    pats.push(new RegExp(`\\b${t}\\.${column}\\b`, 'i'));
  }
  const camel = column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const drizzleTable = table.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  pats.push(new RegExp(`\\b${drizzleTable}\\.${camel}\\b`));
  return pats;
}

const files = walk(srcRoot).filter((p) => !p.includes(`${join('lib', 'migrations')}`));
const violations = [];

for (const entry of manifest) {
  const { table, column, migration } = entry;
  const patterns = patternsForDrop(table, column);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('--') || trimmed.startsWith('*')) continue;
      if (!patterns.some((p) => p.test(line))) continue;
      violations.push({
        table,
        column,
        migration,
        file: relative(repoRoot, file),
        line: i + 1,
      });
      break;
    }
  }
}

if (violations.length === 0) {
  console.log(`schema-drift-guard: OK (${manifest.length} guarded column(s))`);
  process.exit(0);
}

console.error(`schema-drift-guard: ${violations.length} stale reference(s):\n`);
for (const v of violations) {
  console.error(`  • ${v.table}.${v.column} (dropped in ${v.migration}) → ${v.file}:${v.line}`);
}
process.exit(check ? 1 : 0);
