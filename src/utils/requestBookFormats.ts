import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import type { MediaRequest } from '@server/entity/MediaRequest';
import axios from 'axios';
import { mutate } from 'swr';

export interface BookFormatRequestOutcome {
  is4k: boolean;
  request?: MediaRequest;
}

export const requestBookFormats = async (
  mediaId: number,
  formats: boolean[],
  overridesFor?: (is4k: boolean) => RequestOverrides | undefined
): Promise<BookFormatRequestOutcome[]> => {
  const results = await Promise.allSettled(
    formats.map((is4k) => {
      const overrides = overridesFor?.(is4k);

      return axios.post<MediaRequest>('/api/v1/request', {
        mediaId,
        mediaType: 'book',
        is4k,
        serverId: overrides?.server,
        profileId: overrides?.profile,
        metadataProfileId: overrides?.metadataProfile,
        rootFolder: overrides?.folder,
        userId: overrides?.user?.id,
        tags: overrides?.tags,
      });
    })
  );

  mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
  mutate('/api/v1/request/count');

  return results.map((result, index) => ({
    is4k: formats[index],
    request: result.status === 'fulfilled' ? result.value.data : undefined,
  }));
};
