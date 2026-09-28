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
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  fullseries: 'Full Series',
  requestbooks: 'Request {count} {count, plural, one {Book} other {Books}}',
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
  const [excludedBooks, setExcludedBooks] = useState<number[]>([]);
  const [bookFormats, setBookFormats] = useState<Record<number, boolean[]>>({});
  const [headerFormats, setHeaderFormats] = useState<boolean[] | null>(null);
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
  const isRequestable = (bookId: number, is4k: boolean) => {
    const book = books.find((b) => b.id === bookId);
    if (
      !canRequestFormat(is4k) ||
      book?.mediaInfo?.status === MediaStatus.BLOCKLISTED ||
      bookRequest(bookId, is4k)
    ) {
      return false;
    }
    const status = bookStatus(bookId, is4k);
    return status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED;
  };

  // Both formats are pre-selected only when the global default says so
  const defaultFormats = settings.currentSettings.syncBookFormatRequests
    ? visibleFormats
    : visibleFormats.slice(0, 1);

  // The header choice, which a book follows until that book is changed
  const activeFormats = (headerFormats ?? defaultFormats).filter((is4k) =>
    visibleFormats.includes(is4k)
  );

  const requestableFormatsFor = (bookId: number) =>
    visibleFormats.filter((is4k) => isRequestable(bookId, is4k));

  const formatsForBook = (bookId: number) =>
    (bookFormats[bookId] ?? activeFormats).filter((is4k) =>
      isRequestable(bookId, is4k)
    );

  const isSelected = (bookId: number, is4k: boolean) =>
    formatsForBook(bookId).includes(is4k);

  const bookSelectable = (bookId: number) =>
    requestableFormatsFor(bookId).length > 0;

  const selectableBooks = books
    .filter((book) => bookSelectable(book.id))
    .map((book) => book.id);

  const bookExcluded = (bookId: number) => excludedBooks.includes(bookId);

  // Switched on and holding a format is what puts a book in the request, so
  // clearing the formats above reads through to every book's own switch
  const bookRequested = (bookId: number) =>
    !bookExcluded(bookId) && formatsForBook(bookId).length > 0;

  // A book with nothing left to request shows on, and shows what it already has
  const bookToggleOn = (bookId: number) =>
    bookRequested(bookId) || !bookSelectable(bookId);

  const anyBookIncluded = selectableBooks.some(
    (bookId) => !bookExcluded(bookId)
  );

  const selectedBookIds = selectableBooks.filter(bookRequested);

  const selectedFormats = visibleFormats.filter((is4k) =>
    selectedBookIds.some((bookId) => isSelected(bookId, is4k))
  );

  const quotaUser =
    selectedFormats
      .map((is4k) => formatOverrides[String(is4k)]?.user)
      .find((selectedUser) => selectedUser) ?? undefined;

  const { data: quota } = useSWR<QuotaResponse>(
    user && (!quotaUser?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${quotaUser?.id ?? user.id}/quota`
      : null
  );

  // A book costs one unit however many of its formats are taken
  const currentlyRemaining =
    (quota?.book.remaining ?? 0) - selectedBookIds.length;

  const wouldExceedQuota = (bookId: number) =>
    !!quota?.book.limit &&
    currentlyRemaining <= 0 &&
    !selectedBookIds.includes(bookId);

  // Changing a book's formats detaches that book from the header choice
  const toggle = (bookId: number, is4k: boolean) => {
    if (!isRequestable(bookId, is4k) || bookExcluded(bookId)) {
      return;
    }
    const current = formatsForBook(bookId);
    const adding = !current.includes(is4k);
    if (adding && wouldExceedQuota(bookId)) {
      return;
    }
    setBookFormats({
      ...bookFormats,
      [bookId]: adding
        ? [...current, is4k]
        : current.filter((format) => format !== is4k),
    });
  };

  const formatColumn = (is4k: boolean) =>
    selectableBooks.filter((bookId) => isRequestable(bookId, is4k));

  const isWholeColumn = (is4k: boolean) => activeFormats.includes(is4k);

  // Every book that was not changed individually follows this
  const toggleColumn = (is4k: boolean) => {
    if (!formatColumn(is4k).length || !anyBookIncluded) {
      return;
    }
    setHeaderFormats(
      isWholeColumn(is4k)
        ? activeFormats.filter((format) => format !== is4k)
        : [...activeFormats, is4k]
    );
  };

  // Switching a book off leaves its formats alone; it is simply not requested
  const toggleBook = (bookId: number) => {
    if (!bookSelectable(bookId)) {
      return;
    }
    if (bookRequested(bookId)) {
      setExcludedBooks([...new Set([...excludedBooks, bookId])]);
      return;
    }
    if (wouldExceedQuota(bookId)) {
      return;
    }
    setExcludedBooks(excludedBooks.filter((id) => id !== bookId));
    if (!formatsForBook(bookId).length) {
      const restored = { ...bookFormats };
      delete restored[bookId];
      // Nothing to fall back on when the formats above are off too
      if (!activeFormats.some((is4k) => isRequestable(bookId, is4k))) {
        restored[bookId] = requestableFormatsFor(bookId);
      }
      setBookFormats(restored);
    }
  };

  const allBooksIncluded =
    selectableBooks.length > 0 && selectableBooks.every(bookRequested);

  // Only decides which books are in; the chosen formats are left untouched
  const toggleAllBooks = () => {
    if (allBooksIncluded) {
      setExcludedBooks(selectableBooks);
      return;
    }
    if (
      quota?.book.limit &&
      selectableBooks.length > (quota.book.remaining ?? 0)
    ) {
      return;
    }
    setExcludedBooks([]);
    if (!activeFormats.length) {
      setHeaderFormats(visibleFormats);
    }
    const restored = { ...bookFormats };
    Object.keys(restored).forEach((key) => {
      if (!restored[Number(key)].length) {
        delete restored[Number(key)];
      }
    });
    setBookFormats(restored);
  };

  // Every book available is available; some is partly so
  const seriesFormatStatus = (is4k: boolean) => {
    const key = is4k ? 'status4k' : 'status';
    const available = books.filter(
      (book) => book.mediaInfo?.[key] === MediaStatus.AVAILABLE
    ).length;

    if (!books.length || !available) {
      return MediaStatus.UNKNOWN;
    }
    return available === books.length
      ? MediaStatus.AVAILABLE
      : MediaStatus.PARTIALLY_AVAILABLE;
  };

  const renderStatusBadge = (
    status: MediaStatus,
    requestStatus?: MediaRequestStatus
  ) => {
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
    if (
      status === MediaStatus.PROCESSING ||
      requestStatus === MediaRequestStatus.APPROVED
    ) {
      return (
        <Badge badgeType="primary">
          {intl.formatMessage(globalMessages.requested)}
        </Badge>
      );
    }
    if (status === MediaStatus.PENDING || requestStatus !== undefined) {
      return (
        <Badge badgeType="warning">
          {intl.formatMessage(globalMessages.pending)}
        </Badge>
      );
    }
    return <Badge>{intl.formatMessage(globalMessages.notrequested)}</Badge>;
  };

  const statusBadge = (bookId: number, is4k: boolean) =>
    renderStatusBadge(
      bookStatus(bookId, is4k),
      bookRequest(bookId, is4k)?.status
    );

  const allBooksToggle = () => (
    <div
      className={selectableBooks.length ? '' : 'pointer-events-none opacity-50'}
    >
      <SlideCheckbox checked={allBooksIncluded} onClick={toggleAllBooks} />
    </div>
  );

  const columnToggle = (is4k: boolean) => (
    <div
      className={
        formatColumn(is4k).length && anyBookIncluded
          ? ''
          : 'pointer-events-none opacity-50'
      }
    >
      <SlideCheckbox
        checked={anyBookIncluded && isWholeColumn(is4k)}
        onClick={() => toggleColumn(is4k)}
      />
    </div>
  );

  const bookToggle = (bookId: number) => (
    <div
      className={bookSelectable(bookId) ? '' : 'pointer-events-none opacity-50'}
    >
      <SlideCheckbox
        checked={bookToggleOn(bookId)}
        onClick={() => toggleBook(bookId)}
      />
    </div>
  );

  const formatToggle = (bookId: number, is4k: boolean) => {
    const selectable = isRequestable(bookId, is4k);
    const locked = bookExcluded(bookId);

    return (
      <div className="flex items-center gap-2">
        <div
          className={
            selectable && !locked ? '' : 'pointer-events-none opacity-50'
          }
        >
          <SlideCheckbox
            checked={!locked && (isSelected(bookId, is4k) || !selectable)}
            onClick={() => toggle(bookId, is4k)}
          />
        </div>
        <span className="w-20 flex-shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400">
          {intl.formatMessage(is4k ? messages.audiobook : messages.ebook)}
        </span>
        {statusBadge(bookId, is4k)}
      </div>
    );
  };

  const sendRequest = async () => {
    if (!selectedBookIds.length) {
      return;
    }
    setIsUpdating(true);

    try {
      const outcomes = (
        await Promise.all(
          selectedBookIds.map((bookId) =>
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
          selectedBookIds.length === books.length
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
    selectedFormats.length > 0 &&
    selectedFormats.every((is4k) =>
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
          : selectedBookIds.length === 0
            ? intl.formatMessage(messages.selectbooks)
            : intl.formatMessage(messages.requestbooks, {
                count: selectedBookIds.length,
              })
      }
      okDisabled={
        isUpdating || selectedBookIds.length === 0 || quota?.book.restricted
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
                      {allBooksToggle()}
                    </th>
                    <th className="bg-gray-700/80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(messages.fullseries)}
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
                        {columnToggle(is4k)}
                      </td>
                      <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                        {intl.formatMessage(
                          is4k ? messages.audiobook : messages.ebook
                        )}
                      </td>
                      <td className="whitespace-nowrap py-4 pr-2 text-sm leading-5 text-gray-200 md:px-6">
                        {renderStatusBadge(seriesFormatStatus(is4k))}
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
                    <th className="bg-gray-700/80 px-4 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200">
                      {intl.formatMessage(globalMessages.books)}
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
                    .map((book) => (
                      <tr key={`book-${book.id}`}>
                        <td className="px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                          <div>
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
                            <div className="mt-3 flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {bookToggle(book.id)}
                                <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                                  {intl.formatMessage(globalMessages.request)}
                                </span>
                              </div>
                              {bookToggleOn(book.id) && (
                                <>
                                  <div className="self-stretch border-l border-gray-600" />
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-x-6">
                                    {visibleFormats.map((is4k) => (
                                      <div
                                        key={`book-${book.id}-format-${is4k}`}
                                      >
                                        {formatToggle(book.id, is4k)}
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {(hasPermission(Permission.REQUEST_ADVANCED) ||
        hasPermission(Permission.MANAGE_REQUESTS)) &&
        selectedFormats.length > 0 && (
          <>
            {selectedFormats.length > 1 && (
              <div className="mb-2 mt-4 flex items-center text-lg font-semibold">
                {intl.formatMessage(globalMessages.advanced)}
              </div>
            )}
            {selectedFormats.map((is4k) => (
              <div key={`advanced-requester-${is4k}`}>
                {selectedFormats.length > 1 && (
                  <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {intl.formatMessage(
                      is4k ? messages.audiobook : messages.ebook
                    )}
                  </h3>
                )}
                <AdvancedRequester
                  type={MediaType.BOOK}
                  is4k={is4k}
                  hideTitle={selectedFormats.length > 1}
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
