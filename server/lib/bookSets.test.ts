import type Hardcover from '@server/api/hardcover';
import type { HardcoverBookDetails } from '@server/api/hardcover/interfaces';
import {
  matchSeries,
  parseBookSet,
  resolveBookSetMembers,
} from '@server/lib/bookSets';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('parseBookSet', () => {
  it('reads a numbered range', () => {
    assert.deepEqual(parseBookSet('The Slough House Thrillers Books 1-3'), {
      from: 1,
      to: 3,
    });
    assert.deepEqual(parseBookSet('Red Rising Saga: Books 4 to 6'), {
      from: 4,
      to: 6,
    });
    assert.deepEqual(parseBookSet('Mistborn 1-3 Box Set'), { from: 1, to: 3 });
  });

  it('treats a set with no numbers as the whole series', () => {
    assert.equal(parseBookSet('The Expanse Complete Series'), 'all');
    assert.equal(parseBookSet('Dune Boxed Set'), 'all');
    assert.equal(parseBookSet('The Lord of the Rings Omnibus'), 'all');
  });

  it('leaves ordinary titles alone', () => {
    assert.equal(parseBookSet('Slough House'), null);
    assert.equal(parseBookSet('Book 1 of the Hunger Games Trilogy'), null);
    assert.equal(parseBookSet('Catch-22'), null);
    assert.equal(parseBookSet('The Collector'), null);
  });
});

describe('matchSeries', () => {
  const series = [
    { id: 1, name: 'Slough House', primary_books_count: 9 },
    { id: 2, name: 'Слау-хаус', primary_books_count: null },
    { id: 3, name: 'Zoe Boehm Thrillers', primary_books_count: 1 },
  ];

  it('picks the series named in the title', () => {
    assert.equal(
      matchSeries('The Slough House Thrillers Books 1-3', series)?.id,
      1
    );
  });

  it('prefers the longest matching name', () => {
    const nested = [
      { id: 1, name: 'Dune', primary_books_count: 6 },
      { id: 2, name: 'Dune Chronicles', primary_books_count: 6 },
    ];
    assert.equal(matchSeries('Dune Chronicles Books 1-3', nested)?.id, 2);
  });

  it('matches nothing when no name appears', () => {
    assert.equal(
      matchSeries('Standalone Thrillers Box Set', series),
      undefined
    );
  });
});

describe('resolveBookSetMembers', () => {
  const book = {
    id: 99,
    title: 'The Slough House Thrillers Books 1-3',
    contributions: [{ id: 1, author: { id: 7 } }],
    book_series: [],
  } as unknown as HardcoverBookDetails;

  const hardcover = {
    getAuthorSeries: async () => [
      { id: 1, name: 'Slough House', primary_books_count: 9 },
    ],
    getSeries: async () => ({
      id: 1,
      name: 'Slough House',
      book_series: [
        { position: 1, book: { id: 11 } },
        { position: 1.5, book: { id: 15 } },
        { position: 2, book: { id: 12 } },
        { position: 3, book: { id: 13 } },
        { position: 4, book: { id: 14 } },
      ],
    }),
  } as unknown as Hardcover;

  it('returns the books at whole positions inside the range', async () => {
    assert.deepEqual(
      await resolveBookSetMembers(hardcover, book, { from: 1, to: 3 }),
      [11, 12, 13]
    );
  });

  it('returns every primary book for a whole-series set', async () => {
    assert.deepEqual(
      await resolveBookSetMembers(hardcover, book, 'all'),
      [11, 12, 13, 14]
    );
  });
});
