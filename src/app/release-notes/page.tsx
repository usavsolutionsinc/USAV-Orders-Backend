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
  docs:        { label: 'Docs',        chip: 'bg-slate-100 text-slate-700 ring-slate-200' },
  chore:       { label: 'Chore',       chip: 'bg-gray-100 text-gray-600 ring-gray-200' },
  test:        { label: 'Test',        chip: 'bg-gray-100 text-gray-600 ring-gray-200' },
  other:       { label: 'Update',      chip: 'bg-gray-100 text-gray-600 ring-gray-200' },
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
    <div className="flex h-full w-full bg-gray-50">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <header className="mb-8">
            <p className="text-eyebrow font-black uppercase tracking-[0.25em] text-blue-600">
              What&apos;s new
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
              Release Notes
            </h1>
            <p className="mt-2 text-sm text-gray-600">
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
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <p className="text-sm text-gray-500">No release notes yet.</p>
            </div>
          ) : (
            <div className="space-y-10">
              {groups.map(({ month, commits }) => (
                <section key={month}>
                  <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
                    {month}
                  </h2>
                  <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
                    {commits.map((c) => {
                      const style = TYPE_STYLES[c.type] ?? TYPE_STYLES.other;
                      return (
                        <li key={c.sha} className="px-4 py-4 sm:px-5">
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${style.chip}`}
                            >
                              {style.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-900 break-words">
                                {c.title}
                              </p>
                              {c.body ? (
                                <p className="mt-1 whitespace-pre-line text-xs text-gray-600 break-words">
                                  {c.body}
                                </p>
                              ) : null}
                              <p className="mt-1.5 text-[11px] text-gray-500">
                                <time dateTime={c.date}>{dayLabel(c.date)}</time>
                                <span className="mx-1.5 text-gray-300">·</span>
                                <span>{c.author}</span>
                                <span className="mx-1.5 text-gray-300">·</span>
                                <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-600">
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
