import { Search } from '@/components/Icons';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import type { FolderNode, SearchResultsData } from './manuals-library-shared';
import { FolderButton, FileButton } from './ManualButtons';

export function SearchResults({
  results,
  selectedId,
  onSelectFile,
  onOpenFolder,
}: {
  results: SearchResultsData;
  selectedId: number | null;
  onSelectFile: (id: number) => void;
  onOpenFolder: (node: FolderNode) => void;
}) {
  const { folderHits, fileHits } = results;
  if (folderHits.length === 0 && fileHits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Search className="mb-3 h-8 w-8 text-gray-300" />
        <p className={`${tableHeader} text-gray-500`}>No matches</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {folderHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Folders · {folderHits.length}
          </p>
          {folderHits.slice(0, 50).map((hit) => (
            <FolderButton
              key={hit.node.path.join('/')}
              node={hit.node}
              highlight={{ label: hit.label, indices: hit.indices }}
              onEnter={() => onOpenFolder(hit.node)}
            />
          ))}
        </div>
      )}
      {fileHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-gray-400">
            Files · {fileHits.length}
          </p>
          {fileHits.slice(0, 100).map((hit) => (
            <FileButton
              key={hit.manual.id}
              manual={hit.manual}
              isSelected={hit.manual.id === selectedId}
              highlight={{ label: hit.label, indices: hit.indices }}
              onClick={() => onSelectFile(hit.manual.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
