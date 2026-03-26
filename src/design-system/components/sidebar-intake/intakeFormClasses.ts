/** Shared with `ShippedIntakeForm` and FBA create shipment — keep in sync. */

export const SIDEBAR_INTAKE_LABEL_CLASS =
  'block text-[10px] font-black uppercase tracking-widest text-gray-700';

export const SIDEBAR_INTAKE_INPUT_CLASS =
  'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all';

export const SIDEBAR_INTAKE_INPUT_MONO_CLASS = `${SIDEBAR_INTAKE_INPUT_CLASS} font-mono`.trim();

export const SIDEBAR_INTAKE_SELECT_CLASS = SIDEBAR_INTAKE_INPUT_CLASS;

export const SIDEBAR_INTAKE_CLOSE_BUTTON_CLASS =
  'p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all';

export const SIDEBAR_INTAKE_SUBMIT_BUTTON_CLASS =
  'w-full px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:bg-gray-300 text-white rounded-xl transition-all text-xs font-black uppercase tracking-wide disabled:cursor-not-allowed shadow-lg shadow-green-500/20';

export const SIDEBAR_INTAKE_SUBTITLE_ACCENT: Record<
  'green' | 'violet' | 'blue' | 'purple' | 'yellow' | 'black' | 'red' | 'lightblue' | 'pink',
  string
> = {
  green: 'text-[8px] font-bold text-green-600 uppercase tracking-widest',
  violet: 'text-[8px] font-bold text-violet-600 uppercase tracking-widest',
  blue: 'text-[8px] font-bold text-blue-600 uppercase tracking-widest',
  purple: 'text-[8px] font-bold text-purple-600 uppercase tracking-widest',
  yellow: 'text-[8px] font-bold text-amber-600 uppercase tracking-widest',
  black: 'text-[8px] font-bold text-slate-700 uppercase tracking-widest',
  red: 'text-[8px] font-bold text-red-600 uppercase tracking-widest',
  lightblue: 'text-[8px] font-bold text-sky-600 uppercase tracking-widest',
  pink: 'text-[8px] font-bold text-pink-600 uppercase tracking-widest',
};
