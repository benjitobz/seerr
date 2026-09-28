import type { HardcoverSeries } from '@server/api/hardcover/interfaces';
import { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { BookResult } from './Search';
import { mapBookResult } from './Search';

export interface Series {
  id: number;
  name: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  books: BookResult[];
}

export const mapSeries = (series: HardcoverSeries, media: Media[]): Series => ({
  id: series.id,
  name: series.name,
  overview: series.description,
  // Hardcover numbers dramatized adaptations, split editions and bonus
  // chapters off the book they belong to, so a fractional position marks an
  // edition or extra rather than one of the series' own books
  books: series.book_series.map((book_series) => ({
    ...mapBookResult(
      book_series.book,
      media?.find(
        (req) =>
          req.tmdbId === book_series.book.id && req.mediaType === MediaType.BOOK
      ),
      book_series.position
    ),
    extra: !Number.isInteger(Number(book_series.position)),
  })),
});
