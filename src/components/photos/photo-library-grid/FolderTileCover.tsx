import { Folder } from '@/components/Icons';
import type { LibraryPhoto } from '../photo-library-types';
import { PhotoThumb } from '../PhotoThumb';

/** PO/ticket folder preview — first photo in the group, or a static folder icon. */
export function FolderTileCover({ photo }: { photo?: LibraryPhoto }) {
  if (photo) {
    return <PhotoThumb src={photo.thumbUrl} alt="" ratio="fill" />;
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200/80"
      aria-hidden="true"
    >
      <Folder className="h-8 w-8 text-text-faint" />
    </div>
  );
}
