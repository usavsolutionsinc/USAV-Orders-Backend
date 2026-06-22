'use client';

/**
 * CRUD modal set for the manuals library.
 *
 *   - <UploadManualModal>      — new upload, OR replace if `replaceTarget` given.
 *                                Multipart POST to /api/product-manuals/upload.
 *   - <EditManualModal>        — metadata edit (display name, folder, type,
 *                                status, sku, item number). PATCH JSON to
 *                                /api/product-manuals.
 *   - <RenameFolderModal>      — rename or move a folder. POST to
 *                                /api/product-manuals/rename-folder.
 *
 * All three dispatch a `manuals-updated` window event on success so the
 * `LibraryBrowser` refetches without prop-drilling.
 *
 * Thin re-export barrel: the shared modal shell + primitives live in
 * `./manual-crud/manual-crud-shared`; each modal is its own file under
 * `./manual-crud/`. Importers keep the original `ManualCrudModals` path.
 */

export { dispatchManualsUpdated } from './manual-crud/manual-crud-shared';
export { UploadManualModal, type ReplaceTarget } from './manual-crud/UploadManualModal';
export { EditManualModal, type EditManualTarget } from './manual-crud/EditManualModal';
export { RenameFolderModal } from './manual-crud/RenameFolderModal';
