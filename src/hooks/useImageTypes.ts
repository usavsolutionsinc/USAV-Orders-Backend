'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuiltInImageType, CustomImageType } from '@/lib/photos/image-types';

interface ImageTypesResponse {
  builtIn: BuiltInImageType[];
  custom: CustomImageType[];
}

const QUERY_KEY = ['photo-image-types'];

/** Built-in image-type scopes + the org's custom types, with a create mutation. */
export function useImageTypes() {
  const queryClient = useQueryClient();

  const query = useQuery<ImageTypesResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/photos/image-types', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load image types');
      return res.json() as Promise<ImageTypesResponse>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const createType = useMutation({
    mutationFn: async (input: { label: string; icon?: string | null }) => {
      const res = await fetch('/api/photos/image-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as
        | { imageType?: CustomImageType; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to create image type');
      return data!.imageType!;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    builtIn: query.data?.builtIn ?? [],
    custom: query.data?.custom ?? [],
    isLoading: query.isLoading,
    createType,
  };
}
