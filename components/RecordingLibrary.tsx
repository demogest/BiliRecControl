'use client';

import {
  Archive,
  Check,
  Clapperboard,
  Copy,
  FileCode2,
  FileQuestion,
  Film,
  FolderArchive,
  HardDrive,
  LoaderCircle,
  MonitorPlay,
  RefreshCw,
  Search,
  Server,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getMpvStatus,
  loadRecordingHistory,
  playRecordingWithMpv
} from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type {
  ConnectionSettings,
  HistoryFile,
  HistoryOverview,
  MpvStatus,
  ToastItem
} from '@/lib/types';

type FileFilter = 'all' | 'video' | 'danmaku' | 'other';
type FileSort = 'newest' | 'oldest' | 'largest' | 'smallest';

type Props = {
  open: boolean;
  connection: ConnectionSettings;
  initialRoomId: number | null;
  onClose: () => void;
  notify: (message: string, tone?: ToastItem['tone']) => void;
};

function formatDate(value: string | null, withTime = true) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }
      : {})
  });
}

function fileKind(file: HistoryFile) {
  if (file.isVideo) return 'video';
  if (file.isDanmaku) return 'danmaku';
  return 'other';
}

function FileIcon({ file }: { file: HistoryFile }) {
  if (file.isVideo) return <Film size={17} />;
  if (file.isDanmaku) return <FileCode2 size={17} />;
  return <FileQuestion size={17} />;
}

export default function RecordingLibrary({
  open,
  connection,
  initialRoomId,
  onClose,
  notify
}: Props) {
  const [overview, setOverview] = useState<HistoryOverview | null>(null);
  const [mpv, setMpv] = useState<MpvStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FileFilter>('all');
  const [sort, setSort] = useState<FileSort>('newest');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [history, player] = await Promise.all([
        loadRecordingHistory(connection),
        getMpvStatus()
      ]);
      setOverview(history);
      setMpv(player);
      if (
        initialRoomId &&
        history.rooms.some((room) => room.roomId === initialRoomId)
      ) {
        setSelectedRoomId(initialRoomId);
      } else {
        setSelectedRoomId('all');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [connection, initialRoomId, notify]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFilter('all');
    void load();
  }, [load, open]);

  const files = useMemo(() => {
    if (!overview) return [];
    const source =
      selectedRoomId === 'all'
        ? overview.rooms.flatMap((room) => room.files)
        : overview.rooms.find((room) => room.roomId === selectedRoomId)?.files || [];
    const normalizedQuery = query.trim().toLowerCase();

    return [...source]
      .filter((file) => {
        if (filter !== 'all' && fileKind(file) !== filter) return false;
        if (!normalizedQuery) return true;
        return [file.name, file.roomName, file.roomId, file.extension]
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        if (sort === 'oldest') return left.lastModified.localeCompare(right.lastModified);
        if (sort === 'largest') return right.size - left.size;
        if (sort === 'smallest') return left.size - right.size;
        return right.lastModified.localeCompare(left.lastModified);
      });
  }, [filter, overview, query, selectedRoomId, sort]);

  const selectedRoom =
    selectedRoomId === 'all'
      ? null
      : overview?.rooms.find((room) => room.roomId === selectedRoomId) || null;

  const play = async (file: HistoryFile) => {
    if (!mpv?.installed) {
      notify('未检测到 MPV，请先安装 MPV 后重试', 'error');
      return;
    }
    setPlayingUrl(file.url);
    try {
      await playRecordingWithMpv(
        connection,
        file.url,
        `${file.roomName} · ${file.name}`
      );
      notify(`已交给 MPV 播放：${file.name}`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setPlayingUrl(null);
    }
  };

  const copyPath = async (file: HistoryFile) => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopiedUrl(file.url);
      window.setTimeout(() => setCopiedUrl(null), 1600);
      notify('已复制录播姬文件路径', 'success');
    } catch {
      notify('复制文件路径失败', 'error');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop library-backdrop" role="presentation">
      <section className="library-modal" aria-label="录制资料库">
        <header className="library-header">
          <div className="library-heading">
            <span className="library-mark">
              <Archive size={20} />
            </span>
            <div>
              <span className="section-kicker">RECORDING ARCHIVE</span>
              <h2>录制资料库</h2>
              <p>历史录制统计与录播目录文件管理</p>
            </div>
          </div>
          <div className="library-header-actions">
            <span className={`mpv-chip ${mpv?.installed ? 'is-ready' : ''}`}>
              <MonitorPlay size={13} />
              {mpv?.installed ? mpv.version || 'MPV 已就绪' : '未检测到 MPV'}
            </span>
            <button
              className="button button-secondary"
              type="button"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              刷新资料库
            </button>
            <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="library-stats">
          <div>
            <FolderArchive size={18} />
            <span>
              <small>有历史的房间</small>
              <strong>{overview?.roomCount ?? '—'}</strong>
            </span>
          </div>
          <div>
            <Clapperboard size={18} />
            <span>
              <small>视频文件</small>
              <strong>{overview?.videoCount ?? '—'}</strong>
            </span>
          </div>
          <div>
            <FileCode2 size={18} />
            <span>
              <small>弹幕文件</small>
              <strong>{overview?.danmakuCount ?? '—'}</strong>
            </span>
          </div>
          <div>
            <HardDrive size={18} />
            <span>
              <small>视频占用</small>
              <strong>{overview ? formatBytes(overview.totalVideoBytes) : '—'}</strong>
            </span>
          </div>
          <div>
            <Server size={18} />
            <span>
              <small>最近录制</small>
              <strong className="date-value">
                {formatDate(overview?.latestRecordedAt || null)}
              </strong>
            </span>
          </div>
        </div>

        <div className="library-workspace">
          <aside className="history-sidebar">
            <div className="history-sidebar-title">
              <span>房间历史</span>
              <b>{overview?.rooms.length || 0}</b>
            </div>
            <button
              className={`history-room all-history ${selectedRoomId === 'all' ? 'active' : ''}`}
              type="button"
              onClick={() => setSelectedRoomId('all')}
            >
              <span className="history-avatar">
                <Archive size={16} />
              </span>
              <span className="history-room-copy">
                <strong>全部录制</strong>
                <small>{overview?.videoCount || 0} 个视频文件</small>
              </span>
              <b>{overview ? formatBytes(overview.totalVideoBytes) : '—'}</b>
            </button>

            <div className="history-room-list">
              {overview?.rooms.map((room) => (
                <button
                  key={room.roomId}
                  className={`history-room ${selectedRoomId === room.roomId ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSelectedRoomId(room.roomId)}
                >
                  <span className="history-avatar">
                    {room.roomName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="history-room-copy">
                    <strong title={room.roomName}>{room.roomName}</strong>
                    <small>
                      ROOM {room.roomId} · {room.videoCount} 段
                    </small>
                    <i>
                      <span
                        style={{
                          width: `${
                            overview.totalVideoBytes
                              ? Math.max(
                                  (room.totalVideoBytes / overview.totalVideoBytes) * 100,
                                  3
                                )
                              : 0
                          }%`
                        }}
                      />
                    </i>
                  </span>
                  <b>{formatBytes(room.totalVideoBytes)}</b>
                </button>
              ))}
            </div>
          </aside>

          <main className="file-manager">
            <div className="file-manager-head">
              <div>
                <span className="section-kicker">FILE MANAGER</span>
                <h3>{selectedRoom?.roomName || '全部录制文件'}</h3>
                <p>
                  {selectedRoom
                    ? `${selectedRoom.videoCount} 个视频 · ${selectedRoom.danmakuCount} 个弹幕 · ${formatBytes(selectedRoom.totalBytes)}`
                    : `${files.length} 个文件，来自 ${overview?.roomCount || 0} 个房间`}
                </p>
              </div>
              <div className="file-toolbar">
                <label className="search-box file-search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索文件名或主播"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                      <X size={13} />
                    </button>
                  )}
                </label>
                <select value={sort} onChange={(event) => setSort(event.target.value as FileSort)}>
                  <option value="newest">最新优先</option>
                  <option value="oldest">最早优先</option>
                  <option value="largest">容量从大到小</option>
                  <option value="smallest">容量从小到大</option>
                </select>
              </div>
            </div>

            <div className="file-filter-tabs">
              {(
                [
                  ['all', '全部'],
                  ['video', '视频'],
                  ['danmaku', '弹幕 XML'],
                  ['other', '其他']
                ] as Array<[FileFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  type="button"
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="file-table">
              <div className="file-table-header">
                <span>文件</span>
                <span>房间</span>
                <span>修改时间</span>
                <span>大小</span>
                <span>操作</span>
              </div>

              <div className="file-table-body">
                {loading && !overview ? (
                  <div className="library-loading">
                    <LoaderCircle size={25} className="spin" />
                    <span>正在扫描录播目录并聚合历史记录</span>
                  </div>
                ) : files.length ? (
                  files.map((file) => (
                    <article className="file-row" key={`${file.url}-${file.lastModified}`}>
                      <div className={`file-icon file-icon-${fileKind(file)}`}>
                        <FileIcon file={file} />
                      </div>
                      <div className="file-name" title={file.name}>
                        <strong>{file.name}</strong>
                        <small>{file.extension.toUpperCase() || 'FILE'}</small>
                      </div>
                      <div className="file-room" title={file.roomName}>
                        <strong>{file.roomName}</strong>
                        <small>ROOM {file.roomId}</small>
                      </div>
                      <time>{formatDate(file.lastModified)}</time>
                      <span className="file-size">{formatBytes(file.size)}</span>
                      <div className="file-actions">
                        {file.isVideo && (
                          <button
                            className="file-play-button"
                            type="button"
                            disabled={!mpv?.installed || playingUrl === file.url}
                            onClick={() => void play(file)}
                            title={mpv?.installed ? '使用 MPV 播放' : '未检测到 MPV'}
                          >
                            {playingUrl === file.url ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <MonitorPlay size={15} />
                            )}
                            MPV
                          </button>
                        )}
                        <button
                          className="file-copy-button"
                          type="button"
                          onClick={() => void copyPath(file)}
                          title="复制录播姬文件路径"
                        >
                          {copiedUrl === file.url ? <Check size={15} /> : <Copy size={15} />}
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="library-empty">
                    <Archive size={30} />
                    <strong>没有匹配的录制文件</strong>
                    <span>尝试切换房间、文件类型或搜索条件</span>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        <footer className="library-footer">
          <span>
            文件列表来自录播姬只读 API；当前版本不提供远程删除，避免误删录制文件。
          </span>
          <span>{mpv?.path ? `MPV: ${mpv.path}` : 'MPV 未配置'}</span>
        </footer>
      </section>
    </div>
  );
}
