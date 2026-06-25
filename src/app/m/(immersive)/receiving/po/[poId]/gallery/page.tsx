import { redirect } from 'next/navigation';

export default async function MobilePoGalleryRedirect(
  props: { params: Promise<{ poId: string }> },
) {
  const { poId } = await props.params;
  redirect(`/m/receiving/po/${encodeURIComponent(poId)}/photos?mode=gallery`);
}
