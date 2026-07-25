'use client';

import {
  Code2,
  ExternalLink,
  Info,
  MonitorCog,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openExternalUrl } from '@/lib/api';
import type { ToastItem } from '@/lib/types';

type Props = {
  notify: (message: string, tone?: ToastItem['tone']) => void;
};

const REPOSITORY_URL = 'https://github.com/demogest/BiliRecControl';
const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`;

function runningInTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export default function AboutCenter({ notify }: Props) {
  const [portalReady, setPortalReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [appName, setAppName] = useState('BiliRec Control');
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    setPortalReady(true);
    if (!runningInTauri()) return;

    void import('@tauri-apps/api/app')
      .then(async ({ getName, getVersion }) => {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        setAppName(name);
        setAppVersion(version);
      })
      .catch(() => undefined);
  }, []);

  const closeAbout = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAbout();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAbout, open]);

  const openLink = useCallback(
    async (url: string) => {
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

  return (
    <>
      <button
        className="top-icon-button about-trigger"
        type="button"
        onClick={() => setOpen(true)}
        title="关于 BiliRec Control"
        aria-label="关于 BiliRec Control"
      >
        <Info size={18} />
      </button>

      {portalReady &&
        open &&
        createPortal(
          <div
            className="modal-backdrop about-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeAbout();
            }}
          >
            <section
              className="modal-card about-modal"
              role="dialog"
              aria-modal="true"
              aria-label="关于 BiliRec Control"
            >
              <header className="modal-header">
                <div>
                  <span className="section-kicker">ABOUT APPLICATION</span>
                  <h2>关于</h2>
                  <p>版本与项目信息</p>
                </div>
                <button
                  className="modal-close"
                  type="button"
                  onClick={closeAbout}
                  aria-label="关闭关于窗口"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="modal-body about-modal-body">
                <section className="about-identity">
                  <div className="about-app-mark" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span />
                  </div>
                  <div>
                    <span>LOCAL RECORDING OPERATIONS</span>
                    <h3>{appName}</h3>
                    <p>简洁、可靠的录播姬桌面控制工具</p>
                  </div>
                  <strong>v{appVersion || '开发预览'}</strong>
                </section>

                <section className="about-capabilities">
                  <article>
                    <MonitorCog size={18} />
                    <div>
                      <strong>状态一览</strong>
                      <span>直播与录制情况清晰可见</span>
                    </div>
                  </article>
                  <article>
                    <ShieldCheck size={18} />
                    <div>
                      <strong>安全更新</strong>
                      <span>自动校验更新文件</span>
                    </div>
                  </article>
                  <article>
                    <Sparkles size={18} />
                    <div>
                      <strong>常用工具</strong>
                      <span>录制管理与快捷播放</span>
                    </div>
                  </article>
                </section>

                <section className="about-meta">
                  <div>
                    <span>更新通道</span>
                    <strong>正式版</strong>
                  </div>
                  <div>
                    <span>开源许可</span>
                    <strong>MIT License</strong>
                  </div>
                  <div>
                    <span>项目仓库</span>
                    <strong>demogest/BiliRecControl</strong>
                  </div>
                </section>
              </div>

              <footer className="modal-actions about-actions">
                <span>REC / CTRL · 为日常录制而设计</span>
                <div>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void openLink(REPOSITORY_URL)}
                  >
                    <Code2 size={15} />
                    GitHub 仓库
                  </button>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => void openLink(RELEASES_URL)}
                  >
                    <ExternalLink size={15} />
                    最新版本
                  </button>
                </div>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
