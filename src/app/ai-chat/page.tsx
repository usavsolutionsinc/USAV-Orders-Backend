import { Database, MessageSquare, PackageCheck, Sparkles, Wrench } from '@/components/Icons';

export const metadata = { title: 'AI Chat · USAV' };

const CAPABILITIES = [
  { icon: PackageCheck, title: 'Orders & Shipping', detail: 'Shipped counts, tracking status, packer/tester attribution' },
  { icon: Database, title: 'Staff & FBA & Inventory', detail: 'Staff pace vs goals, FBA shipments, SKU stock levels' },
  { icon: Wrench, title: 'Repairs & Receiving', detail: 'Open tickets, parts-waiting, incoming POs, exceptions' },
  { icon: MessageSquare, title: 'Bose Service Manuals', detail: '480+ manuals — specs, procedures, parts, troubleshooting' },
];

const EXAMPLES = [
  'How many orders shipped last week and by who?',
  'Which open repairs are waiting for parts?',
  'What FBA shipments are currently open?',
  'How do I disassemble a Bose 251 speaker?',
];

/**
 * /ai-chat workspace. The live streaming assistant is docked in the sidebar
 * (AiChatSidebarPanel) — this page frames it with capabilities and example
 * prompts so the assistant feels discoverable. Light theme throughout.
 */
export default function AiChatPage() {
  return (
    <div className="h-full w-full overflow-y-auto bg-gray-50">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">USAV Assistant</h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
          Ask questions about the warehouse in plain English and get concrete, numeric
          answers. The assistant streams its reply and can query live data across orders,
          staff, FBA, inventory, repairs, and the Bose service manuals.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-caption font-medium text-blue-700">
          <MessageSquare className="h-4 w-4" />
          Your assistant is docked in the sidebar — start typing there to chat.
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-gray-900">
                <c.icon className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-semibold tracking-tight">{c.title}</p>
              </div>
              <p className="mt-1.5 text-caption leading-5 text-gray-600">{c.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <p className="text-micro font-black uppercase tracking-[0.2em] text-gray-500">Try asking</p>
          <div className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <div key={e} className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-6 text-gray-700">
                {e}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
