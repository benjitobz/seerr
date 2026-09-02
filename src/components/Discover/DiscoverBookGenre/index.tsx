import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { BookResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverBookGenre', {
  genreBooks: '{genre} Books',
});

const DiscoverBookGenre = () => {
  const intl = useIntl();
  const router = useRouter();
  const genreSlug = router.query.genreSlug as string;

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<BookResult>(`/api/v1/discover/books/genre/${genreSlug}`);

  if (error) {
    return <Error statusCode={500} />;
  }

  const genreName = genreSlug
    ? genreSlug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    : '';

  const title = intl.formatMessage(messages.genreBooks, { genre: genreName });

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default DiscoverBookGenre;
