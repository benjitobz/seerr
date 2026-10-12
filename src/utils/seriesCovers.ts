import type { Series } from '@server/models/Series';

const getSeriesCovers = (series?: Series): string[] => [
  ...new Set(
    (series?.books ?? [])
      .filter((book) => !book.extra)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((book) => book.posterPath)
      .filter(
        (cover): cover is string =>
          !!cover && !cover.includes('/static/covers/')
      )
  ),
];

export default getSeriesCovers;
