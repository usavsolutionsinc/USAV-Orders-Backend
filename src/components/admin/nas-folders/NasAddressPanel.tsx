import { nasConfigured } from '@/lib/nas-photos';
import { Button } from '@/design-system/primitives';
import type { StationNasFoldersController } from './useStationNasFolders';

/** NAS server address panel — test/prod URLs + active toggle. */
export function NasAddressPanel({ c }: { c: StationNasFoldersController }) {
  const { servers, setServers, serversDirty, saveServers, isLoading } = c;
  return (
    <>
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-label font-black text-gray-800">NAS address</p>
            <p className="mt-0.5 text-micro text-gray-400">
              Base URL of the NAS file server (Cloudflare-fronted, no trailing slash). Photos are
              written and read against the active one.
            </p>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200">
            {(['test', 'prod'] as const).map((slot) => (
              // ds-raw-button: segmented test/prod active-slot toggle (conditional fill), not a single DS variant
              <button
                key={slot}
                type="button"
                onClick={() => setServers((p) => ({ ...p, active: slot }))}
                className={`px-3 py-1.5 text-micro font-black uppercase tracking-widest transition-colors ${
                  servers.active === slot ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {slot === 'test' ? 'Testing' : 'Production'}
              </button>
            ))}
          </div>
        </div>

        {(['prod', 'test'] as const).map((slot) => (
          <div key={slot} className="flex items-center gap-3">
            <div className="w-24 shrink-0">
              <p className="text-label font-black text-gray-800">{slot === 'prod' ? 'Production' : 'Testing'}</p>
              {servers.active === slot ? (
                <span className="text-micro font-black uppercase tracking-widest text-emerald-600">● Active</span>
              ) : null}
            </div>
            <input
              type="url"
              inputMode="url"
              value={servers[slot]}
              onChange={(e) => setServers((p) => ({ ...p, [slot]: e.target.value }))}
              placeholder="https://nas.example.com"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        ))}

        <div className="flex items-center justify-end gap-3">
          {serversDirty ? <span className="text-micro font-bold uppercase tracking-widest text-amber-600">Unsaved changes</span> : null}
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={!serversDirty || saveServers.isPending || isLoading}
            onClick={() => saveServers.mutate(servers)}
          >
            {saveServers.isPending ? 'Saving…' : 'Save address'}
          </Button>
        </div>
      </div>

      {!nasConfigured() ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-caption font-semibold text-amber-800">
          No active NAS address is set, so phones can’t save photos and Browse is unavailable. Enter
          the {servers.active === 'test' ? 'Testing' : 'Production'} URL above and Save.
        </div>
      ) : null}
    </>
  );
}
