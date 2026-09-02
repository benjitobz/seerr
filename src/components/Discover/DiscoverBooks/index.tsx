import HardcoverSetup from '@app/components/Common/HardcoverSetup';
import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import MediaSlider from '@app/components/MediaSlider';
import useDiscover from '@app/hooks/useDiscover';
import defineMessages from '@app/utils/defineMessages';
import type { BookResult } from '@server/models/Search';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverBooks', {
  discoverbooks: 'Books',
  trending: 'Trending',
});

export const bookGenres = [
  { slug: 'fantasy', name: 'Fantasy' },
  { slug: 'science-fiction', name: 'Science Fiction' },
  { slug: 'romance', name: 'Romance' },
  { slug: 'mystery', name: 'Mystery' },
  { slug: 'thriller', name: 'Thriller' },
  { slug: 'horror', name: 'Horror' },
  { slug: 'historical-fiction', name: 'Historical Fiction' },
  { slug: 'young-adult', name: 'Young Adult' },
  { slug: 'classics', name: 'Classics' },
  { slug: 'nonfiction', name: 'Nonfiction' },
  { slug: 'biography', name: 'Biography' },
];

const DiscoverBooks = () => {
  const intl = useIntl();

  const { error } = useDiscover<BookResult>('/api/v1/discover/books');

  if ((error as any)?.response?.status === 503) {
    return <HardcoverSetup />;
  }

  const title = intl.formatMessage(messages.discoverbooks);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
      </div>
      <MediaSlider
        sliderKey="books-trending"
        title={intl.formatMessage(messages.trending)}
        url="/api/v1/discover/books"
      />
      {bookGenres.map((genre) => (
        <MediaSlider
          key={genre.slug}
          sliderKey={`books-genre-${genre.slug}`}
          title={genre.name}
          url={`/api/v1/discover/books/genre/${genre.slug}`}
          linkUrl={`/discover/books/genre/${genre.slug}`}
        />
      ))}
    </>
  );
};

export default DiscoverBooks;
