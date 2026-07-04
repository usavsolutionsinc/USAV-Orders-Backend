import type { FolderNode, ManualRow } from './manuals-library-shared';
import { FolderButton, FileButton } from './ManualButtons';

export function FolderView({
  subfolders,
  files,
  selectedId,
  onEnter,
  onSelectFile,
}: {
  subfolders: FolderNode[];
  files: ManualRow[];
  selectedId: number | null;
  onEnter: (segment: string) => void;
  onSelectFile: (id: number) => void;
}) {
  return (
    <div className="space-y-3">
      {subfolders.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-2 text-eyebrow font-black uppercase tracking-wider text-text-faint">
            Folders · {subfolders.length}
          </p>
          {subfolders.map((node) => (
            <FolderButton key={node.name} node={node} onEnter={() => onEnter(node.name)} />
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
