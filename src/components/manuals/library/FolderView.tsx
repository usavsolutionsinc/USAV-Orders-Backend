import { Search } from '@/components/Icons';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import type { FolderNode, ManualRow, SearchResults as SearchResultsData } from './manuals-tree';
import { FolderButton } from './FolderButton';
import { FileButton } from './FileButton';

interface SharedRowProps {
  selectedId: number | null;
  onSelectFile: (id: number) => void;
  onRenameFolder: (path: string, count: number) => void;
  selection: Set<number>;
  onToggleSelect: (id: number, additive: boolean) => void;
  onDropManuals: (ids: number[], folderPath: string) => void;
  onDropFiles: (files: File[], folderPath: string) => void;
}

/** Browse view — subfolders + files for the current breadcrumb folder. */
export function FolderView({
  subfolders, files, onEnter, ...shared
}: SharedRowProps & {
  subfolders: FolderNode[];
  files: ManualRow[];
  onEnter: (segment: string) => void;
}) {
  const { selectedId, onSelectFile, onRenameFolder, selection, onToggleSelect, onDropManuals, onDropFiles } = shared;
  return (
    <div className="space-y-3">
      {subfolders.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-text-faint">
            Folders · {subfolders.length}
          </p>
          {subfolders.map((node) => (
            <FolderButton
              key={node.name}
              node={node}
              onEnter={() => onEnter(node.name)}
              onRename={() => onRenameFolder(node.path.join('/'), node.totalCount)}
              onDropManuals={(ids) => onDropManuals(ids, node.path.join('/'))}
              onDropFiles={(f) => onDropFiles(f, node.path.join('/'))}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-text-faint">
            Files · {files.length}
          </p>
          {files.map((f) => (
            <FileButton
              key={f.id}
              manual={f}
              isSelected={f.id === selectedId}
              onClick={() => onSelectFile(f.id)}
              isChecked={selection.has(f.id)}
              onToggleCheck={(additive) => onToggleSelect(f.id, additive)}
              selection={selection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Search view — fuzzy folder + file hits (capped) with highlight indices. */
export function SearchResults({
  results, onOpenFolder, ...shared
}: SharedRowProps & {
  results: SearchResultsData;
  onOpenFolder: (node: FolderNode) => void;
}) {
  const { selectedId, onSelectFile, onRenameFolder, selection, onToggleSelect, onDropManuals, onDropFiles } = shared;
  const { folderHits, fileHits } = results;
  if (folderHits.length === 0 && fileHits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Search className="mb-3 h-8 w-8 text-text-faint" />
        <p className={`${tableHeader} text-text-soft`}>No matches</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {folderHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-text-faint">
            Folders · {folderHits.length}
          </p>
          {folderHits.slice(0, 50).map((hit) => (
            <FolderButton
              key={hit.node.path.join('/')}
              node={hit.node}
              highlight={{ label: hit.label, indices: hit.indices }}
              onEnter={() => onOpenFolder(hit.node)}
              onRename={() => onRenameFolder(hit.node.path.join('/'), hit.node.totalCount)}
              onDropManuals={(ids) => onDropManuals(ids, hit.node.path.join('/'))}
              onDropFiles={(f) => onDropFiles(f, hit.node.path.join('/'))}
            />
          ))}
        </div>
      )}
      {fileHits.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-text-faint">
            Files · {fileHits.length}
          </p>
          {fileHits.slice(0, 100).map((hit) => (
            <FileButton
              key={hit.manual.id}
              manual={hit.manual}
              isSelected={hit.manual.id === selectedId}
              highlight={{ label: hit.label, indices: hit.indices }}
              onClick={() => onSelectFile(hit.manual.id)}
              isChecked={selection.has(hit.manual.id)}
              onToggleCheck={(additive) => onToggleSelect(hit.manual.id, additive)}
              selection={selection}
            />
          ))}
        </div>
      )}
    </div>
  );
}
