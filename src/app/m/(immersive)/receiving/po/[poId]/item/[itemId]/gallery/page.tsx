import { redirect } from 'next/navigation';

export default async function MobileItemGalleryRedirect(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  const { poId, itemId } = await props.params;
  redirect(
    `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/photos?mode=gallery`,
  );
}
