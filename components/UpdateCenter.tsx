'use client';

import {
  CheckCircle2,
  CloudDownload,
  Download,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  Rocket,
  ShieldCheck,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { checkPreviewUpdate, getUpdateEnvironment, openExternalUrl } from '@/lib/api';
import { updateChannelLabel, type UpdateChannel } from '@/lib/update-channel';
import type { ToastItem, UpdateEnvironment } from '@/lib/types';

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

type UpdateFailureStage = 'check' | 'download' | 'verify' | 'install' | 'restart';

type UpdateFailure = {
  stage: UpdateFailureStage;
  message: string;
  details: string;
};

type Props = {
  channel: UpdateChannel;
  onChannelChange: (channel: UpdateChannel) => void;
  notify: (message: string, tone?: ToastItem['tone']) => void;
};

const RELEASES_URL = 'https://github.com/demogest/BiliRecControl/releases/latest';
const PREVIEW_BUILDS_URL = 'https://github.com/demogest/BiliRecControl/releases';
const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MAX_REQUEST_ATTEMPTS = 2;

function runningInTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function updaterErrorDetails(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const details = String(error).trim();
  return details && details !== '[object Object]' ? details : '未知错误';
}

function describeUpdaterFailure(error: unknown, fallbackStage: UpdateFailureStage): UpdateFailure {
  const details = updaterErrorDetails(error);
  const normalized = details.toLowerCase();
  const stage =
    fallbackStage === 'download' && /(signature|public key|校验|签名|验证)/i.test(details)
      ? 'verify'
      : fallbackStage;

  if (/\b(403|429)\b|forbidden|rate limit/i.test(details)) {
    return {
      stage,
      message: '更新服务器拒绝了下载请求。请重试，或前往发布页手动下载安装。',
      details
    };
  }

  if (/\b404\b|not found/i.test(details)) {
    return {
      stage,
      message: '没有找到适用于当前系统的更新包，请前往发布页查看可用安装包。',
      details
    };
  }

  if (/(timed? out|timeout|deadline)/i.test(normalized)) {
    return {
      stage,
      message: '连接更新服务器超时，请检查网络后重试。',
      details
    };
  }

  if (/(signature|public key|校验|签名|验证)/i.test(details)) {
    return {
      stage: fallbackStage === 'download' ? 'verify' : fallbackStage,
      message: '更新包签名校验未通过。为保证安全，应用不会安装此更新。',
      details
    };
  }

  if (/(network|connection|dns|resolve|offline|socket|fetch)/i.test(normalized)) {
    return {
      stage,
      message: '无法连接更新服务器，请检查网络后重试。',
      details
    };
  }

  const fallbackMessages: Record<UpdateFailureStage, string> = {
    check: '暂时无法检查新版本，请稍后重试。',
    download: '更新包下载失败，请稍后重试。',
    verify: '更新包校验失败，为保证安全已停止安装。',
    install: '更新包已经下载，但安装未能完成。',
    restart: '更新已经安装，请手动重启应用以完成更新。'
  };

  return { stage, message: fallbackMessages[stage], details };
}

function canRetryUpdaterRequest(error: unknown) {
  const details = updaterErrorDetails(error).toLowerCase();
  if (
    (/\b4\d\d\b/.test(details) && !/\b(408|425)\b/.test(details)) ||
    /forbidden|rate limit|signature|public key|invalid updater|permission denied|cancelled/i.test(
      details
    )
  ) {
    return false;
  }

  return true;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function UpdateCenter({ channel, onChannelChange, notify }: Props) {
  const [portalReady, setPortalReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [availableVersion, setAvailableVersion] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [failure, setFailure] = useState<UpdateFailure | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadAttempt, setDownloadAttempt] = useState(1);
  const [environment, setEnvironment] = useState<UpdateEnvironment | null>(null);
  const [channelSwitching, setChannelSwitching] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(false);
  const disposedRef = useRef(false);
  const manualCheckRequestedRef = useRef(false);
  const updateActionRef = useRef<Promise<void> | null>(null);
  const automaticCheckTimer = useRef<number | null>(null);
  const checkPromise = useRef<Promise<void> | null>(null);
  const channelRef = useRef<UpdateChannel>(channel);
  const checkGenerationRef = useRef(0);
  const automaticCheckHandledRef = useRef(false);
  const channelSwitchingRef = useRef(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  useEffect(() => {
    if (!runningInTauri()) {
      setEnvironment({
        targetTriple: 'browser',
        updaterTarget: 'unknown',
        bundleType: 'unknown',
        platformLabel: '浏览器预览',
        previewSupported: false,
        previewUnsupportedReason: '请在已安装的桌面应用中使用测试版更新。'
      });
      return;
    }
    let cancelled = false;
    void Promise.all([
      import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()),
      getUpdateEnvironment()
    ])
      .then(([version, nextEnvironment]) => {
        if (cancelled) return;
        setCurrentVersion(version);
        setEnvironment(nextEnvironment);
        if (!nextEnvironment.previewSupported && channelRef.current === 'preview') {
          channelRef.current = 'stable';
          onChannelChange('stable');
          notify('当前平台不支持测试版更新，已切换到稳定版', 'info');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEnvironment({
          targetTriple: 'unknown',
          updaterTarget: 'unknown',
          bundleType: 'unknown',
          platformLabel: '未知平台',
          previewSupported: false,
          previewUnsupportedReason: '无法识别当前平台，为安全起见仅允许稳定版更新。'
        });
        if (channelRef.current === 'preview') {
          channelRef.current = 'stable';
          onChannelChange('stable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify, onChannelChange]);

  const checkForUpdates = useCallback(
    async (silent = false) => {
      if (updateActionRef.current) {
        if (!silent) setOpen(true);
        return;
      }
      if (!silent) {
        manualCheckRequestedRef.current = true;
        automaticCheckHandledRef.current = true;
      }
      const requestedChannel = channelRef.current;
      const requestGeneration = checkGenerationRef.current;

      if (!silent && automaticCheckTimer.current !== null) {
        window.clearTimeout(automaticCheckTimer.current);
        automaticCheckTimer.current = null;
      }

      if (checkPromise.current) {
        if (!silent) setOpen(true);
        await checkPromise.current;
        return;
      }

      const operation = (async () => {
        if (!runningInTauri()) {
          if (!silent) {
            setOpen(true);
            setStatus('error');
            setFailure({
              stage: 'check',
              message: '请在已安装的桌面应用中使用更新功能。',
              details: 'Updater is unavailable outside the Tauri desktop runtime.'
            });
          }
          return;
        }

        setStatus('checking');
        setFailure(null);
        if (!silent) setOpen(true);

        try {
          const updaterModule = await import('@tauri-apps/plugin-updater');
          let update: Update | null = null;
          for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
            try {
              if (requestedChannel === 'preview') {
                const metadata = await checkPreviewUpdate(CHECK_TIMEOUT_MS);
                update = metadata ? new updaterModule.Update(metadata) : null;
              } else {
                update = await updaterModule.check({ timeout: CHECK_TIMEOUT_MS });
              }
              break;
            } catch (error) {
              const shouldRetry = attempt < MAX_REQUEST_ATTEMPTS && canRetryUpdaterRequest(error);
              if (!shouldRetry) throw error;
              await wait(900 * attempt);
              if (
                disposedRef.current ||
                requestGeneration !== checkGenerationRef.current ||
                requestedChannel !== channelRef.current
              ) {
                return;
              }
            }
          }
          if (
            disposedRef.current ||
            requestGeneration !== checkGenerationRef.current ||
            requestedChannel !== channelRef.current
          ) {
            if (update) await update.close().catch(() => undefined);
            return;
          }
          if (!update) {
            if (updateRef.current) {
              await updateRef.current.close().catch(() => undefined);
              updateRef.current = null;
            }
            if (disposedRef.current) return;
            downloadedRef.current = false;
            setStatus('current');
            if (manualCheckRequestedRef.current) {
              notify(`${updateChannelLabel(requestedChannel)}通道暂无可用更新`, 'success');
            }
            return;
          }

          if (updateRef.current && updateRef.current !== update) {
            await updateRef.current.close().catch(() => undefined);
          }
          if (disposedRef.current) {
            await update.close().catch(() => undefined);
            return;
          }
          updateRef.current = update;
          downloadedRef.current = false;
          setCurrentVersion(update.currentVersion);
          setAvailableVersion(update.version);
          setReleaseDate(update.date || '');
          setReleaseNotes(update.body || '此版本暂无更新说明。');
          setDownloadedBytes(0);
          setTotalBytes(0);
          setStatus('available');
          notify(`发现${updateChannelLabel(requestedChannel)} ${update.version}`, 'info');
        } catch (error) {
          if (
            disposedRef.current ||
            requestGeneration !== checkGenerationRef.current ||
            requestedChannel !== channelRef.current
          ) {
            return;
          }
          if (!manualCheckRequestedRef.current) {
            setStatus('idle');
            return;
          }
          setFailure(describeUpdaterFailure(error, 'check'));
          setStatus('error');
          notify('检查更新失败', 'error');
        }
      })();

      checkPromise.current = operation;
      try {
        await operation;
      } finally {
        if (checkPromise.current === operation) {
          checkPromise.current = null;
          manualCheckRequestedRef.current = false;
        }
      }
    },
    [notify]
  );

  useEffect(() => {
    if (!runningInTauri()) return;
    if (channel === 'preview' && !environment) return;
    if (automaticCheckHandledRef.current) return;

    automaticCheckTimer.current = window.setTimeout(() => {
      automaticCheckTimer.current = null;
      automaticCheckHandledRef.current = true;
      if (updateActionRef.current) return;
      void checkForUpdates(true);
    }, 4_000);

    return () => {
      if (automaticCheckTimer.current !== null) {
        window.clearTimeout(automaticCheckTimer.current);
        automaticCheckTimer.current = null;
      }
    };
  }, [channel, checkForUpdates, environment]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      checkGenerationRef.current += 1;
      const update = updateRef.current;
      const pendingAction = updateActionRef.current;
      updateRef.current = null;
      downloadedRef.current = false;
      if (update) {
        if (pendingAction) {
          void pendingAction
            .finally(() => update.close().catch(() => undefined))
            .catch(() => undefined);
        } else {
          void update.close().catch(() => undefined);
        }
      }
    };
  }, []);

  const modalLocked = status === 'installing';
  const channelSwitchLocked =
    channelSwitching ||
    status === 'checking' ||
    status === 'downloading' ||
    status === 'installing';

  const selectUpdateChannel = useCallback(
    async (nextChannel: UpdateChannel) => {
      if (
        nextChannel === channelRef.current ||
        channelSwitchLocked ||
        channelSwitchingRef.current ||
        updateActionRef.current
      ) {
        return;
      }
      if (nextChannel === 'preview' && !environment?.previewSupported) {
        notify(environment?.previewUnsupportedReason || '当前平台不支持测试版更新。', 'error');
        return;
      }

      channelSwitchingRef.current = true;
      setChannelSwitching(true);
      try {
        automaticCheckHandledRef.current = true;
        if (automaticCheckTimer.current !== null) {
          window.clearTimeout(automaticCheckTimer.current);
          automaticCheckTimer.current = null;
        }

        checkGenerationRef.current += 1;
        channelRef.current = nextChannel;
        onChannelChange(nextChannel);

        const discardedDownload = downloadedRef.current;
        const update = updateRef.current;
        updateRef.current = null;
        downloadedRef.current = false;
        if (update) await update.close().catch(() => undefined);
        setAvailableVersion('');
        setReleaseDate('');
        setReleaseNotes('');
        setDownloadedBytes(0);
        setTotalBytes(0);
        setFailure(null);
        setStatus('idle');
        notify(
          discardedDownload
            ? `已放弃下载完成的更新并切换到${updateChannelLabel(nextChannel)}`
            : `已切换到${updateChannelLabel(nextChannel)}通道`,
          'info'
        );
        await checkForUpdates(false);
      } finally {
        channelSwitchingRef.current = false;
        if (!disposedRef.current) setChannelSwitching(false);
      }
    },
    [
      channelSwitchLocked,
      checkForUpdates,
      environment?.previewSupported,
      environment?.previewUnsupportedReason,
      notify,
      onChannelChange
    ]
  );

  const closeUpdateModal = useCallback(() => {
    if (!modalLocked) setOpen(false);
  }, [modalLocked]);

  const openReleaseLink = useCallback(
    async (url: string) => {
      if (!/^https?:\/\//i.test(url)) {
        notify('更新说明中的链接无效', 'error');
        return;
      }

      try {
        if (runningInTauri()) {
          await openExternalUrl(url);
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : '无法打开外部链接', 'error');
      }
    },
    [notify]
  );

  const openReleasePage = useCallback(() => {
    void openReleaseLink(channelRef.current === 'preview' ? PREVIEW_BUILDS_URL : RELEASES_URL);
  }, [openReleaseLink]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeUpdateModal();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeUpdateModal, open]);

  const runUpdateAction = useCallback((operation: () => Promise<void>) => {
    if (updateActionRef.current) return updateActionRef.current;

    const action = operation();
    updateActionRef.current = action;
    void action
      .finally(() => {
        if (updateActionRef.current === action) updateActionRef.current = null;
      })
      .catch(() => undefined);
    return action;
  }, []);

  const downloadUpdate = () =>
    runUpdateAction(async () => {
      const update = updateRef.current;
      if (!update || disposedRef.current) return;

      setStatus('downloading');
      downloadedRef.current = false;
      setDownloadedBytes(0);
      setTotalBytes(0);
      setDownloadAttempt(1);
      setFailure(null);

      for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
        if (disposedRef.current) return;
        setDownloadAttempt(attempt);
        setDownloadedBytes(0);
        setTotalBytes(0);

        try {
          await update.download(
            (event: DownloadEvent) => {
              if (disposedRef.current) return;
              if (event.event === 'Started') {
                setTotalBytes(event.data.contentLength || 0);
              } else if (event.event === 'Progress') {
                setDownloadedBytes((value) => value + event.data.chunkLength);
              }
            },
            { timeout: DOWNLOAD_TIMEOUT_MS }
          );
          if (disposedRef.current) {
            await update.close().catch(() => undefined);
            return;
          }
          downloadedRef.current = true;
          setStatus('downloaded');
          notify('更新包已下载并通过签名校验', 'success');
          return;
        } catch (error) {
          if (disposedRef.current) {
            await update.close().catch(() => undefined);
            return;
          }
          const shouldRetry = attempt < MAX_REQUEST_ATTEMPTS && canRetryUpdaterRequest(error);
          if (shouldRetry) {
            await wait(1_200 * attempt);
            continue;
          }
          setFailure(describeUpdaterFailure(error, 'download'));
          setStatus('error');
          notify('更新包下载失败', 'error');
          return;
        }
      }
    });

  const relaunchApplication = async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      if (disposedRef.current) return;
      setFailure(describeUpdaterFailure(error, 'restart'));
      setStatus('error');
      notify('更新已安装，请手动重启应用', 'error');
    }
  };

  const restartApplication = () => runUpdateAction(relaunchApplication);

  const installUpdate = () =>
    runUpdateAction(async () => {
      const update = updateRef.current;
      if (!update || !downloadedRef.current || disposedRef.current) return;

      setStatus('installing');
      setFailure(null);

      try {
        await update.install();
        downloadedRef.current = false;
        if (!disposedRef.current) {
          notify('更新安装完成，应用即将重启', 'success');
        }
        await relaunchApplication();
      } catch (error) {
        if (disposedRef.current) return;
        setFailure(describeUpdaterFailure(error, 'install'));
        setStatus('error');
        notify('安装更新失败', 'error');
      }
    });

  const retryFailedOperation = async () => {
    if (!failure) return;
    if (failure.stage === 'check') {
      await checkForUpdates(false);
    } else if (failure.stage === 'download' || failure.stage === 'verify') {
      await downloadUpdate();
    } else if (failure.stage === 'install') {
      await installUpdate();
    } else {
      await restartApplication();
    }
  };

  const failureTitles: Record<UpdateFailureStage, string> = {
    check: '检查更新失败',
    download: '更新包下载失败',
    verify: '更新包校验失败',
    install: '更新安装失败',
    restart: '请重启以完成更新'
  };

  const retryLabels: Record<UpdateFailureStage, string> = {
    check: '重新检查',
    download: '重试下载',
    verify: '重新下载',
    install: '重试安装',
    restart: '立即重启'
  };

  const progress = totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
  const hasAvailableUpdate =
    status === 'available' ||
    status === 'downloading' ||
    status === 'downloaded' ||
    (status === 'error' &&
      failure !== null &&
      failure.stage !== 'check' &&
      failure.stage !== 'restart');

  return (
    <>
      <button
        className={`top-icon-button update-trigger ${hasAvailableUpdate ? 'has-update' : ''}`}
        type="button"
        onClick={() => {
          setOpen(true);
          if (status === 'idle' || status === 'current' || status === 'checking') {
            void checkForUpdates(false);
          }
        }}
        title={
          status === 'downloading'
            ? '正在后台下载更新'
            : status === 'downloaded'
              ? '更新已下载，等待安装'
              : hasAvailableUpdate
                ? `发现新版本 ${availableVersion}`
                : '检查应用更新'
        }
        aria-label={
          status === 'downloading'
            ? '查看更新下载进度'
            : status === 'downloaded'
              ? '安装已下载的更新'
              : '检查应用更新'
        }
      >
        <CloudDownload size={18} />
        {hasAvailableUpdate && <i />}
      </button>

      {portalReady &&
        open &&
        createPortal(
          <div
            className="modal-backdrop update-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeUpdateModal();
            }}
          >
            <section
              className="modal-card update-modal"
              role="dialog"
              aria-modal="true"
              aria-label="应用更新"
            >
              <header className="modal-header">
                <div>
                  <span className="section-kicker">APPLICATION UPDATE</span>
                  <h2>应用更新</h2>
                  <p>获取最新功能和修复</p>
                </div>
                <button
                  className="modal-close"
                  type="button"
                  disabled={modalLocked}
                  onClick={closeUpdateModal}
                  aria-label="关闭更新窗口"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="modal-body update-modal-body">
                <section className="update-channel-selector" aria-label="更新通道">
                  <header>
                    <div>
                      <strong>更新通道</strong>
                      <span>
                        {environment
                          ? `已识别 ${environment.platformLabel}${
                              environment.bundleType === 'unknown'
                                ? ''
                                : ` · ${environment.bundleType.toUpperCase()}`
                            }`
                          : '正在识别客户端平台…'}
                      </span>
                    </div>
                    <span className={`update-channel-badge is-${channel}`}>
                      {updateChannelLabel(channel)}
                    </span>
                  </header>
                  <div>
                    <button
                      className={channel === 'stable' ? 'is-active' : ''}
                      type="button"
                      disabled={channelSwitchLocked}
                      aria-pressed={channel === 'stable'}
                      onClick={() => void selectUpdateChannel('stable')}
                    >
                      <ShieldCheck size={16} />
                      <span>
                        <strong>稳定版</strong>
                        <small>仅获取正式 Release</small>
                      </span>
                    </button>
                    <button
                      className={channel === 'preview' ? 'is-active is-preview' : 'is-preview'}
                      type="button"
                      disabled={channelSwitchLocked || !environment?.previewSupported}
                      aria-pressed={channel === 'preview'}
                      title={
                        environment?.previewSupported
                          ? '获取 main 最新成功 CI'
                          : environment?.previewUnsupportedReason || '正在检测平台支持情况'
                      }
                      onClick={() => void selectUpdateChannel('preview')}
                    >
                      <FlaskConical size={16} />
                      <span>
                        <strong>测试版</strong>
                        <small>
                          {environment?.previewSupported
                            ? '获取 main 最新成功 CI'
                            : '当前平台不可用'}
                        </small>
                      </span>
                    </button>
                  </div>
                  {environment && !environment.previewSupported && (
                    <p>{environment.previewUnsupportedReason}</p>
                  )}
                </section>

                {status === 'checking' && (
                  <div className="update-state">
                    <RefreshCw size={28} className="spin" />
                    <strong>正在检查新版本</strong>
                    <span>
                      {channel === 'preview'
                        ? '正在获取 main 最新成功 CI…'
                        : '正在检查最新正式 Release…'}
                    </span>
                  </div>
                )}

                {status === 'current' && (
                  <div className="update-state is-current">
                    <CheckCircle2 size={30} />
                    <strong>{updateChannelLabel(channel)}通道暂无可用更新</strong>
                    <span>
                      {currentVersion
                        ? `BiliRec Control ${currentVersion} · ${environment?.platformLabel || ''}`
                        : '无需更新'}
                    </span>
                  </div>
                )}

                {(status === 'available' ||
                  status === 'downloading' ||
                  status === 'downloaded' ||
                  status === 'installing') && (
                  <>
                    <div className="update-version-card">
                      <span>
                        <small>当前版本</small>
                        <strong>{currentVersion || '—'}</strong>
                      </span>
                      <Rocket size={22} />
                      <span>
                        <small>可用版本</small>
                        <strong>{availableVersion || '—'}</strong>
                      </span>
                    </div>

                    <div className="update-release-notes">
                      <header>
                        <strong>版本说明</strong>
                        {releaseDate && (
                          <span>{new Date(releaseDate).toLocaleDateString('zh-CN')}</span>
                        )}
                      </header>
                      <div className="update-release-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          skipHtml
                          components={{
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                onClick={(event) => {
                                  event.preventDefault();
                                  if (href) void openReleaseLink(href);
                                }}
                              >
                                {children}
                                <ExternalLink size={10} aria-hidden="true" />
                              </a>
                            ),
                            img: ({ alt }) => (
                              <span className="update-markdown-image">
                                {alt ? `图片：${alt}` : '图片已隐藏'}
                              </span>
                            )
                          }}
                        >
                          {releaseNotes}
                        </ReactMarkdown>
                      </div>
                    </div>

                    {status === 'downloading' && (
                      <div className="update-progress">
                        <div>
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        <p>
                          <span>
                            {downloadAttempt > 1
                              ? `连接不稳定，正在重试（${downloadAttempt}/${MAX_REQUEST_ATTEMPTS}）`
                              : totalBytes
                                ? `正在下载并校验 ${progress}%`
                                : '正在准备更新包'}
                          </span>
                          {totalBytes > 0 && (
                            <span>
                              {(downloadedBytes / 1024 / 1024).toFixed(1)} /{' '}
                              {(totalBytes / 1024 / 1024).toFixed(1)} MB
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {status === 'downloaded' && (
                      <div className="update-ready">
                        <CheckCircle2 size={18} />
                        更新包已下载并完成签名校验。安装时应用将自动重启。
                      </div>
                    )}

                    {status === 'installing' && (
                      <div className="update-ready is-installing">
                        <LoaderCircle size={18} className="spin" />
                        正在安装更新，请勿关闭应用…
                      </div>
                    )}

                    <div className="update-security-note">
                      <ShieldCheck size={18} />
                      <p>
                        {channel === 'preview'
                          ? '测试包来自 main 最新成功 CI，并使用与稳定版相同的更新密钥校验。'
                          : '稳定版仅从正式 Release 获取，更新文件会自动完成签名校验。'}
                      </p>
                    </div>
                  </>
                )}

                {status === 'error' && (
                  <div className="update-state is-error">
                    <CloudDownload size={30} />
                    <strong>{failure ? failureTitles[failure.stage] : '更新失败'}</strong>
                    <span>{failure?.message || '请稍后重试。'}</span>
                    {failure?.details && (
                      <details className="update-error-details">
                        <summary>查看技术详情</summary>
                        <code>{failure.details}</code>
                      </details>
                    )}
                  </div>
                )}
              </div>

              <footer className="modal-actions update-actions">
                <span>
                  {updateChannelLabel(channel)}通道
                  {currentVersion ? ` · 当前版本 ${currentVersion}` : ''}
                </span>
                <div>
                  {status === 'error' && failure?.stage !== 'restart' && (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={openReleasePage}
                    >
                      <ExternalLink size={15} />
                      {channel === 'preview' ? '查看测试构建' : '手动下载'}
                    </button>
                  )}
                  {status === 'available' && (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void downloadUpdate()}
                    >
                      <Download size={16} />
                      下载更新
                    </button>
                  )}
                  {status === 'downloaded' && (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void installUpdate()}
                    >
                      <Rocket size={16} />
                      安装并重启
                    </button>
                  )}
                  {status === 'error' && failure && (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={retryFailedOperation}
                    >
                      <RefreshCw size={15} />
                      {retryLabels[failure.stage]}
                    </button>
                  )}
                </div>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
