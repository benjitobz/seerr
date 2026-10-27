import type Hardcover from '@server/api/hardcover';
import type { HardcoverBookDetails } from '@server/api/hardcover/interfaces';

export type BookSetRange = { from: number; to: number } | 'all';

const NUMBERED_RANGE =
  /\b(?:books?|vol(?:ume)?s?\.?|novels?)\s*#?\s*(\d{1,3})\s*(?:-|–|—|to|through|thru|&|and|\+)\s*(\d{1,3})\b/i;
const LEADING_RANGE =
  /\b(\d{1,3})\s*(?:-|–|—|to|through|thru|&|and|\+)\s*(\d{1,3})\s*(?:books?|box(?:ed)?\s*set|collection|bundle)\b/i;
const WHOLE_SET =
  /\b(?:box(?:ed)?\s*set|complete\s+(?:series|collection)|omnibus|bundle|\d+\s*-?\s*books?\s+(?:set|collection|bundle))\b/i;

export const parseBookSet = (title: string): BookSetRange | null => {
  const range = title.match(NUMBERED_RANGE) ?? title.match(LEADING_RANGE);

  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);

    return from < to ? { from, to } : null;
  }

  return WHOLE_SET.test(title) ? 'all' : null;
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const matchSeries = <
  T extends { name: string; primary_books_count: number | null },
>(
  title: string,
  series: T[]
): T | undefined => {
  const haystack = ` ${normalize(title)} `;

  return series
    .filter((candidate) => {
      const name = normalize(candidate.name);

      return (
        (candidate.primary_books_count ?? 0) > 0 &&
        name.length >= 3 &&
        haystack.includes(` ${name} `)
      );
    })
    .sort((a, b) => b.name.length - a.name.length)[0];
};

export const resolveBookSetMembers = async (
  hardcover: Hardcover,
  book: HardcoverBookDetails,
  range: BookSetRange
): Promise<number[]> => {
  const authorId = book.contributions[0]?.author?.id;
  const series = matchSeries(book.title, [
    ...book.book_series.map((bookSeries) => bookSeries.series),
    ...(authorId ? await hardcover.getAuthorSeries(authorId) : []),
  ]);

  if (!series) {
    return [];
  }

  return (await hardcover.getSeries(series.id)).book_series
    .filter((bookSeries) => {
      const position = Number(bookSeries.position);

      return (
        Number.isInteger(position) &&
        bookSeries.book.id !== book.id &&
        (range === 'all' || (position >= range.from && position <= range.to))
      );
    })
    .map((bookSeries) => bookSeries.book.id);
};
