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
  requestbooks: 'Request {count} {count, plural, one {Book} other {Books}}',
});

const FORMATS = [false, true];

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  seriesId?: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const pairKey = (bookId: number, is4k: boolean) => `${bookId}|${is4k ? 1 : 0}`;

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
  const [selection, setSelection] = useState<string[] | null>(null);
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

  const requestablePairs = books.flatMap((book) =>
    visibleFormats
      .filter((is4k) => isRequestable(book.id, is4k))
      .map((is4k) => pairKey(book.id, is4k))
  );

  // Both formats are pre-selected only when the global default says so
  const defaultFormats = settings.currentSettings.syncBookFormatRequests
    ? visibleFormats
    : visibleFormats.slice(0, 1);
  const defaultSelection = books.flatMap((book) =>
    defaultFormats
      .filter((is4k) => isRequestable(book.id, is4k))
      .map((is4k) => pairKey(book.id, is4k))
  );

  const selected = (selection ?? defaultSelection).filter((key) =>
    requestablePairs.includes(key)
  );
  const isSelected = (bookId: number, is4k: boolean) =>
    selected.includes(pairKey(bookId, is4k));

  const selectedBookIds = [
    ...new Set(selected.map((key) => Number(key.split('|')[0]))),
  ];
  const selectedFormats = visibleFormats.filter((is4k) =>
    selected.some((key) => key.endsWith(`|${is4k ? 1 : 0}`))
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

  const toggle = (bookId: number, is4k: boolean) => {
    if (!isRequestable(bookId, is4k)) {
      return;
    }
    const key = pairKey(bookId, is4k);
    if (!selected.includes(key) && wouldExceedQuota(bookId)) {
      return;
    }
    setSelection(
      selected.includes(key)
        ? selected.filter((entry) => entry !== key)
        : [...selected, key]
    );
  };

  const formatColumn = (is4k: boolean) =>
    requestablePairs.filter((key) => key.endsWith(`|${is4k ? 1 : 0}`));

  const isWholeColumn = (is4k: boolean) => {
    const column = formatColumn(is4k);
    return column.length > 0 && column.every((key) => selected.includes(key));
  };

  const toggleColumn = (is4k: boolean) => {
    const column = formatColumn(is4k);
    if (!column.length) {
      return;
    }
    if (isWholeColumn(is4k)) {
      setSelection(selected.filter((key) => !column.includes(key)));
      return;
    }
    const booksAfter = new Set([
      ...selectedBookIds,
      ...column.map((key) => Number(key.split('|')[0])),
    ]);
    if (quota?.book.limit && booksAfter.size > (quota.book.remaining ?? 0)) {
      return;
    }
    setSelection([...new Set([...selected, ...column])]);
  };

  const requestableFormatsFor = (bookId: number) =>
    visibleFormats.filter((is4k) => isRequestable(bookId, is4k));

  const defaultFormatsFor = (bookId: number) => {
    const preferred = defaultFormats.filter((is4k) =>
      isRequestable(bookId, is4k)
    );
    return preferred.length ? preferred : requestableFormatsFor(bookId);
  };

  const bookSelectable = (bookId: number) =>
    requestableFormatsFor(bookId).length > 0;
  const bookIncluded = (bookId: number) =>
    selected.some((key) => key.startsWith(`${bookId}|`));

  // The leading toggle clears a book outright, or restores it at the defaults
  const toggleBook = (bookId: number) => {
    if (!bookSelectable(bookId)) {
      return;
    }
    if (bookIncluded(bookId)) {
      setSelection(selected.filter((key) => !key.startsWith(`${bookId}|`)));
      return;
    }
    if (wouldExceedQuota(bookId)) {
      return;
    }
    setSelection([
      ...new Set([
        ...selected,
        ...defaultFormatsFor(bookId).map((is4k) => pairKey(bookId, is4k)),
      ]),
    ]);
  };

  const selectableBooks = books
    .filter((book) => bookSelectable(book.id))
    .map((book) => book.id);
  const allBooksIncluded =
    selectableBooks.length > 0 && selectableBooks.every(bookIncluded);

  const toggleAllBooks = () => {
    if (allBooksIncluded) {
      setSelection([]);
      return;
    }
    if (
      quota?.book.limit &&
      selectableBooks.length > (quota.book.remaining ?? 0)
    ) {
      return;
    }
    setSelection([
      ...new Set([
        ...selected,
        ...selectableBooks.flatMap((bookId) =>
          defaultFormatsFor(bookId).map((is4k) => pairKey(bookId, is4k))
        ),
      ]),
    ]);
  };

  const statusBadge = (bookId: number, is4k: boolean) => {
    const status = bookStatus(bookId, is4k);
    const request = bookRequest(bookId, is4k);

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
      request?.status === MediaRequestStatus.APPROVED
    ) {
      return (
        <Badge badgeType="primary">
          {intl.formatMessage(globalMessages.requested)}
        </Badge>
      );
    }
    if (status === MediaStatus.PENDING || request) {
      return (
        <Badge badgeType="warning">
          {intl.formatMessage(globalMessages.pending)}
        </Badge>
      );
    }
    return <Badge>{intl.formatMessage(globalMessages.notrequested)}</Badge>;
  };

  const allBooksToggle = () => (
    <div
      className={selectableBooks.length ? '' : 'pointer-events-none opacity-50'}
    >
      <SlideCheckbox checked={allBooksIncluded} onClick={toggleAllBooks} />
    </div>
  );

  const bookToggle = (bookId: number) => (
    <div
      className={bookSelectable(bookId) ? '' : 'pointer-events-none opacity-50'}
    >
      <SlideCheckbox
        checked={bookIncluded(bookId) || !bookSelectable(bookId)}
        onClick={() => toggleBook(bookId)}
      />
    </div>
  );

  const formatToggle = (bookId: number, is4k: boolean, withLabel = false) => {
    const selectable = isRequestable(bookId, is4k);

    return (
      <div className="flex items-center gap-2">
        <div className={selectable ? '' : 'pointer-events-none opacity-50'}>
          <SlideCheckbox
            checked={isSelected(bookId, is4k) || !selectable}
            onClick={() => toggle(bookId, is4k)}
          />
        </div>
        {withLabel && (
          <span className="w-20 flex-shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400">
            {intl.formatMessage(is4k ? messages.audiobook : messages.ebook)}
          </span>
        )}
        {statusBadge(bookId, is4k)}
      </div>
    );
  };

  const sendRequest = async () => {
    if (!selected.length) {
      return;
    }
    setIsUpdating(true);

    try {
      const outcomes = (
        await Promise.all(
          selectedBookIds.map((bookId) =>
            requestBookFormats(
              bookId,
              visibleFormats.filter((is4k) => isSelected(bookId, is4k)),
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
      okDisabled={isUpdating || selected.length === 0 || quota?.book.restricted}
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
                    <th className="hidden w-16 bg-gray-700/80 px-4 py-3 md:table-cell">
                      {allBooksToggle()}
                    </th>
                    <th className="bg-gray-700/80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      <div className="flex items-center gap-2">
                        <span className="md:hidden">{allBooksToggle()}</span>
                        <span>{intl.formatMessage(globalMessages.book)}</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-1 md:hidden">
                        {visibleFormats.map((is4k) => (
                          <div
                            key={`series-format-head-sm-${is4k}`}
                            className="flex items-center gap-2"
                          >
                            <div
                              className={
                                formatColumn(is4k).length
                                  ? ''
                                  : 'pointer-events-none opacity-50'
                              }
                            >
                              <SlideCheckbox
                                checked={isWholeColumn(is4k)}
                                onClick={() => toggleColumn(is4k)}
                              />
                            </div>
                            <span>
                              {intl.formatMessage(
                                is4k ? messages.audiobook : messages.ebook
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </th>
                    {visibleFormats.map((is4k) => (
                      <th
                        key={`series-format-head-${is4k}`}
                        className="hidden bg-gray-700/80 px-2 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:table-cell md:px-4"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={
                              formatColumn(is4k).length
                                ? ''
                                : 'pointer-events-none opacity-50'
                            }
                          >
                            <SlideCheckbox
                              checked={isWholeColumn(is4k)}
                              onClick={() => toggleColumn(is4k)}
                            />
                          </div>
                          <span>
                            {intl.formatMessage(
                              is4k ? messages.audiobook : messages.ebook
                            )}
                          </span>
                        </div>
                      </th>
                    ))}
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
                        <td className="hidden whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100 md:table-cell">
                          {bookToggle(book.id)}
                        </td>
                        <td className="px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:whitespace-nowrap md:px-6">
                          <div className="mb-2 md:hidden">
                            {bookToggle(book.id)}
                          </div>
                          <div className="mx-auto w-fit md:mx-0 md:w-auto">
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
                              <div className="flex max-w-[13rem] flex-col justify-center pl-2 md:max-w-none">
                                <div className="text-xs font-medium">
                                  {book.releaseDate?.slice(0, 4)}
                                  {book.position && ` - #${book.position}`}
                                </div>
                                <div className="text-base font-bold">
                                  {book.title}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-col gap-2 md:hidden">
                              {visibleFormats.map((is4k) => (
                                <div key={`book-${book.id}-format-sm-${is4k}`}>
                                  {formatToggle(book.id, is4k, true)}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                        {visibleFormats.map((is4k) => (
                          <td
                            key={`book-${book.id}-format-${is4k}`}
                            className="hidden whitespace-nowrap px-2 py-4 text-sm leading-5 text-gray-200 md:table-cell md:px-4"
                          >
                            {formatToggle(book.id, is4k)}
                          </td>
                        ))}
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
