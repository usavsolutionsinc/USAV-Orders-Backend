import releaseNotesData from '@/data/release-notes.json';

type ChangeType = 'feature' | 'fix' | 'performance' | 'refactor' | 'docs' | 'chore' | 'test' | 'other';

interface Commit {
  sha: string;
  shortSha: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  type: ChangeType;
  title: string;
}

interface ReleaseNotesPayload {
  generatedAt: string;
  count: number;
  commits: Commit[];
}

const TYPE_STYLES: Record<ChangeType, { label: string; chip: string }> = {
  feature:     { label: 'New',         chip: 'bg-blue-100 text-blue-700 ring-blue-200' },
  fix:         { label: 'Fix',         chip: 'bg-amber-100 text-amber-800 ring-amber-200' },
  performance: { label: 'Performance', chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  refactor:    { label: 'Refactor',    chip: 'bg-violet-100 text-violet-700 ring-violet-200' },
  docs:        { label: 'Docs',        chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
  chore:       { label: 'Chore',       chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
  test:        { label: 'Test',        chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
  other:       { label: 'Update',      chip: 'bg-surface-sunken text-text-muted ring-border-soft' },
};

function monthKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupByMonth(commits: Commit[]): Array<{ month: string; commits: Commit[] }> {
  const map = new Map<string, Commit[]>();
  for (const c of commits) {
    const key = monthKey(c.date);
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([month, commits]) => ({ month, commits }));
}

export const metadata = {
  title: 'Release Notes',
  description: 'Recent changes to the platform — updated each deploy.',
};

export default function ReleaseNotesPage() {
  const data = releaseNotesData as ReleaseNotesPayload;
  const groups = groupByMonth(data.commits);
  const generated = new Date(data.generatedAt);

  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <header className="mb-8">
            <p className="text-eyebrow font-black uppercase tracking-[0.25em] text-blue-600">
              What&apos;s new
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-text-default sm:text-4xl">
              Release Notes
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              {data.count} {data.count === 1 ? 'change' : 'changes'} · last updated{' '}
              <time dateTime={data.generatedAt}>
                {generated.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </p>
          </header>

          {groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-default bg-surface-card p-10 text-center">
              <p className="text-sm text-text-soft">No release notes yet.</p>
            </div>
          ) : (
            <div className="space-y-10">
              {groups.map(({ month, commits }) => (
                <section key={month}>
                  <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-soft">
                    {month}
                  </h2>
                  <ul className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card divide-y divide-border-hairline">
                    {commits.map((c) => {
                      const style = TYPE_STYLES[c.type] ?? TYPE_STYLES.other;
                      return (
                        <li key={c.sha} className="px-4 py-4 sm:px-5">
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ring-1 ring-inset ${style.chip}`}
                            >
                              {style.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-text-default break-words">
                                {c.title}
                              </p>
                              {c.body ? (
                                <p className="mt-1 whitespace-pre-line text-xs text-text-muted break-words">
                                  {c.body}
                                </p>
                              ) : null}
                              <p className="mt-1.5 text-caption text-text-soft">
                                <time dateTime={c.date}>{dayLabel(c.date)}</time>
                                <span className="mx-1.5 text-text-faint">·</span>
                                <span>{c.author}</span>
                                <span className="mx-1.5 text-text-faint">·</span>
                                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-micro text-text-muted">
                                  {c.shortSha}
                                </code>
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
