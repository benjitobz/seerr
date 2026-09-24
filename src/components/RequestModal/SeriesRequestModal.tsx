import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import SlideCheckbox from '@app/components/Common/SlideCheckbox';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { requestBookFormats } from '@app/utils/requestBookFormats';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { Series } from '@server/models/Series';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestseriestitle: 'Request Series',
  requesterror: 'Something went wrong while submitting the request.',
  selectbooks: 'Select Book(s)',
  selectformat: 'Select Format(s)',
  format: 'Format',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  requestbooks: 'Request {count} {count, plural, one {Book} other {Books}}',
  requestbooksaudio:
    'Request {count} {count, plural, one {Book} other {Books}} in Audiobook',
  requestbooksboth:
    'Request {count} {count, plural, one {Book} other {Books}} in Both Formats',
});

const FORMATS = [false, true];

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  seriesId?: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const SeriesRequestModal = ({
  onCancel,
  onComplete,
  seriesId,
  onUpdating,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [formatOverrides, setFormatOverrides] = useState<
    Record<string, RequestOverrides | undefined>
  >({});
  const [selectedFormats, setSelectedFormats] = useState<boolean[] | null>(
    null
  );
  const [selectedParts, setSelectedParts] = useState<number[] | null>(null);
  const { addToast } = useToasts();
  const { data, error } = useSWR<Series>(`/api/v1/series/${seriesId}`, {
    revalidateOnMount: true,
  });
  const intl = useIntl();
  const settings = useSettings();
  const { user, hasPermission } = useUser();

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  const canRequestFormat = (is4k: boolean) =>
    is4k
      ? settings.currentSettings.bookAudioEnabled &&
        hasPermission([Permission.REQUEST_4K, Permission.REQUEST_AUDIO_BOOK], {
          type: 'or',
        })
      : hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
          type: 'or',
        });

  const visibleFormats = FORMATS.filter(canRequestFormat);
  const formats = (
    selectedFormats ??
    (settings.currentSettings.syncBookFormatRequests
      ? visibleFormats
      : visibleFormats.slice(0, 1))
  )
    .slice()
    .sort((a, b) => Number(a) - Number(b));

  const books = data?.books ?? [];

  const bookStatus = (bookId: number, is4k: boolean) => {
    const book = books.find((b) => b.id === bookId);
    return (
      book?.mediaInfo?.[is4k ? 'status4k' : 'status'] ?? MediaStatus.UNKNOWN
    );
  };

  const bookRequest = (bookId: number, is4k: boolean) => {
    const book = books.find((b) => b.id === bookId);
    return (book?.mediaInfo?.requests ?? []).find(
      (request) =>
        request.is4k === is4k &&
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    );
  };

  // A format of a book can be requested when nothing is tracking it yet
  const isBookFormatRequestable = (bookId: number, is4k: boolean) => {
    if (!canRequestFormat(is4k) || bookRequest(bookId, is4k)) {
      return false;
    }
    const status = bookStatus(bookId, is4k);
    return status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED;
  };

  const formatsForBook = (bookId: number) =>
    formats.filter((is4k) => isBookFormatRequestable(bookId, is4k));

  const requestableBooks = books
    .filter((book) => book.mediaInfo?.status !== MediaStatus.BLOCKLISTED)
    .filter((book) => formatsForBook(book.id).length > 0)
    .map((book) => book.id);

  const parts = (selectedParts ?? requestableBooks).filter((bookId) =>
    requestableBooks.includes(bookId)
  );

  const quotaUser =
    formats
      .map((is4k) => formatOverrides[String(is4k)]?.user)
      .find((selected) => selected) ?? undefined;

  const { data: quota } = useSWR<QuotaResponse>(
    user && (!quotaUser?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${quotaUser?.id ?? user.id}/quota`
      : null
  );

  // One book counts once against the book quota however many formats it takes
  const currentlyRemaining = (quota?.book.remaining ?? 0) - parts.length;
  const isAllParts =
    requestableBooks.length > 0 && parts.length === requestableBooks.length;
  const isAllFormats =
    visibleFormats.length > 0 &&
    visibleFormats.every((is4k) => formats.includes(is4k));

  const toggleFormat = (is4k: boolean) =>
    setSelectedFormats(
      formats.includes(is4k)
        ? formats.filter((format) => format !== is4k)
        : [...formats, is4k]
    );

  const toggleAllFormats = () =>
    setSelectedFormats(isAllFormats ? [] : visibleFormats);

  const togglePart = (bookId: number) => {
    if (!requestableBooks.includes(bookId)) {
      return;
    }
    if (
      quota?.book.limit &&
      currentlyRemaining <= 0 &&
      !parts.includes(bookId)
    ) {
      return;
    }
    setSelectedParts(
      parts.includes(bookId)
        ? parts.filter((partId) => partId !== bookId)
        : [...parts, bookId]
    );
  };

  const toggleAllParts = () => {
    if (
      quota?.book.limit &&
      (quota?.book.remaining ?? 0) < requestableBooks.length
    ) {
      return;
    }
    setSelectedParts(isAllParts ? [] : requestableBooks);
  };

  const seriesFormatStatus = (is4k: boolean) => {
    if (!books.length) {
      return MediaStatus.UNKNOWN;
    }
    const key = is4k ? 'status4k' : 'status';
    if (
      books.every((book) => book.mediaInfo?.[key] === MediaStatus.AVAILABLE)
    ) {
      return MediaStatus.AVAILABLE;
    }
    if (books.some((book) => book.mediaInfo?.[key] === MediaStatus.AVAILABLE)) {
      return MediaStatus.PARTIALLY_AVAILABLE;
    }
    return MediaStatus.UNKNOWN;
  };

  const statusBadge = (status: MediaStatus, requested?: boolean) => {
    if (status === MediaStatus.AVAILABLE) {
      return (
        <Badge badgeType="success">
          {intl.formatMessage(globalMessages.available)}
        </Badge>
      );
    }
    if (status === MediaStatus.PARTIALLY_AVAILABLE) {
      return (
        <Badge badgeType="success">
          {intl.formatMessage(globalMessages.partiallyavailable)}
        </Badge>
      );
    }
    if (status === MediaStatus.BLOCKLISTED) {
      return (
        <Badge badgeType="danger">
          {intl.formatMessage(globalMessages.blocklisted)}
        </Badge>
      );
    }
    if (status === MediaStatus.PROCESSING) {
      return (
        <Badge badgeType="primary">
          {intl.formatMessage(globalMessages.requested)}
        </Badge>
      );
    }
    if (status === MediaStatus.PENDING || requested) {
      return (
        <Badge badgeType="warning">
          {intl.formatMessage(globalMessages.pending)}
        </Badge>
      );
    }
    return <Badge>{intl.formatMessage(globalMessages.notrequested)}</Badge>;
  };

  const sendRequest = async () => {
    if (!parts.length || !formats.length) {
      return;
    }
    setIsUpdating(true);

    try {
      const outcomes = (
        await Promise.all(
          parts.map((bookId) =>
            requestBookFormats(
              bookId,
              formatsForBook(bookId),
              (is4k) => formatOverrides[String(is4k)]
            )
          )
        )
      ).flat();

      if (!outcomes.some((outcome) => outcome.request)) {
        throw new Error('No book format request succeeded');
      }

      mutate('/api/v1/request/count');

      if (onComplete) {
        onComplete(
          parts.length === books.length
            ? MediaStatus.UNKNOWN
            : MediaStatus.PARTIALLY_AVAILABLE
        );
      }

      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: data?.name,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const hasAutoApprove =
    formats.length > 0 &&
    formats.every((is4k) =>
      hasPermission(
        [
          Permission.MANAGE_REQUESTS,
          is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE,
          is4k
            ? Permission.AUTO_APPROVE_AUDIO_BOOK
            : Permission.AUTO_APPROVE_BOOK,
        ],
        { type: 'or' }
      )
    );

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      title={intl.formatMessage(messages.requestseriestitle)}
      subTitle={data?.name}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : formats.length === 0
            ? intl.formatMessage(messages.selectformat)
            : parts.length === 0
              ? intl.formatMessage(messages.selectbooks)
              : intl.formatMessage(
                  formats.length > 1
                    ? messages.requestbooksboth
                    : formats[0]
                      ? messages.requestbooksaudio
                      : messages.requestbooks,
                  { count: parts.length }
                )
      }
      okDisabled={
        isUpdating ||
        formats.length === 0 ||
        parts.length === 0 ||
        quota?.book.restricted
      }
      okButtonType={'primary'}
      backdrop={undefined}
    >
      {hasAutoApprove && !quota?.book.restricted && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.requestadmin)}
            type="info"
          />
        </div>
      )}
      {(quota?.book.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="book"
          quota={quota?.book}
          remaining={currentlyRemaining}
          userOverride={
            quotaUser && quotaUser.id !== user?.id ? quotaUser.id : undefined
          }
        />
      )}
      <div className="flex flex-col">
        <div className="-mx-4 sm:mx-0">
          <div className="inline-block min-w-full py-2 align-middle">
            <div className="overflow-hidden border border-gray-700 shadow backdrop-blur sm:rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="w-16 bg-gray-700/80 px-4 py-3">
                      <SlideCheckbox
                        checked={isAllFormats}
                        onClick={toggleAllFormats}
                      />
                    </th>
                    <th className="bg-gray-700/80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(messages.format)}
                    </th>
                    <th className="bg-gray-700/80 px-2 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(globalMessages.status)}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {visibleFormats.map((is4k) => (
                    <tr key={`series-format-${is4k}`}>
                      <td className="whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                        <SlideCheckbox
                          checked={formats.includes(is4k)}
                          onClick={() => toggleFormat(is4k)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                        {intl.formatMessage(
                          is4k ? messages.audiobook : messages.ebook
                        )}
                      </td>
                      <td className="whitespace-nowrap py-4 pr-2 text-sm leading-5 text-gray-200 md:px-6">
                        {statusBadge(seriesFormatStatus(is4k))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="-mx-4 sm:mx-0">
          <div className="inline-block min-w-full py-2 align-middle">
            <div className="overflow-hidden border border-gray-700 shadow backdrop-blur sm:rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="w-16 bg-gray-700/80 px-4 py-3">
                      <div
                        className={
                          requestableBooks.length
                            ? ''
                            : 'pointer-events-none opacity-50'
                        }
                      >
                        <SlideCheckbox
                          checked={isAllParts}
                          onClick={toggleAllParts}
                        />
                      </div>
                    </th>
                    <th className="bg-gray-700/80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(globalMessages.book)}
                    </th>
                    <th className="bg-gray-700/80 px-2 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(globalMessages.status)}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {books
                    .filter((book) => {
                      if (!blocklistVisibility)
                        return (
                          book.mediaInfo?.status !== MediaStatus.BLOCKLISTED
                        );
                      return book;
                    })
                    .map((book) => {
                      const selectable = requestableBooks.includes(book.id);

                      return (
                        <tr key={`book-${book.id}`}>
                          <td className="whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                            <div
                              className={
                                selectable
                                  ? ''
                                  : 'pointer-events-none opacity-50'
                              }
                            >
                              <SlideCheckbox
                                checked={parts.includes(book.id) || !selectable}
                                onClick={() => togglePart(book.id)}
                              />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                            <div className="flex">
                              <div className="w-10 flex-shrink-0">
                                <CachedImage
                                  type="hardcover"
                                  src={book.posterPath ?? ''}
                                  alt=""
                                  sizes="100vw"
                                  style={{
                                    width: '100%',
                                    height: 'auto',
                                    objectFit: 'cover',
                                  }}
                                  width={600}
                                  height={900}
                                />
                              </div>
                              <div className="flex flex-col justify-center pl-2">
                                <div className="text-xs font-medium">
                                  {book.releaseDate?.slice(0, 4)}
                                  {book.position && ` - #${book.position}`}
                                </div>
                                <div className="text-base font-bold">
                                  {book.title}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap py-4 pr-2 text-sm leading-5 text-gray-200 md:px-6">
                            <div className="flex flex-col items-start gap-1">
                              {visibleFormats.map((is4k) => (
                                <div
                                  key={`book-${book.id}-status-${is4k}`}
                                  className="flex items-center gap-1"
                                >
                                  {visibleFormats.length > 1 && (
                                    <span className="text-xs uppercase tracking-wider text-gray-400">
                                      {intl.formatMessage(
                                        is4k
                                          ? messages.audiobook
                                          : messages.ebook
                                      )}
                                    </span>
                                  )}
                                  {statusBadge(
                                    bookStatus(book.id, is4k),
                                    !!bookRequest(book.id, is4k)
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {(hasPermission(Permission.REQUEST_ADVANCED) ||
        hasPermission(Permission.MANAGE_REQUESTS)) &&
        formats.length > 0 && (
          <>
            {formats.length > 1 && (
              <div className="mb-2 mt-4 flex items-center text-lg font-semibold">
                {intl.formatMessage(globalMessages.advanced)}
              </div>
            )}
            {formats.map((is4k) => (
              <div key={`advanced-requester-${is4k}`}>
                {formats.length > 1 && (
                  <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {intl.formatMessage(
                      is4k ? messages.audiobook : messages.ebook
                    )}
                  </h3>
                )}
                <AdvancedRequester
                  type={MediaType.BOOK}
                  is4k={is4k}
                  hideTitle={formats.length > 1}
                  onChange={(overrides) => {
                    setFormatOverrides((current) => ({
                      ...current,
                      [String(is4k)]: overrides,
                    }));
                  }}
                />
              </div>
            ))}
          </>
        )}
    </Modal>
  );
};

export default SeriesRequestModal;
