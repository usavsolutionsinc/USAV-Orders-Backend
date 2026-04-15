export default function PairNeededPage() {
  return (
    <div className="min-h-dvh w-full bg-white text-gray-900 flex flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-black uppercase tracking-widest text-gray-700">
        Not paired
      </p>
      <p className="mt-2 text-xs text-gray-500 max-w-xs">
        Open the desktop receiving app, click “Pair phone”, and scan the QR code that appears.
      </p>
    </div>
  );
}
