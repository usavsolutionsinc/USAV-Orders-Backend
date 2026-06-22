/** The square zone-letter badge (or an amber "?" when no letter is assigned). */
export function ZoneLetterTile({ letter }: { letter: string | undefined }) {
  if (letter) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/70 font-mono text-xl font-semibold text-blue-700 ring-1 ring-blue-200">
        {letter}
      </div>
    );
  }
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 font-mono text-lg font-semibold text-amber-700 ring-1 ring-amber-200"
      title="No zone letter assigned yet — go to the Rooms tab"
    >
      ?
    </div>
  );
}
