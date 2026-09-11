import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus, MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { BookDetails } from '@server/models/Book';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestbooktitle: 'Request Book',
  requestaudiobooktitle: 'Request Audiobook',
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

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  hcId?: number;
  isAudio?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
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
  const { addToast } = useToasts();
  const { data, error } = useSWR<BookDetails>(`/api/v1/book/${hcId}`, {
    revalidateOnMount: true,
  });

  const intl = useIntl();
  const settings = useSettings();
  const { user, hasPermission } = useUser();

  const canRequestEbook = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );
  const canRequestAudiobook = hasPermission(
    [Permission.REQUEST_4K, Permission.REQUEST_AUDIO_BOOK],
    { type: 'or' }
  );

  // With syncing on, one action covers both formats, but only the ones the
  // user is actually permitted to request
  const requestFormats = useMemo(() => {
    const synced =
      settings.currentSettings.syncBookFormatRequests &&
      settings.currentSettings.bookAudioEnabled &&
      !editRequest
        ? [
            ...(canRequestEbook ? [false] : []),
            ...(canRequestAudiobook ? [true] : []),
          ]
        : [];

    return synced.length ? synced : [isAudio];
  }, [
    settings.currentSettings.syncBookFormatRequests,
    settings.currentSettings.bookAudioEnabled,
    editRequest,
    canRequestEbook,
    canRequestAudiobook,
    isAudio,
  ]);

  // Label the modal by what it will actually submit, which is not always the
  // format it was opened for
  const isSynced = requestFormats.length > 1;
  const submitsAudioOnly = !isSynced && requestFormats[0];
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  const sendRequest = useCallback(async () => {
    setIsUpdating(true);

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          metadataProfileId: requestOverrides.metadataProfile,
          rootFolder: requestOverrides.folder,
          userId: requestOverrides.user?.id,
          tags: requestOverrides.tags,
        };
      }
      // Server and profile overrides are chosen for one format's instance, so
      // only the format the requester configured may take them
      const results = await Promise.allSettled(
        requestFormats.map((is4k) =>
          axios.post<MediaRequest>('/api/v1/request', {
            mediaId: data?.id,
            mediaType: 'book',
            is4k,
            ...(is4k === isAudio
              ? overrideParams
              : { userId: requestOverrides?.user?.id }),
          })
        )
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      // A format that is already requested or unavailable must not sink the rest
      if (!results.some((result) => result.status === 'fulfilled')) {
        throw new Error('No book format request succeeded');
      }

      if (onComplete) {
        onComplete(
          requestFormats.every(
            (is4k) =>
              hasPermission(
                is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE
              ) ||
              hasPermission(
                is4k
                  ? Permission.AUTO_APPROVE_AUDIO_BOOK
                  : Permission.AUTO_APPROVE_BOOK
              )
          )
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
        );
      }
      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: data?.title,
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
  }, [
    requestOverrides,
    data?.id,
    data?.title,
    isAudio,
    requestFormats,
    onComplete,
    addToast,
    intl,
    hasPermission,
  ]);

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

  const hasAutoApprove = requestFormats.every((is4k) =>
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

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      okDisabled={isUpdating || quota?.book.restricted}
      title={intl.formatMessage(
        submitsAudioOnly
          ? messages.requestaudiobooktitle
          : messages.requestbooktitle
      )}
      subTitle={data?.title}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : intl.formatMessage(
              submitsAudioOnly
                ? globalMessages.requestAudio
                : globalMessages.request
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
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
        />
      )}
      {(hasPermission(Permission.REQUEST_ADVANCED) ||
        hasPermission(Permission.MANAGE_REQUESTS)) && (
        <AdvancedRequester
          type={MediaType.BOOK}
          is4k={isAudio}
          onChange={(overrides) => {
            setRequestOverrides(overrides);
          }}
        />
      )}
    </Modal>
  );
};

export default BookRequestModal;
