'use client';

/**
 * Shared "deep folder navigation" chrome for the NAS photo browser, styled to
 * match the manuals/library file browser (src/components/manuals/LibraryBrowser):
 * a clickable breadcrumb trail + card-style folder rows with a folder glyph and
 * a hover chevron. Used by BOTH the receiving "Select from NAS" picker dialog
 * and the /photos preview page so the two stay visually identical.
 *
 * The NAS browser loads one directory at a time (the file server is an nginx
 * autoindex), so unlike the manuals tree these helpers work off a single
 * `dir` relPath string ("" = root, "JAN 2026", "JAN 2026/sub", …) and a
 * navigate callback, rather than a prebuilt tree.
 */

function FolderIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function ChevronRightTiny({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeftTiny({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/** The two surfaces this renders on: white dialog vs. dark preview page. */
type Tone = 'light' | 'dark';

/**
 * Breadcrumb trail. Renders nothing at the root (matching the manuals
 * browser, which only shows the trail once you're inside a folder).
 * Each crumb navigates to that depth; the leading button jumps to root.
 */
export function NasBreadcrumb({
  dir,
  onNavigate,
  tone = 'light',
  rootLabel = 'All',
}: {
  /** Current relative dir ("" = root, "JAN 2026", "JAN 2026/sub"). */
  dir: string;
  /** Navigate to a relative dir ("" = root). */
  onNavigate: (relDir: string) => void;
  tone?: Tone;
  rootLabel?: string;
}) {
  const segments = dir.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const dark = tone === 'dark';

  const crumbBase =
    'shrink-0 rounded-lg px-2 py-1 text-micro font-black uppercase tracking-wider transition-colors';
  const inactive = dark
    ? 'text-white/60 hover:bg-white/10 hover:text-white'
    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700';
  const active = dark ? 'bg-white text-black' : 'bg-gray-900 text-white';

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {/* ds-raw-button: breadcrumb root nav crumb — not a DS Button */}
      <button type="button" onClick={() => onNavigate('')} className={`ds-raw-button flex items-center gap-1 ${crumbBase} ${inactive}`}>
        <ChevronLeftTiny className="h-3 w-3" />
        {rootLabel}
      </button>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex shrink-0 items-center gap-1">
            <ChevronRightTiny className={`h-2.5 w-2.5 ${dark ? 'text-white/25' : 'text-gray-300'}`} />
            {/* ds-raw-button: breadcrumb depth nav crumb (active = current depth) — not a DS Button */}
            <button
              type="button"
              onClick={() => onNavigate(segments.slice(0, i + 1).join('/'))}
              className={`ds-raw-button ${crumbBase} ${isLast ? active : inactive}`}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * A single folder row, card-styled like the manuals folder buttons.
 */
export function NasFolderCard({
  name,
  onOpen,
  tone = 'light',
}: {
  name: string;
  onOpen: () => void;
  tone?: Tone;
}) {
  const dark = tone === 'dark';
  return (
    // ds-raw-button: card-style folder row tile (group hover, icon + chevron) — not a DS Button
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open folder ${name}`}
      className={`ds-raw-button group flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-sm ${
        dark
          ? 'border-white/10 bg-white/[0.04] hover:border-indigo-400/40 hover:bg-white/[0.07]'
          : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
          dark
            ? 'bg-indigo-500/10 text-indigo-300 ring-indigo-400/20 group-hover:text-indigo-200'
            : 'bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500 ring-indigo-100 group-hover:from-indigo-100 group-hover:to-violet-100 group-hover:text-indigo-600'
        }`}
      >
        <FolderIcon className="h-4 w-4" />
      </span>
      <span className={`min-w-0 flex-1 truncate text-label font-black ${dark ? 'text-white' : 'text-gray-900'}`}>
        {name}
      </span>
      <ChevronRightTiny
        className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 ${
          dark ? 'text-white/30 group-hover:text-indigo-300' : 'text-gray-300 group-hover:text-indigo-400'
        }`}
      />
    </button>
  );
}

/** Eyebrow label above a section ("Folders · 3", "Photos · 24"). */
export function NasSectionLabel({ children, tone = 'light' }: { children: React.ReactNode; tone?: Tone }) {
  const dark = tone === 'dark';
  return (
    <p className={`px-1 text-eyebrow font-black uppercase tracking-wider ${dark ? 'text-white/40' : 'text-gray-400'}`}>
      {children}
    </p>
  );
}
