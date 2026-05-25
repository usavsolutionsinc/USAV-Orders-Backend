#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outFile = resolve(repoRoot, 'src/data/release-notes.json');

const MAX_COMMITS = Number(process.env.RELEASE_NOTES_LIMIT) || 200;

const SEP = '';
const REC = '';
const FORMAT = ['%H', '%h', '%aI', '%an', '%s', '%b'].join(SEP) + REC;

const SKIP_PREFIXES = ['merge ', 'wip', 'chore: format', 'chore(format)'];

function readLog() {
  try {
    return execSync(
      `git log -n ${MAX_COMMITS} --no-merges --pretty=format:'${FORMAT}'`,
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    console.warn('[release-notes] git log failed, writing empty list:', err.message);
    return '';
  }
}

function classify(subject) {
  const s = subject.toLowerCase();
  if (s.startsWith('feat')) return 'feature';
  if (s.startsWith('fix')) return 'fix';
  if (s.startsWith('perf')) return 'performance';
  if (s.startsWith('refactor')) return 'refactor';
  if (s.startsWith('docs')) return 'docs';
  if (s.startsWith('chore')) return 'chore';
  if (s.startsWith('test')) return 'test';
  return 'other';
}

function stripPrefix(subject) {
  return subject.replace(/^(feat|fix|perf|refactor|docs|chore|test|build|ci|style)(\([^)]+\))?:\s*/i, '');
}

function shouldSkip(subject) {
  const s = subject.toLowerCase().trim();
  return SKIP_PREFIXES.some((p) => s.startsWith(p));
}

const raw = readLog();
const commits = raw
  .split(REC)
  .map((rec) => rec.replace(/^\n/, '').trim())
  .filter(Boolean)
  .map((rec) => {
    const [sha, shortSha, date, author, subject, body] = rec.split(SEP);
    return {
      sha,
      shortSha,
      date,
      author,
      subject: subject || '',
      body: (body || '').trim(),
      type: classify(subject || ''),
      title: stripPrefix(subject || ''),
    };
  })
  .filter((c) => c.sha && !shouldSkip(c.subject));

const payload = {
  generatedAt: new Date().toISOString(),
  count: commits.length,
  commits,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');
console.log(`[release-notes] wrote ${commits.length} entries to ${outFile}`);
