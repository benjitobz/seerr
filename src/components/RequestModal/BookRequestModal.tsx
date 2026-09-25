import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
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
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { BookDetails } from '@server/models/Book';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestbooktitle: 'Request Book',
  requestebook: 'Request Ebook',
  requestbothformats: 'Request Both Formats',
  selectformat: 'Select Format(s)',
  format: 'Format',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  alreadyrequested: 'Already Requested',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Book Request',
  pendingaudiobookrequest: 'Pending Audiobook Request',
  requestfrom: "{username}'s request is pending approval.",
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
});

const FORMATS = [false, true];

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  hcId?: number;
  isAudio?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus, newStatus4k?: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const BookRequestModal = ({
  onCancel,
  onComplete,
  hcId,
  onUpdating,
  editRequest,
  isAudio = false,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<boolean[] | null>(
    null
  );
  const [formatOverrides, setFormatOverrides] = useState<
    Record<string, RequestOverrides | undefined>
  >({});
  const { addToast } = useToasts();
  const { data, error } = useSWR<BookDetails>(`/api/v1/book/${hcId}`, {
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

  const canRequest = (is4k: boolean) =>
    is4k
      ? settings.currentSettings.bookAudioEnabled &&
        hasPermission([Permission.REQUEST_4K, Permission.REQUEST_AUDIO_BOOK], {
          type: 'or',
        })
      : hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
          type: 'or',
        });

  const autoApproves = (is4k: boolean) =>
    hasPermission(
      [
        Permission.MANAGE_REQUESTS,
        is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE,
        is4k
          ? Permission.AUTO_APPROVE_AUDIO_BOOK
          : Permission.AUTO_APPROVE_BOOK,
      ],
      { type: 'or' }
    );

  const formatStatus = (is4k: boolean) =>
    data?.mediaInfo?.[is4k ? 'status4k' : 'status'] ?? MediaStatus.UNKNOWN;

  const formatRequest = (is4k: boolean) =>
    data?.mediaInfo?.requests?.find(
      (request) =>
        request.is4k === is4k &&
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    );

  const isRequestable = (is4k: boolean) =>
    canRequest(is4k) &&
    (formatStatus(is4k) === MediaStatus.UNKNOWN ||
      (formatStatus(is4k) === MediaStatus.DELETED && !formatRequest(is4k)));

  const visibleFormats = FORMATS.filter(canRequest);
  const requestableFormats = visibleFormats.filter(isRequestable);
  const defaultFormats = settings.currentSettings.syncBookFormatRequests
    ? requestableFormats
    : requestableFormats.includes(isAudio)
      ? [isAudio]
      : requestableFormats.slice(0, 1);
  const formats = (selectedFormats ?? defaultFormats)
    .slice()
    .sort((a, b) => Number(a) - Number(b));
  const isAllSelected =
    requestableFormats.length > 0 &&
    requestableFormats.every((is4k) => formats.includes(is4k));
  const overridesFor = (is4k: boolean) => formatOverrides[String(is4k)];
  const overrideUser =
    editRequest || formats.length === 0
      ? requestOverrides?.user
      : formats.map((is4k) => overridesFor(is4k)?.user).find((u) => u);

  const { data: quota } = useSWR<QuotaResponse>(
    user && (!overrideUser?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${overrideUser?.id ?? user.id}/quota`
      : null
  );

  const toggleFormat = (is4k: boolean) => {
    if (!isRequestable(is4k)) {
      return;
    }
    setSelectedFormats(
      formats.includes(is4k)
        ? formats.filter((format) => format !== is4k)
        : [...formats, is4k]
    );
  };

  const toggleAllFormats = () =>
    setSelectedFormats(isAllSelected ? [] : requestableFormats);

  const sendRequest = async () => {
    if (!data || formats.length === 0) {
      return;
    }
    setIsUpdating(true);

    try {
      const outcomes = await requestBookFormats(data.id, formats, overridesFor);
      const requested = outcomes.filter((outcome) => outcome.request);

      if (!requested.length) {
        throw new Error('No book format request succeeded');
      }

      // The request response carries the media row as it was created, which is
      // always pending; the approved-to-processing flip happens after it returns
      const statusAfter = (is4k: boolean) =>
        requested.some((outcome) => outcome.is4k === is4k)
          ? autoApproves(is4k)
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
          : formatStatus(is4k);

      if (onComplete) {
        onComplete(statusAfter(false), statusAfter(true));
      }
      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: data.title,
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

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        if (onComplete) {
          onComplete(MediaStatus.UNKNOWN);
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: 'book',
        serverId: requestOverrides?.server,
        profileId: requestOverrides?.profile,
        metadataProfileId: requestOverrides?.metadataProfile,
        rootFolder: requestOverrides?.folder,
        userId: requestOverrides?.user?.id,
        tags: requestOverrides?.tags,
      });

      if (alsoApproveRequest) {
        await axios.post(`/api/v1/request/${editRequest?.id}/approve`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {intl.formatMessage(
            alsoApproveRequest
              ? messages.requestApproved
              : messages.requestedited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );

      if (onComplete) {
        onComplete(MediaStatus.PENDING);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(
          isAudio ? messages.pendingaudiobookrequest : messages.pendingrequest
        )}
        subTitle={data?.title}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating}
        okText={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? intl.formatMessage(messages.approve)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? intl.formatMessage(messages.edit)
              : intl.formatMessage(messages.cancel)
        }
        okButtonType={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? 'success'
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? 'primary'
              : 'danger'
        }
        onSecondary={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? () => cancelRequest()
            : undefined
        }
        secondaryDisabled={isUpdating}
        secondaryText={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? intl.formatMessage(messages.cancel)
            : undefined
        }
        secondaryButtonType="danger"
        cancelText={intl.formatMessage(globalMessages.close)}
        backdrop={`${data?.backdropPath}`}
      >
        {isOwner
          ? intl.formatMessage(messages.pendingapproval)
          : intl.formatMessage(messages.requestfrom, {
              username: editRequest.requestedBy.displayName,
            })}
        {(hasPermission(Permission.REQUEST_ADVANCED) ||
          hasPermission(Permission.MANAGE_REQUESTS)) && (
          <AdvancedRequester
            type={'book'}
            is4k={isAudio}
            requestUser={editRequest.requestedBy}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              profile: editRequest.profileId,
              metadataProfile: editRequest.metadataProfileId,
              server: editRequest.serverId,
              tags: editRequest.tags,
            }}
            onChange={(overrides) => {
              setRequestOverrides(overrides);
            }}
          />
        )}
      </Modal>
    );
  }

  const hasAutoApprove =
    formats.length > 0 && formats.every((is4k) => autoApproves(is4k));

  const formatBadge = (is4k: boolean) => {
    const status = formatStatus(is4k);
    const request = formatRequest(is4k);

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
    if (
      status === MediaStatus.PENDING ||
      request?.status === MediaRequestStatus.PENDING
    ) {
      return (
        <Badge badgeType="warning">
          {intl.formatMessage(globalMessages.pending)}
        </Badge>
      );
    }
    if (status === MediaStatus.DELETED) {
      return (
        <Badge badgeType="danger">
          {intl.formatMessage(globalMessages.deleted)}
        </Badge>
      );
    }
    return <Badge>{intl.formatMessage(globalMessages.notrequested)}</Badge>;
  };

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      okDisabled={isUpdating || formats.length === 0 || quota?.book.restricted}
      title={intl.formatMessage(messages.requestbooktitle)}
      subTitle={data?.title}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : requestableFormats.length === 0
            ? intl.formatMessage(messages.alreadyrequested)
            : formats.length === 0
              ? intl.formatMessage(messages.selectformat)
              : formats.length > 1
                ? intl.formatMessage(messages.requestbothformats)
                : intl.formatMessage(
                    formats[0]
                      ? globalMessages.requestAudio
                      : messages.requestebook
                  )
      }
      okButtonType={'primary'}
      backdrop={`${data?.backdropPath}`}
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
          userOverride={
            overrideUser && overrideUser.id !== user?.id
              ? overrideUser.id
              : undefined
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
                      <div
                        className={
                          requestableFormats.length
                            ? ''
                            : 'pointer-events-none opacity-50'
                        }
                      >
                        <SlideCheckbox
                          checked={isAllSelected}
                          onClick={toggleAllFormats}
                        />
                      </div>
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
                    <tr key={`format-${is4k}`}>
                      <td className="whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                        <div
                          className={
                            isRequestable(is4k)
                              ? ''
                              : 'pointer-events-none opacity-50'
                          }
                        >
                          <SlideCheckbox
                            checked={
                              formats.includes(is4k) || !isRequestable(is4k)
                            }
                            onClick={() => toggleFormat(is4k)}
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                        {intl.formatMessage(
                          is4k ? messages.audiobook : messages.ebook
                        )}
                      </td>
                      <td className="whitespace-nowrap py-4 pr-2 text-sm leading-5 text-gray-200 md:px-6">
                        {formatBadge(is4k)}
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

export default BookRequestModal;
