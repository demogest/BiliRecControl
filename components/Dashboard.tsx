'use client';

import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  CalendarClock,
  ChevronRight,
  CircleStop,
  Clock3,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  Gauge,
  HardDrive,
  Info,
  KeyRound,
  Maximize2,
  MessageSquareText,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Scissors,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  SquareActivity,
  Trash2,
  Video,
  X,
  Zap
} from 'lucide-react';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bilirecRequest, openLiveRoom } from '@/lib/api';
import AboutCenter from '@/components/AboutCenter';
import ConfigurationCenter from '@/components/ConfigurationCenter';
import RecordingLibrary from '@/components/RecordingLibrary';
import StreamerAvatar from '@/components/StreamerAvatar';
import UpdateCenter from '@/components/UpdateCenter';
import { useRoomAvatars } from '@/lib/use-room-avatars';
import { parseBilibiliRoomId } from '@/lib/room-input';
import {
  finiteNumber,
  formatBytes,
  formatDuration,
  formatLogMessage,
  formatLogTime,
  formatRate,
  logLevel,
  parseLog
} from '@/lib/format';
import type {
  ConnectionSettings,
  LogEntry,
  LogPayload,
  RecorderVersion,
  Room,
  RoomFilter,
  ToastItem
} from '@/lib/types';

const STORAGE_KEY = 'bilirec-control.connection.v1';
const DEFAULT_SETTINGS: ConnectionSettings = {
  apiUrl: 'http://192.168.5.66:2356',
  username: '',
  password: '',
  rememberPassword: true
};

type ConfirmState = {
  title: string;
  message: string;
  actionLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
};

function isConfigured(connection: ConnectionSettings) {
  return Boolean(connection.apiUrl.trim() && connection.username.trim() && connection.password);
}

function parseSessionStart(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  return date;
}

function formatSessionStart(date: Date | null) {
  if (!date) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function MetricCard({
  tone,
  icon,
  label,
  value,
  detail,
  index,
  children
}: {
  tone: 'cyan' | 'green' | 'red' | 'violet' | 'amber';
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: ReactNode;
  index: string;
  children?: ReactNode;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-topline">
        <span className="metric-icon">{icon}</span>
        <span className="metric-index">{index}</span>
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
      {children}
    </article>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (values.length < 2) return '0,36 100,36';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 38 - ((value - min) / range) * 30;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values]);

  return (
    <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,42 ${points} 100,42`} fill="url(#sparkFill)" />
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RoomCard({
  room,
  busy,
  onAction,
  onDelete,
  onHistory,
  onConfigure,
  onWatch,
  avatarSrc
}: {
  room: Room;
  busy: boolean;
  onAction: (room: Room, action: 'start' | 'stop' | 'split' | 'refresh') => void;
  onDelete: (room: Room) => void;
  onHistory: (room: Room) => void;
  onConfigure: (room: Room) => void;
  onWatch: (room: Room) => void;
  avatarSrc?: string | null;
}) {
  const status = room.recording ? 'recording' : room.streaming ? 'live' : 'offline';
  const statusLabel = room.recording ? '录制中' : room.streaming ? '直播中' : '离线';
  const ratio = finiteNumber(room.recordingStats?.durationRatio);
  const ratioPercent = room.recording ? Math.min(Math.max(ratio * 100, 0), 100) : 0;
  const sessionStartedAt = room.recording ? parseSessionStart(room.ioStats?.startTime) : null;

  return (
    <article className={`room-card room-${status}`}>
      <div className="room-card-glow" />
      <header className="room-card-header">
        <div className="room-identity">
          <StreamerAvatar
            className="room-avatar"
            roomId={room.roomId}
            name={room.name}
            src={avatarSrc}
          >
            <i className={`room-presence presence-${status}`} />
          </StreamerAvatar>
          <div className="room-name-group">
            <h3 title={room.name || undefined}>{room.name || `房间 ${room.roomId}`}</h3>
            <span>
              ROOM {room.roomId}
              {room.shortId ? ` · 短号 ${room.shortId}` : ''}
            </span>
          </div>
        </div>
        <div className="room-card-menu">
          <span className={`room-status status-${status}`}>
            <i />
            {statusLabel}
          </span>
          <button
            className="icon-ghost danger-hover"
            type="button"
            title="删除房间"
            disabled={busy}
            onClick={() => onDelete(room)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="room-title" title={room.title || undefined}>
        {room.title || '暂无直播标题'}
      </div>

      <div className="room-tags">
        <span>{room.areaNameParent || '未分类'}</span>
        {room.areaNameChild && <span>{room.areaNameChild}</span>}
        {room.autoRecord && <span className="auto-tag">AUTO</span>}
      </div>

      <div className="record-progress">
        <div className="record-progress-meta">
          <span>{room.recording ? '录制速度' : '录制待机'}</span>
          <strong>{room.recording ? `${(ratio * 100).toFixed(1)}%` : '—'}</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${ratioPercent}%` }} />
        </div>
      </div>

      <div className="room-stats">
        <div>
          <CalendarClock size={15} />
          <span>
            <small>会话开始</small>
            <strong title={sessionStartedAt?.toLocaleString('zh-CN')}>
              {formatSessionStart(sessionStartedAt)}
            </strong>
          </span>
        </div>
        <div>
          <Clock3 size={15} />
          <span>
            <small>录制时长</small>
            <strong>{formatDuration(room.recordingStats?.sessionDuration || 0)}</strong>
          </span>
        </div>
        <div>
          <ArrowDownToLine size={15} />
          <span>
            <small>网络速率</small>
            <strong>{formatRate(room.ioStats?.networkMbps || 0)}</strong>
          </span>
        </div>
        <div>
          <HardDrive size={15} />
          <span>
            <small>会话大小</small>
            <strong>
              {room.recording
                ? formatBytes(finiteNumber(room.recordingStats?.totalOutputBytes))
                : '—'}
            </strong>
          </span>
        </div>
      </div>

      <footer className="room-card-actions">
        <button
          className="room-action action-history"
          type="button"
          onClick={() => onHistory(room)}
        >
          <Archive size={15} />
          历史
        </button>
        <button
          className="room-action action-config"
          type="button"
          onClick={() => onConfigure(room)}
        >
          <Settings2 size={15} />
          设置
        </button>
        <button
          className="room-action action-watch"
          type="button"
          onClick={() => onWatch(room)}
          title={`在线观看 ${room.name || room.roomId}`}
        >
          <ExternalLink size={15} />
          观看
        </button>
        {room.recording ? (
          <>
            <button
              className="room-action action-stop"
              type="button"
              disabled={busy}
              onClick={() => onAction(room, 'stop')}
            >
              <CircleStop size={15} />
              停止
            </button>
            <button
              className="room-action"
              type="button"
              disabled={busy}
              onClick={() => onAction(room, 'split')}
            >
              <Scissors size={15} />
              分段
            </button>
          </>
        ) : (
          <button
            className="room-action action-start"
            type="button"
            disabled={busy}
            onClick={() => onAction(room, 'start')}
          >
            <Play size={15} fill="currentColor" />
            开始录制
          </button>
        )}
        <button
          className="room-action action-icon"
          type="button"
          title="刷新房间信息"
          disabled={busy}
          onClick={() => onAction(room, 'refresh')}
        >
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
      </footer>
    </article>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const level = logLevel(log);
  const roomId = typeof log.RoomId === 'number' ? log.RoomId : null;
  const message = formatLogMessage(log);

  return (
    <article className={`log-row log-${level}`}>
      <div className="log-marker">
        {level === 'error' ? (
          <AlertTriangle size={14} />
        ) : level === 'warning' ? (
          <ShieldAlert size={14} />
        ) : level === 'debug' ? (
          <Gauge size={14} />
        ) : (
          <Info size={14} />
        )}
      </div>
      <div className="log-content">
        <div className="log-meta">
          <time>{formatLogTime(log['@t'])}</time>
          <span>{level === 'information' ? 'INFO' : level.toUpperCase()}</span>
          {roomId && <b>ROOM {roomId}</b>}
        </div>
        <p title={message}>{message}</p>
      </div>
    </article>
  );
}

export default function Dashboard() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<ConnectionSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState<ConnectionSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const avatarByRoom = useRoomAvatars(rooms.map((room) => room.roomId));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [version, setVersion] = useState<RecorderVersion | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [query, setQuery] = useState('');
  const [networkHistory, setNetworkHistory] = useState<number[]>([]);
  const [busyRoomId, setBusyRoomId] = useState<number | null>(null);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryRoomId, setLibraryRoomId] = useState<number | null>(null);
  const [configCenterOpen, setConfigCenterOpen] = useState(false);
  const [configRoomId, setConfigRoomId] = useState<number | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [newRoomInput, setNewRoomInput] = useState('');
  const [newRoomAutoRecord, setNewRoomAutoRecord] = useState(true);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [clock, setClock] = useState<Date | null>(null);
  const logCursor = useRef(0);
  const toastSequence = useRef(0);
  const connectionAttempted = useRef(false);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', disableContextMenu);
    return () => document.removeEventListener('contextmenu', disableContextMenu);
  }, []);

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = ++toastSequence.current;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    let restored = DEFAULT_SETTINGS;
    if (saved) {
      try {
        restored = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setSettings(restored);
    setDraftSettings(restored);
    setSettingsOpen(!isConfigured(restored));
    setHydrated(true);
  }, []);

  useEffect(() => {
    setClock(new Date());
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadLogs = useCallback(async (connection: ConnectionSettings) => {
    const queryPath = `/api/log/fetch?after=${logCursor.current}`;
    const payload = await bilirecRequest<LogPayload>(connection, queryPath);
    logCursor.current = payload.cursor;
    const incoming = (payload.logs || []).map(parseLog);
    if (incoming.length) {
      setLogs((current) => [...current, ...incoming].slice(-100));
    }
  }, []);

  const refreshData = useCallback(
    async (connection = settings, silent = false) => {
      if (!isConfigured(connection)) return false;
      if (!silent) setLoading(true);

      try {
        const [roomData, versionData] = await Promise.all([
          bilirecRequest<Room[]>(connection, '/api/room'),
          bilirecRequest<RecorderVersion>(connection, '/api/version')
        ]);

        setRooms(roomData);
        setVersion(versionData);
        setConnected(true);
        setLastUpdated(new Date());
        const throughput = roomData.reduce(
          (sum, room) => sum + finiteNumber(room.ioStats?.networkMbps),
          0
        );
        setNetworkHistory((values) => [...values, throughput].slice(-24));

        try {
          await loadLogs(connection);
        } catch {
          // 房间主数据可用时，日志拉取失败不应中断整个大屏。
        }

        if (!connectionAttempted.current && !silent) {
          pushToast('已连接，数据正在同步', 'success');
        }
        connectionAttempted.current = true;
        return true;
      } catch (error) {
        setConnected(false);
        if (!silent) {
          pushToast(error instanceof Error ? error.message : String(error), 'error');
        }
        return false;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadLogs, pushToast, settings]
  );

  useEffect(() => {
    if (!hydrated || !isConfigured(settings)) return;
    void refreshData(settings, false);
  }, [hydrated, refreshData, settings]);

  useEffect(() => {
    if (!hydrated || !connected || refreshInterval <= 0) return;
    const timer = window.setInterval(() => {
      void refreshData(settings, true);
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [connected, hydrated, refreshData, refreshInterval, settings]);

  const liveRooms = rooms.filter((room) => room.streaming);
  const recordingRooms = rooms.filter((room) => room.recording);
  const offlineRooms = rooms.filter((room) => !room.streaming);
  const totalNetwork = rooms.reduce(
    (sum, room) => sum + finiteNumber(room.ioStats?.networkMbps),
    0
  );
  const totalRecordingBytes = recordingRooms.reduce(
    (sum, room) => sum + finiteNumber(room.recordingStats?.totalOutputBytes),
    0
  );
  const averageRatio = recordingRooms.length
    ? recordingRooms.reduce(
        (sum, room) => sum + finiteNumber(room.recordingStats?.durationRatio),
        0
      ) / recordingRooms.length
    : 0;
  const sessionStart =
    recordingRooms
      .map((room) => parseSessionStart(room.ioStats?.startTime))
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0] || null;
  const sessionElapsed =
    sessionStart && clock ? Math.max(clock.getTime() - sessionStart.getTime(), 0) : 0;

  const visibleRooms = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...rooms]
      .filter((room) => {
        if (filter === 'recording' && !room.recording) return false;
        if (filter === 'live' && !room.streaming) return false;
        if (filter === 'offline' && room.streaming) return false;
        if (!normalizedQuery) return true;
        return [room.name, room.title, room.roomId, room.areaNameParent, room.areaNameChild]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      })
      .sort(
        (a, b) =>
          Number(b.recording) - Number(a.recording) ||
          Number(b.streaming) - Number(a.streaming) ||
          String(a.name).localeCompare(String(b.name), 'zh-CN')
      );
  }, [filter, query, rooms]);

  const logCounts = useMemo(
    () =>
      logs.reduce<{ error: number; warning: number; info: number }>(
        (counts, log) => {
          const level = logLevel(log);
          if (level === 'error') counts.error += 1;
          else if (level === 'warning') counts.warning += 1;
          else counts.info += 1;
          return counts;
        },
        { error: 0, warning: 0, info: 0 }
      ),
    [logs]
  );
  const parsedNewRoomId = useMemo(() => parseBilibiliRoomId(newRoomInput), [newRoomInput]);

  const persistSettings = (connection: ConnectionSettings) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...connection,
        password: connection.rememberPassword ? connection.password : ''
      })
    );
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await bilirecRequest<RecorderVersion>(draftSettings, '/api/version');
      pushToast(`连接成功 · ${result.semVer}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    persistSettings(draftSettings);
    setSettings(draftSettings);
    setSettingsOpen(false);
    setRooms([]);
    setLogs([]);
    logCursor.current = 0;
    connectionAttempted.current = false;
    await refreshData(draftSettings, false);
  };

  const clearCredentials = () => {
    localStorage.removeItem(STORAGE_KEY);
    const cleared = { ...DEFAULT_SETTINGS };
    setDraftSettings(cleared);
    setSettings(cleared);
    setRooms([]);
    setLogs([]);
    setVersion(null);
    setConnected(false);
    logCursor.current = 0;
    pushToast('已清除保存的登录信息', 'info');
  };

  const runRoomAction = async (room: Room, action: 'start' | 'stop' | 'split' | 'refresh') => {
    setBusyRoomId(room.roomId);
    const labels = {
      start: '开始录制',
      stop: '停止录制',
      split: '手动分段',
      refresh: '刷新信息'
    };
    try {
      await bilirecRequest<Room>(settings, `/api/room/${room.roomId}/${action}`, 'POST');
      pushToast(`${room.name || room.roomId}：${labels[action]}成功`, 'success');
      await refreshData(settings, true);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyRoomId(null);
    }
  };

  const requestRoomAction = (room: Room, action: 'start' | 'stop' | 'split' | 'refresh') => {
    if (action === 'stop') {
      setConfirmState({
        title: '停止当前录制？',
        message: `将停止「${room.name || room.roomId}」的本次录制。已有文件会保留。`,
        actionLabel: '停止录制',
        danger: true,
        run: () => runRoomAction(room, action)
      });
      return;
    }
    void runRoomAction(room, action);
  };

  const requestDeleteRoom = (room: Room) => {
    setConfirmState({
      title: '删除直播间？',
      message: `将移除「${room.name || room.roomId}」。已有录制文件不会被删除。`,
      actionLabel: '确认删除',
      danger: true,
      run: async () => {
        setBusyRoomId(room.roomId);
        try {
          await bilirecRequest<Room>(settings, `/api/room/${room.roomId}`, 'DELETE');
          pushToast(`已删除 ${room.name || room.roomId}`, 'success');
          await refreshData(settings, true);
        } finally {
          setBusyRoomId(null);
        }
      }
    });
  };

  const watchLiveRoom = async (room: Room) => {
    const url = `https://live.bilibili.com/${room.roomId}`;
    try {
      if ('__TAURI_INTERNALS__' in window) {
        await openLiveRoom(room.roomId);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '无法打开直播间', 'error');
    }
  };

  const executeConfirmed = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.run();
      setConfirmState(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const addRoom = async (event: FormEvent) => {
    event.preventDefault();
    const roomId = parsedNewRoomId;
    if (!roomId) {
      pushToast('请输入有效的房间号或直播间链接', 'error');
      return;
    }

    setLoading(true);
    try {
      await bilirecRequest<Room>(settings, '/api/room', 'POST', {
        roomId,
        autoRecord: newRoomAutoRecord
      });
      setAddRoomOpen(false);
      setNewRoomInput('');
      pushToast(`已添加房间 ${roomId}`, 'success');
      await refreshData(settings, true);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      pushToast('无法切换全屏显示', 'error');
    }
  };

  const openSettings = () => {
    setDraftSettings(settings);
    setSettingsOpen(true);
  };

  const openLibrary = (roomId: number | null = null) => {
    setLibraryRoomId(roomId);
    setLibraryOpen(true);
  };

  const openConfigCenter = (roomId: number | null = null) => {
    setConfigRoomId(roomId);
    setConfigCenterOpen(true);
  };

  if (!hydrated) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <span />
        </div>
        <p>正在启动</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <i />
            <i />
            <i />
          </div>
          <div>
            <strong>
              REC <em>/</em> CTRL
            </strong>
            <small>录播姬控制中心</small>
          </div>
        </div>

        <div className="topbar-right">
          <div className={`system-chip ${connected ? 'is-online' : ''}`}>
            <span />
            {connected ? '服务正常' : '等待连接'}
          </div>
          <div className="clock">
            <strong>{clock?.toLocaleTimeString('zh-CN', { hour12: false }) || '--:--:--'}</strong>
            <span>
              {clock?.toLocaleDateString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                weekday: 'short'
              }) || '----/--/--'}
            </span>
          </div>
          <button className="top-icon-button" type="button" onClick={toggleFullscreen} title="全屏">
            <Maximize2 size={18} />
          </button>
          <UpdateCenter notify={pushToast} />
          <AboutCenter notify={pushToast} />
          <button className="connection-button" type="button" onClick={openSettings}>
            <span className={connected ? 'online' : ''} />
            <div>
              <small>服务连接</small>
              <strong>{connected ? version?.semVer || '已连接' : '连接设置'}</strong>
            </div>
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero" id="overview">
          <div>
            <div className="eyebrow">
              <span />
              LIVE OPERATIONS
            </div>
            <h1>录制总览</h1>
            <p>查看直播、录制和存储状态</p>
          </div>
          <div className="hero-controls">
            <label className="refresh-select">
              <span>自动刷新</span>
              <select
                value={refreshInterval}
                onChange={(event) => setRefreshInterval(Number(event.target.value))}
              >
                <option value={3000}>3 秒</option>
                <option value={5000}>5 秒</option>
                <option value={10000}>10 秒</option>
                <option value={30000}>30 秒</option>
                <option value={0}>关闭</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              type="button"
              disabled={loading || !isConfigured(settings)}
              onClick={() => void refreshData(settings, false)}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              刷新
            </button>
            <button
              className={`button button-secondary diagnostics-button ${logsOpen ? 'active' : ''}`}
              type="button"
              disabled={!connected}
              onClick={() => setLogsOpen((value) => !value)}
            >
              <MessageSquareText size={16} />
              运行日志
              {(logCounts.error > 0 || logCounts.warning > 0) && (
                <span>{logCounts.error + logCounts.warning}</span>
              )}
            </button>
            <button
              className="button button-secondary library-button"
              type="button"
              disabled={!connected}
              onClick={() => openLibrary()}
            >
              <Archive size={16} />
              录制资料库
            </button>
            <button
              className="button button-secondary config-center-button"
              type="button"
              disabled={!connected}
              onClick={() => openConfigCenter()}
            >
              <Settings2 size={16} />
              录制设置
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={!connected}
              onClick={() => setAddRoomOpen(true)}
            >
              <Plus size={17} />
              添加房间
            </button>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard
            tone="cyan"
            icon={<Video size={21} />}
            label="房间总数"
            value={connected ? rooms.length : '—'}
            detail={
              <>
                <b>{rooms.filter((room) => room.autoRecord).length}</b> 个自动录制
              </>
            }
            index="01"
          />
          <MetricCard
            tone="green"
            icon={<Radio size={21} />}
            label="正在直播"
            value={connected ? liveRooms.length : '—'}
            detail={
              <>
                <b>{rooms.filter((room) => room.danmakuConnected).length}</b> 个弹幕连接
              </>
            }
            index="02"
          />
          <MetricCard
            tone="red"
            icon={<span className="recording-orb" />}
            label="正在录制"
            value={connected ? recordingRooms.length : '—'}
            detail={
              <>
                <b>{recordingRooms.length ? `${(averageRatio * 100).toFixed(1)}%` : '—'}</b>{' '}
                平均录制速度
              </>
            }
            index="03"
          />
          <MetricCard
            tone="violet"
            icon={<CalendarClock size={21} />}
            label="本次会话开始"
            value={connected ? formatSessionStart(sessionStart) : '—'}
            detail={
              sessionStart
                ? `${recordingRooms.length} 个录制会话 · 已持续 ${formatDuration(sessionElapsed)}`
                : recordingRooms.length
                  ? '正在同步会话时间'
                  : '开始录制后显示'
            }
            index="04"
          />
          <MetricCard
            tone="violet"
            icon={<Activity size={21} />}
            label="网络吞吐"
            value={connected ? formatRate(totalNetwork) : '—'}
            detail="所有录制任务"
            index="05"
          >
            <Sparkline values={networkHistory} />
          </MetricCard>
          <MetricCard
            tone="amber"
            icon={<Database size={21} />}
            label="录制总大小"
            value={connected ? formatBytes(totalRecordingBytes) : '—'}
            detail={`当前会话累计 · ${recordingRooms.length} 个录制中`}
            index="06"
          />
        </section>

        <section className="workspace workspace-focus">
          <div className="rooms-panel panel" id="rooms">
            <div className="panel-header">
              <div>
                <span className="section-kicker">ROOM MATRIX</span>
                <div className="title-line">
                  <h2>房间矩阵</h2>
                  <span>
                    {visibleRooms.length} / {rooms.length}
                  </span>
                </div>
              </div>
              <div className="panel-tools">
                <label className="search-box">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索主播、标题或房间号"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                      <X size={14} />
                    </button>
                  )}
                </label>
                <div className="filter-tabs">
                  {(
                    [
                      ['all', '全部', rooms.length],
                      ['recording', '录制中', recordingRooms.length],
                      ['live', '直播中', liveRooms.length],
                      ['offline', '离线', offlineRooms.length]
                    ] as Array<[RoomFilter, string, number]>
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      className={filter === key ? 'active' : ''}
                      type="button"
                      onClick={() => setFilter(key)}
                    >
                      {label}
                      <span>{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="room-grid">
              {visibleRooms.map((room) => (
                <RoomCard
                  key={room.objectId}
                  room={room}
                  avatarSrc={avatarByRoom[room.roomId]}
                  busy={busyRoomId === room.roomId}
                  onAction={requestRoomAction}
                  onDelete={requestDeleteRoom}
                  onHistory={(selectedRoom) => openLibrary(selectedRoom.roomId)}
                  onConfigure={(selectedRoom) => openConfigCenter(selectedRoom.roomId)}
                  onWatch={(selectedRoom) => void watchLiveRoom(selectedRoom)}
                />
              ))}

              {!visibleRooms.length && (
                <div className="empty-state">
                  <div className="radar">
                    <span />
                    <i />
                  </div>
                  <h3>{connected ? '没有匹配的房间' : '等待连接录播姬'}</h3>
                  <p>
                    {connected ? '试试其他筛选条件，或添加直播间' : '完成连接设置后即可开始使用'}
                  </p>
                  {!connected && (
                    <button className="button button-primary" type="button" onClick={openSettings}>
                      <Settings2 size={16} />
                      配置连接
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {logsOpen && (
            <aside className="events-panel panel diagnostics-panel" id="events">
              <div className="panel-header">
                <div>
                  <span className="section-kicker">EVENT STREAM</span>
                  <h2>实时事件</h2>
                </div>
                <button className="text-button" type="button" onClick={() => setLogs([])}>
                  清空
                </button>
              </div>

              <div className="log-summary">
                <div className="summary-error">
                  <span>错误</span>
                  <strong>{logCounts.error}</strong>
                </div>
                <div className="summary-warning">
                  <span>警告</span>
                  <strong>{logCounts.warning}</strong>
                </div>
                <div className="summary-info">
                  <span>信息</span>
                  <strong>{logCounts.info}</strong>
                </div>
              </div>

              <div className="log-list">
                {logs.length ? (
                  [...logs]
                    .reverse()
                    .map((log, index) => (
                      <LogRow key={`${String(log['@t'] || '')}-${index}`} log={log} />
                    ))
                ) : (
                  <div className="log-empty">
                    <SquareActivity size={30} />
                    <span>暂无实时事件</span>
                  </div>
                )}
              </div>

              <footer className="events-footer">
                <span>
                  <i className={connected ? 'online' : ''} />
                  日志流
                </span>
                <span>
                  {lastUpdated
                    ? `${lastUpdated.toLocaleTimeString('zh-CN', { hour12: false })} 已同步`
                    : '尚未同步'}
                </span>
              </footer>
            </aside>
          )}
        </section>
      </main>

      <RecordingLibrary
        open={libraryOpen}
        connection={settings}
        initialRoomId={libraryRoomId}
        onClose={() => setLibraryOpen(false)}
        notify={pushToast}
      />

      <ConfigurationCenter
        open={configCenterOpen}
        connection={settings}
        rooms={rooms}
        initialRoomId={configRoomId}
        onClose={() => setConfigCenterOpen(false)}
        onRoomsChanged={() => refreshData(settings, true)}
        notify={pushToast}
      />

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card settings-modal" onSubmit={saveSettings}>
            <header className="modal-header">
              <div>
                <span className="section-kicker">CONNECTION</span>
                <h2>连接设置</h2>
                <p>填写录播姬连接信息</p>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>

            <div className="modal-body">
              <label className="field">
                <span>服务地址</span>
                <div className="input-shell">
                  <Server size={17} />
                  <input
                    type="url"
                    required
                    value={draftSettings.apiUrl}
                    onChange={(event) =>
                      setDraftSettings((current) => ({ ...current, apiUrl: event.target.value }))
                    }
                    placeholder="http://192.168.5.66:2356"
                  />
                </div>
                <small>例如 http://192.168.5.66:2356</small>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>用户名</span>
                  <div className="input-shell">
                    <KeyRound size={17} />
                    <input
                      required
                      value={draftSettings.username}
                      onChange={(event) =>
                        setDraftSettings((current) => ({
                          ...current,
                          username: event.target.value
                        }))
                      }
                      placeholder="用户名"
                      autoComplete="username"
                    />
                  </div>
                </label>
                <label className="field">
                  <span>密码</span>
                  <div className="input-shell">
                    <ShieldAlert size={17} />
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={draftSettings.password}
                      onChange={(event) =>
                        setDraftSettings((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      placeholder="密码"
                      autoComplete="current-password"
                    />
                    <button
                      className="input-action"
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              </div>

              <label className="switch-row">
                <div>
                  <strong>记住密码</strong>
                  <span>下次启动时自动连接</span>
                </div>
                <input
                  type="checkbox"
                  checked={draftSettings.rememberPassword}
                  onChange={(event) =>
                    setDraftSettings((current) => ({
                      ...current,
                      rememberPassword: event.target.checked
                    }))
                  }
                />
                <i />
              </label>

              <div className="security-note">
                <ShieldAlert size={20} />
                <p>
                  <strong>密码保存在本机</strong>
                  仅建议在自己的设备上开启。
                </p>
              </div>
            </div>

            <footer className="modal-actions modal-actions-split">
              <button className="text-button danger-text" type="button" onClick={clearCredentials}>
                <Trash2 size={14} />
                清除登录信息
              </button>
              <div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={testing}
                  onClick={() => void testConnection()}
                >
                  {testing && <RefreshCw size={15} className="spin" />}
                  测试连接
                </button>
                <button className="button button-primary" type="submit">
                  保存并连接
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}

      {addRoomOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card small-modal" onSubmit={addRoom}>
            <header className="modal-header">
              <div>
                <span className="section-kicker">NEW ROOM</span>
                <h2>添加直播间</h2>
                <p>添加一个 Bilibili 直播间</p>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setAddRoomOpen(false)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <label className="field">
                <span>房间号或直播间 URL</span>
                <div
                  className={`input-shell room-address-input ${
                    newRoomInput.trim() ? (parsedNewRoomId ? 'is-valid' : 'is-invalid') : ''
                  }`}
                >
                  <Radio size={17} />
                  <input
                    autoFocus
                    type="text"
                    required
                    value={newRoomInput}
                    onChange={(event) => setNewRoomInput(event.target.value)}
                    placeholder="883263 或 https://live.bilibili.com/883263"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <small
                  className={`room-id-preview ${
                    newRoomInput.trim() && !parsedNewRoomId ? 'is-error' : ''
                  }`}
                >
                  {parsedNewRoomId
                    ? `已识别房间号：${parsedNewRoomId}`
                    : newRoomInput.trim()
                      ? '未识别到有效房间号，请检查链接格式'
                      : '粘贴直播间链接即可自动识别房间号'}
                </small>
              </label>
              <label className="switch-row">
                <div>
                  <strong>自动录制</strong>
                  <span>检测到开播后自动开始录制</span>
                </div>
                <input
                  type="checkbox"
                  checked={newRoomAutoRecord}
                  onChange={(event) => setNewRoomAutoRecord(event.target.checked)}
                />
                <i />
              </label>
            </div>
            <footer className="modal-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setAddRoomOpen(false)}
              >
                取消
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={loading || !parsedNewRoomId}
              >
                <Plus size={16} />
                添加房间
              </button>
            </footer>
          </form>
        </div>
      )}

      {confirmState && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <div className="modal-card confirm-modal">
            <div className="confirm-icon">
              <AlertTriangle size={25} />
            </div>
            <h2>{confirmState.title}</h2>
            <p>{confirmState.message}</p>
            <div className="modal-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmState(null)}
              >
                取消
              </button>
              <button
                className={confirmState.danger ? 'button button-danger' : 'button button-primary'}
                type="button"
                disabled={confirmBusy}
                onClick={() => void executeConfirmed()}
              >
                {confirmBusy && <RefreshCw size={15} className="spin" />}
                {confirmState.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.tone === 'success' ? (
              <Zap size={17} />
            ) : toast.tone === 'error' ? (
              <AlertTriangle size={17} />
            ) : (
              <Info size={17} />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
