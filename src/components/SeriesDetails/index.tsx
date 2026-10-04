import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import HardcoverSetup from '@app/components/Common/HardcoverSetup';
import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import TitleCard from '@app/components/TitleCard';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { refreshIntervalHelper } from '@app/utils/refreshIntervalHelper';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { MediaStatus, MediaType } from '@server/constants/media';
import type { Series } from '@server/models/Series';
import { useRouter } from 'next/router';
import { Fragment, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.SeriesDetails', {
  overview: 'Overview',
  editionsextras: 'Editions & Extras',
  numberofbooks: '{count} Books',
  requestseries: 'Request Series',
  requestseriesaudio: 'Request Series in Audiobook',
});

interface SeriesDetailsProps {
  series?: Series;
}

const SeriesDetails = ({ series }: SeriesDetailsProps) => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const { hasPermission } = useUser();
  const [requestModal, setRequestModal] = useState(false);

  const returnSeriesDownloadItems = (data: Series | undefined) => {
    const [downloadStatus, downloadStatus4k] = [
      data?.books.flatMap((item) =>
        item.mediaInfo?.downloadStatus ? item.mediaInfo?.downloadStatus : []
      ),
      data?.books.flatMap((item) =>
        item.mediaInfo?.downloadStatus4k ? item.mediaInfo?.downloadStatus4k : []
      ),
    ];

    return { downloadStatus, downloadStatus4k };
  };

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<Series>(`/api/v1/series/${router.query.seriesId}`, {
    fallbackData: series,
    revalidateOnMount: true,
    refreshInterval: refreshIntervalHelper(
      returnSeriesDownloadItems(series),
      15000
    ),
  });

  const [downloadStatus, downloadStatusAudio] = useMemo(() => {
    const downloadItems = returnSeriesDownloadItems(data);
    return [downloadItems.downloadStatus, downloadItems.downloadStatus4k];
  }, [data]);

  const [titles, titlesAudio] = useMemo(() => {
    return [
      data?.books
        .filter((book) => (book.mediaInfo?.downloadStatus ?? []).length > 0)
        .map((title) => title.title),
      data?.books
        .filter((book) => (book.mediaInfo?.downloadStatus4k ?? []).length > 0)
        .map((title) => title.title),
    ];
  }, [data?.books]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if ((error as any)?.response?.status === 503) {
    return <HardcoverSetup />;
  }

  if (!data) {
    return <Error statusCode={404} />;
  }

  // Editions and extras are listed on their own and left out of the series status
  const primaryBooks = data.books.filter((book) => !book.extra);
  const extraBooks = data.books.filter((book) => book.extra);

  const seriesCovers = [
    ...new Set(
      [...primaryBooks]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((book) => book.posterPath)
        .filter(
          (cover): cover is string =>
            !!cover && !cover.includes('/static/covers/')
        )
    ),
  ];

  let collectionStatus = MediaStatus.UNKNOWN;
  let collectionStatusAudio = MediaStatus.UNKNOWN;

  if (
    primaryBooks.every(
      (book) =>
        book.mediaInfo && book.mediaInfo.status === MediaStatus.AVAILABLE
    )
  ) {
    collectionStatus = MediaStatus.AVAILABLE;
  } else if (
    primaryBooks.some(
      (book) =>
        book.mediaInfo && book.mediaInfo.status === MediaStatus.AVAILABLE
    )
  ) {
    collectionStatus = MediaStatus.PARTIALLY_AVAILABLE;
  }

  if (
    primaryBooks.every(
      (book) =>
        book.mediaInfo && book.mediaInfo.status4k === MediaStatus.AVAILABLE
    )
  ) {
    collectionStatusAudio = MediaStatus.AVAILABLE;
  } else if (
    primaryBooks.some(
      (book) =>
        book.mediaInfo && book.mediaInfo.status4k === MediaStatus.AVAILABLE
    )
  ) {
    collectionStatusAudio = MediaStatus.PARTIALLY_AVAILABLE;
  }

  const hasRequestable =
    hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
      type: 'or',
    }) &&
    data.books.filter(
      (book) => !book.mediaInfo || book.mediaInfo.status === MediaStatus.UNKNOWN
    ).length > 0;

  const hasRequestableAudio =
    settings.currentSettings.bookAudioEnabled &&
    hasPermission([Permission.REQUEST_4K, Permission.REQUEST_AUDIO_BOOK], {
      type: 'or',
    }) &&
    data.books.filter(
      (book) =>
        !book.mediaInfo || book.mediaInfo.status4k === MediaStatus.UNKNOWN
    ).length > 0;

  const collectionAttributes: React.ReactNode[] = [];

  collectionAttributes.push(
    intl.formatMessage(messages.numberofbooks, {
      count: primaryBooks.length,
    })
  );

  const bookCards = (list: Series['books']) => (
    <ul className="cards-vertical">
      {list.map((book, index) => (
        <li key={`list-cast-item-${book.id}-${index}`}>
          <TitleCard
            key={book.id}
            id={book.id}
            title={book.title}
            year={book.releaseDate}
            image={book.posterPath}
            summary={book.overview}
            position={book.position}
            mediaType={'book'}
            status={book.mediaInfo?.status}
            status4k={book.mediaInfo?.status4k}
            mediaRequests={book.mediaInfo?.requests}
            canExpand
          />
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="media-page"
      style={{
        height: 493,
      }}
    >
      {data.books && (
        <div className="media-page-bg-image">
          <ImageFader
            isDarker
            cache={'hardcover'}
            backgroundImages={(
              [
                ...new Set(
                  (data.books ?? [])
                    .filter((media) => media.backdropPath)
                    .map((media) => media.backdropPath)
                ),
              ] as string[]
            ).slice(0, 6)}
          />
        </div>
      )}
      <PageTitle title={data.name} />
      <RequestModal
        tmdbId={data.id}
        show={requestModal}
        type="series"
        onComplete={() => {
          revalidate();
          setRequestModal(false);
        }}
        onCancel={() => setRequestModal(false)}
      />
      <div className="media-header">
        <div className="media-poster">
          {seriesCovers.length >= 4 ? (
            <div className="grid grid-cols-2">
              {seriesCovers.slice(0, 4).map((cover) => (
                <CachedImage
                  key={cover}
                  type="hardcover"
                  src={cover}
                  alt=""
                  sizes="50vw"
                  style={{ width: '100%', height: 'auto' }}
                  width={300}
                  height={450}
                  priority
                />
              ))}
            </div>
          ) : (
            <CachedImage
              type="hardcover"
              src={
                seriesCovers[0] ??
                data.posterPath ??
                `https://assets.hardcover.app/static/covers/cover${
                  (data.id % 9) + 1
                }.png`
              }
              alt=""
              sizes="100vw"
              style={{ width: '100%', height: 'auto' }}
              width={600}
              height={900}
              priority
            />
          )}
        </div>
        <div className="media-title">
          <div className="media-status">
            <StatusBadge
              status={collectionStatus}
              downloadItem={downloadStatus}
              title={titles}
              mediaType={MediaType.BOOK}
              alwaysLabelFormat
              inProgress={data.books.some(
                (book) => (book.mediaInfo?.downloadStatus ?? []).length > 0
              )}
            />
            {settings.currentSettings.bookAudioEnabled &&
              hasPermission(
                [Permission.REQUEST_4K, Permission.REQUEST_AUDIO_BOOK],
                {
                  type: 'or',
                }
              ) && (
                <StatusBadge
                  status={collectionStatusAudio}
                  downloadItem={downloadStatusAudio}
                  title={titlesAudio}
                  is4k
                  mediaType={MediaType.BOOK}
                  alwaysLabelFormat
                  inProgress={data.books.some(
                    (book) =>
                      (book.mediaInfo?.downloadStatus4k ?? []).length > 0
                  )}
                />
              )}
          </div>
          <h1>{data.name}</h1>
          <span className="media-attributes">
            {collectionAttributes.length > 0 &&
              collectionAttributes
                .map((t, k) => <span key={k}>{t}</span>)
                .reduce((prev, curr) => (
                  <Fragment key={`${prev.key}-${curr.key}`}>
                    {intl.formatMessage(globalMessages.delimitedlist, {
                      a: prev,
                      b: curr,
                    })}
                  </Fragment>
                ))}
          </span>
        </div>
        <div className="media-actions">
          {settings.currentSettings.seriesRequestsEnabled &&
            (hasRequestable || hasRequestableAudio) && (
              <Button
                buttonType="primary"
                onClick={() => setRequestModal(true)}
              >
                <ArrowDownTrayIcon />
                <span>{intl.formatMessage(globalMessages.request)}</span>
              </Button>
            )}
        </div>
      </div>
      {data.overview && (
        <div className="media-overview">
          <div className="flex-1">
            <h2>{intl.formatMessage(messages.overview)}</h2>
            <p>{data.overview}</p>
          </div>
        </div>
      )}
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(globalMessages.books)}</span>
        </div>
      </div>
      {bookCards(primaryBooks)}
      {extraBooks.length > 0 && (
        <>
          <div className="slider-header">
            <div className="slider-title">
              <span>{intl.formatMessage(messages.editionsextras)}</span>
            </div>
          </div>
          {bookCards(extraBooks)}
        </>
      )}
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default SeriesDetails;
