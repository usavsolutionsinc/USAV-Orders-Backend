/** Shared empty/centered states for the sourcing panes. */

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="p-10 text-center text-sm text-text-faint">{children}</div>;
}

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-faint shadow-sm">{icon}</div>
        <p className="text-sm font-bold text-text-muted">{title}</p>
        <p className="text-caption text-text-soft">{hint}</p>
      </div>
    </div>
  );
}
