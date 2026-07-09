import { redirect } from 'next/navigation';

/** Legacy `/gallery` URL — forwards to unified photos route. */
export default async function ReceivingGalleryRedirect(
  props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const qs = new URLSearchParams();
  qs.set('mode', 'gallery');
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'mode' || value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.set(key, value);
  }
  const query = qs.toString();
  redirect(`/m/r/${encodeURIComponent(id)}/photos${query ? `?${query}` : ''}`);
}
