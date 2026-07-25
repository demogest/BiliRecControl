'use client';

import {
  CheckCircle2,
  CloudDownload,
  Download,
  ExternalLink,
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
import { openExternalUrl } from '@/lib/api';
import type { ToastItem } from '@/lib/types';

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

type Props = {
  notify: (message: string, tone?: ToastItem['tone']) => void;
};

function runningInTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export default function UpdateCenter({ notify }: Props) {
  const [portalReady, setPortalReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [availableVersion, setAvailableVersion] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const updateRef = useRef<Update | null>(null);
  const automaticCheckTimer = useRef<number | null>(null);
  const checkPromise = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!runningInTauri()) return;
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setCurrentVersion)
      .catch(() => undefined);
  }, []);

  const checkForUpdates = useCallback(
    async (silent = false) => {
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
            setErrorMessage('请在已安装的桌面应用中使用更新功能。');
          }
          return;
        }

        setStatus('checking');
        setErrorMessage('');
        if (!silent) setOpen(true);

        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check({ timeout: 15_000 });
          if (!update) {
            setStatus('current');
            if (!silent) notify('当前已经是最新版本', 'success');
            return;
          }

          if (updateRef.current && updateRef.current !== update) {
            await updateRef.current.close().catch(() => undefined);
          }
          updateRef.current = update;
          setCurrentVersion(update.currentVersion);
          setAvailableVersion(update.version);
          setReleaseDate(update.date || '');
          setReleaseNotes(update.body || '此版本暂无更新说明。');
          setStatus('available');
          setOpen(true);
          notify(`发现新版本 ${update.version}`, 'info');
        } catch (error) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : String(error));
          if (!silent) notify('检查更新失败', 'error');
        }
      })();

      checkPromise.current = operation;
      try {
        await operation;
      } finally {
        if (checkPromise.current === operation) {
          checkPromise.current = null;
        }
      }
    },
    [notify]
  );

  useEffect(() => {
    if (!runningInTauri()) return;

    automaticCheckTimer.current = window.setTimeout(() => {
      automaticCheckTimer.current = null;
      void checkForUpdates(true);
    }, 4_000);

    return () => {
      if (automaticCheckTimer.current !== null) {
        window.clearTimeout(automaticCheckTimer.current);
        automaticCheckTimer.current = null;
      }
    };
  }, [checkForUpdates]);

  const closeUpdateModal = useCallback(() => {
    if (status !== 'downloading') setOpen(false);
  }, [status]);

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

  const installUpdate = async () => {
    const update = updateRef.current;
    if (!update) return;

    setStatus('downloading');
    setDownloadedBytes(0);
    setTotalBytes(0);
    setErrorMessage('');

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          setTotalBytes(event.data.contentLength || 0);
        } else if (event.event === 'Progress') {
          setDownloadedBytes((value) => value + event.data.chunkLength);
        } else {
          setStatus('ready');
        }
      });
      setStatus('ready');
      notify('更新安装完成，应用即将重启', 'success');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
      notify('下载或安装更新失败', 'error');
    }
  };

  const progress = totalBytes
    ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
    : 0;

  return (
    <>
      <button
        className={`top-icon-button update-trigger ${
          status === 'available' ? 'has-update' : ''
        }`}
        type="button"
        onClick={() => {
          setOpen(true);
          if (status !== 'available' && status !== 'downloading') {
            void checkForUpdates(false);
          }
        }}
        title={status === 'available' ? `发现新版本 ${availableVersion}` : '检查应用更新'}
        aria-label="检查应用更新"
      >
        <CloudDownload size={18} />
        {status === 'available' && <i />}
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
                disabled={status === 'downloading'}
                onClick={closeUpdateModal}
                aria-label="关闭更新窗口"
              >
                <X size={18} />
              </button>
            </header>

            <div className="modal-body update-modal-body">
              {status === 'checking' && (
                <div className="update-state">
                  <RefreshCw size={28} className="spin" />
                  <strong>正在检查新版本</strong>
                  <span>正在连接更新服务…</span>
                </div>
              )}

              {status === 'current' && (
                <div className="update-state is-current">
                  <CheckCircle2 size={30} />
                  <strong>当前已是最新版本</strong>
                  <span>{currentVersion ? `BiliRec Control ${currentVersion}` : '无需更新'}</span>
                </div>
              )}

              {(status === 'available' || status === 'downloading' || status === 'ready') && (
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
                      {releaseDate && <span>{new Date(releaseDate).toLocaleDateString('zh-CN')}</span>}
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
                        <span>{totalBytes ? `正在下载 ${progress}%` : '正在准备更新包'}</span>
                        {totalBytes > 0 && (
                          <span>
                            {(downloadedBytes / 1024 / 1024).toFixed(1)} /{' '}
                            {(totalBytes / 1024 / 1024).toFixed(1)} MB
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {status === 'ready' && (
                    <div className="update-ready">
                      <CheckCircle2 size={18} />
                      更新已安装，正在重新启动应用…
                    </div>
                  )}

                  <div className="update-security-note">
                    <ShieldCheck size={18} />
                    <p>更新文件会自动校验，确保来源可信。</p>
                  </div>
                </>
              )}

              {status === 'error' && (
                <div className="update-state is-error">
                  <CloudDownload size={30} />
                  <strong>检查更新失败</strong>
                  <span>{errorMessage || '请稍后重试。'}</span>
                </div>
              )}
            </div>

            <footer className="modal-actions update-actions">
              <span>{currentVersion ? `当前版本 ${currentVersion}` : '正式版通道'}</span>
              <div>
                {status !== 'downloading' && status !== 'ready' && (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void checkForUpdates(false)}
                  >
                    <RefreshCw size={15} />
                    重新检查
                  </button>
                )}
                {status === 'available' && (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => void installUpdate()}
                  >
                    <Download size={16} />
                    下载并安装
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
