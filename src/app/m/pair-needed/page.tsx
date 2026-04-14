export default function PairNeededPage() {
  return (
    <div className="min-h-dvh w-full bg-gray-950 text-white flex flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-black uppercase tracking-widest text-white/80">
        Not paired
      </p>
      <p className="mt-2 text-xs text-white/60 max-w-xs">
        Open the desktop receiving app, click “Pair phone”, and scan the QR code that appears.
      </p>
    </div>
  );
}
