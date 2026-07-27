'use client';

import {
  Activity,
  AlertTriangle,
  Braces,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FileCode2,
  HardDrive,
  Info,
  Network,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Video,
  WandSparkles,
  Wifi,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bilirecRequest } from '@/lib/api';
import { formatBytes, formatDuration, formatRate } from '@/lib/format';
import type {
  ConnectionSettings,
  DefaultConfig,
  FileNameTemplateContext,
  FileNameTemplateOutput,
  GlobalConfig,
  IoStats,
  OptionalConfigValue,
  RecordingStats,
  Room,
  RoomConfig,
  ToastItem
} from '@/lib/types';

type ConfigTab = 'quick' | 'global' | 'room' | 'filename';
type FieldKind = 'boolean' | 'number' | 'string' | 'textarea' | 'secret' | 'select';

type FieldDescriptor = {
  key: string;
  defaultKey: string;
  label: string;
  hint: string;
  group: 'recording' | 'danmaku' | 'file' | 'network' | 'timing' | 'desktop';
  kind: FieldKind;
  unit?: string;
  room: boolean;
  options?: Array<{ value: number; label: string }>;
};

type Props = {
  open: boolean;
  connection: ConnectionSettings;
  rooms: Room[];
  initialRoomId: number | null;
  onClose: () => void;
  onRoomsChanged: () => Promise<unknown>;
  notify: (message: string, tone?: ToastItem['tone']) => void;
};

const GROUPS: Array<{ key: FieldDescriptor['group']; label: string; hint: string }> = [
  { key: 'recording', label: '录制与分段', hint: '录制模式、画质、自动分段和标题规则' },
  { key: 'danmaku', label: '弹幕与互动', hint: '弹幕正文、礼物、舰长和传输协议' },
  { key: 'file', label: '文件与集成', hint: '文件名、修复和外部集成' },
  { key: 'network', label: '网络策略', hint: '连接、代理与网络协议' },
  { key: 'timing', label: '超时与重试', hint: '检查与重试间隔' },
  { key: 'desktop', label: '桌面体验', hint: '显示与通知' }
];

const FIELDS: FieldDescriptor[] = [
  {
    key: 'optionalRecordMode',
    defaultKey: 'recordMode',
    label: '录制模式',
    hint: '标准模式会修复流；Raw 模式保留原始数据。',
    group: 'recording',
    kind: 'select',
    room: true,
    options: [
      { value: 0, label: 'Standard · 标准模式' },
      { value: 1, label: 'Raw · 原始流模式' }
    ]
  },
  {
    key: 'optionalCuttingMode',
    defaultKey: 'cuttingMode',
    label: '自动分段模式',
    hint: '按时间或文件大小自动生成新分段。',
    group: 'recording',
    kind: 'select',
    room: true,
    options: [
      { value: 0, label: '禁用自动分段' },
      { value: 1, label: '按时间分段' },
      { value: 2, label: '按文件大小分段' }
    ]
  },
  {
    key: 'optionalCuttingNumber',
    defaultKey: 'cuttingNumber',
    label: '自动分段数值',
    hint: '单位由自动分段模式决定。',
    group: 'recording',
    kind: 'number',
    room: true
  },
  {
    key: 'optionalCuttingByTitle',
    defaultKey: 'cuttingByTitle',
    label: '标题变化时分段',
    hint: '直播标题变化时开启新分段。',
    group: 'recording',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordingQuality',
    defaultKey: 'recordingQuality',
    label: '直播画质优先级',
    hint: '按优先顺序填写画质，如 avc10000,hevc10000。',
    group: 'recording',
    kind: 'textarea',
    room: true
  },
  {
    key: 'optionalSaveStreamCover',
    defaultKey: 'saveStreamCover',
    label: '保存直播封面',
    hint: '录制开始时保存直播封面。',
    group: 'recording',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordDanmaku',
    defaultKey: 'recordDanmaku',
    label: '录制弹幕',
    hint: '将弹幕保存为 XML 文件。',
    group: 'danmaku',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordDanmakuRaw',
    defaultKey: 'recordDanmakuRaw',
    label: '保留原始弹幕数据',
    hint: '在 XML 中保留原始数据。',
    group: 'danmaku',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordDanmakuSuperChat',
    defaultKey: 'recordDanmakuSuperChat',
    label: '记录 SuperChat',
    hint: '在弹幕文件中记录醒目留言。',
    group: 'danmaku',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordDanmakuGift',
    defaultKey: 'recordDanmakuGift',
    label: '记录礼物',
    hint: '在弹幕文件中记录礼物事件。',
    group: 'danmaku',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalRecordDanmakuGuard',
    defaultKey: 'recordDanmakuGuard',
    label: '记录上舰',
    hint: '在弹幕文件中记录大航海事件。',
    group: 'danmaku',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalDanmakuTransport',
    defaultKey: 'danmakuTransport',
    label: '弹幕传输协议',
    hint: '选择弹幕连接使用的协议。',
    group: 'danmaku',
    kind: 'select',
    room: false,
    options: [
      { value: 0, label: '随机选择' },
      { value: 1, label: 'TCP' },
      { value: 2, label: 'WebSocket · HTTP' },
      { value: 3, label: 'WebSocket · HTTPS' }
    ]
  },
  {
    key: 'optionalDanmakuAuthenticateWithStreamerUid',
    defaultKey: 'danmakuAuthenticateWithStreamerUid',
    label: '使用主播 UID 认证弹幕',
    hint: '使用主播 UID 进行弹幕认证。',
    group: 'danmaku',
    kind: 'boolean',
    room: false
  },
  {
    key: 'optionalRecordDanmakuFlushInterval',
    defaultKey: 'recordDanmakuFlushInterval',
    label: '弹幕缓冲刷新数量',
    hint: '累计指定数量后写入弹幕。',
    group: 'danmaku',
    kind: 'number',
    room: false,
    unit: '条'
  },
  {
    key: 'optionalFileNameRecordTemplate',
    defaultKey: 'fileNameRecordTemplate',
    label: '录制文件名模板',
    hint: '支持 Liquid 模板，可先在文件名工具中预览。',
    group: 'file',
    kind: 'textarea',
    room: false
  },
  {
    key: 'optionalFlvProcessorSplitOnScriptTag',
    defaultKey: 'flvProcessorSplitOnScriptTag',
    label: 'FLV 数据缺失时分段',
    hint: '检测到数据可能缺失时自动分段。',
    group: 'file',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalFlvProcessorDisableSplitOnH264AnnexB',
    defaultKey: 'flvProcessorDisableSplitOnH264AnnexB',
    label: 'Annex-B 时禁用修复分段',
    hint: '检测到 H.264 Annex-B 时不执行修复分段。',
    group: 'file',
    kind: 'boolean',
    room: true
  },
  {
    key: 'optionalFlvWriteMetadata',
    defaultKey: 'flvWriteMetadata',
    label: '写入 FLV Metadata',
    hint: '将直播信息写入视频文件。',
    group: 'file',
    kind: 'boolean',
    room: false
  },
  {
    key: 'optionalTitleFilterPatterns',
    defaultKey: 'titleFilterPatterns',
    label: '不录制标题正则',
    hint: '不录制与规则匹配的直播标题。',
    group: 'file',
    kind: 'textarea',
    room: true
  },
  {
    key: 'optionalWebHookUrls',
    defaultKey: 'webHookUrls',
    label: 'Webhook V1 地址',
    hint: '录制事件 Webhook V1 目标地址。',
    group: 'file',
    kind: 'textarea',
    room: false
  },
  {
    key: 'optionalWebHookUrlsV2',
    defaultKey: 'webHookUrlsV2',
    label: 'Webhook V2 地址',
    hint: '录制事件 Webhook V2 目标地址。',
    group: 'file',
    kind: 'textarea',
    room: false
  },
  {
    key: 'optionalCookie',
    defaultKey: 'cookie',
    label: 'Bilibili Cookie',
    hint: '仅在需要登录权限时填写。',
    group: 'network',
    kind: 'secret',
    room: false
  },
  {
    key: 'optionalLiveApiHost',
    defaultKey: 'liveApiHost',
    label: '直播 API Host',
    hint: 'Bilibili 直播 API 根地址。',
    group: 'network',
    kind: 'string',
    room: false
  },
  {
    key: 'optionalNetworkTransportUseSystemProxy',
    defaultKey: 'networkTransportUseSystemProxy',
    label: '使用系统代理',
    hint: '网络请求使用系统代理。',
    group: 'network',
    kind: 'boolean',
    room: false
  },
  {
    key: 'optionalNetworkTransportAllowedAddressFamily',
    defaultKey: 'networkTransportAllowedAddressFamily',
    label: '允许的 IP 地址族',
    hint: '选择直播与弹幕连接使用的网络协议。',
    group: 'network',
    kind: 'select',
    room: false,
    options: [
      { value: -1, label: '由系统决定' },
      { value: 0, label: '任意 IPv4 或 IPv6' },
      { value: 1, label: '仅 IPv4' },
      { value: 2, label: '仅 IPv6' }
    ]
  },
  {
    key: 'optionalTimingCheckInterval',
    defaultKey: 'timingCheckInterval',
    label: '主动检查间隔',
    hint: '检查直播间状态的间隔。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '秒'
  },
  {
    key: 'optionalTimingApiTimeout',
    defaultKey: 'timingApiTimeout',
    label: '直播 API 超时',
    hint: '获取直播信息的超时时间。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '毫秒'
  },
  {
    key: 'optionalTimingStreamRetry',
    defaultKey: 'timingStreamRetry',
    label: '录制断开重连间隔',
    hint: '直播流断开后的重连等待时间。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '毫秒'
  },
  {
    key: 'optionalTimingStreamRetryNoQn',
    defaultKey: 'timingStreamRetryNoQn',
    label: '无指定画质重试间隔',
    hint: '请求不到目标画质时的重试等待时间。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '秒'
  },
  {
    key: 'optionalTimingStreamConnect',
    defaultKey: 'timingStreamConnect',
    label: '直播服务器连接超时',
    hint: '连接直播流服务器的超时时间。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '毫秒'
  },
  {
    key: 'optionalTimingDanmakuRetry',
    defaultKey: 'timingDanmakuRetry',
    label: '弹幕服务器重连间隔',
    hint: '弹幕连接断开后的重试等待时间。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '毫秒'
  },
  {
    key: 'optionalTimingWatchdogTimeout',
    defaultKey: 'timingWatchdogTimeout',
    label: '直播数据看门狗超时',
    hint: '长时间没有直播数据时尝试恢复。',
    group: 'timing',
    kind: 'number',
    room: false,
    unit: '毫秒'
  },
  {
    key: 'optionalWpfShowTitleAndArea',
    defaultKey: 'wpfShowTitleAndArea',
    label: '桌面端显示标题与分区',
    hint: '在录播姬中显示标题与分区。',
    group: 'desktop',
    kind: 'boolean',
    room: false
  },
  {
    key: 'optionalWpfNotifyStreamStart',
    defaultKey: 'wpfNotifyStreamStart',
    label: '开播系统通知',
    hint: '检测到开播时发送系统通知。',
    group: 'desktop',
    kind: 'boolean',
    room: false
  },
  {
    key: 'optionalUserScript',
    defaultKey: 'userScript',
    label: '自定义脚本',
    hint: '用于高级自动化的自定义脚本。',
    group: 'file',
    kind: 'textarea',
    room: false
  }
];

const QUALITY_PRESETS = [
  {
    id: 'original',
    label: '原画优先',
    value: 'avc10000,hevc10000',
    description: '兼顾 AVC 与 HEVC 原画。',
    recommended: true
  },
  {
    id: 'maximum',
    label: '最高画质优先',
    value:
      'avc30000,hevc30000,avc25000,hevc25000,avc20000,hevc20000,avc15000,hevc15000,avc10000,hevc10000',
    description: '优先尝试最高画质，并保留原画兜底。',
    recommended: false
  },
  {
    id: 'compatible',
    label: 'AVC 兼容',
    value: 'avc10000,avc400,avc250,avc150,avc80',
    description: '使用 H.264，兼容更多播放器与剪辑软件。',
    recommended: false
  },
  {
    id: 'economy',
    label: '节省空间',
    value: 'avc400,avc250,avc150,avc80,avc10000',
    description: '优先较低画质，减少存储占用。',
    recommended: false
  }
] as const;

const TEMPLATE_PRESETS = [
  {
    id: 'standard',
    label: '标准归档',
    description: '按房间建立文件夹，保留房间号、时间和标题。',
    template:
      '{{ roomId }}-{{ name }}/录制-{{ roomId }}-{{ "now" | time_zone: "Asia/Shanghai" | format_date: "yyyyMMdd-HHmmss-fff" }}-{{ title }}.flv',
    recommended: true
  },
  {
    id: 'monthly',
    label: '按月归档',
    description: '主播目录下按月份分组，适合长期录制。',
    template:
      '{{ roomId }}-{{ name }}/{{ "now" | time_zone: "Asia/Shanghai" | format_date: "yyyy-MM" }}/{{ "now" | time_zone: "Asia/Shanghai" | format_date: "yyyyMMdd-HHmmss" }}-{{ title }}.flv',
    recommended: false
  },
  {
    id: 'category',
    label: '按分区归档',
    description: '先按主分区，再按主播建立目录。',
    template:
      '{{ areaParent }}/{{ roomId }}-{{ name }}/录制-{{ roomId }}-{{ "now" | time_zone: "Asia/Shanghai" | format_date: "yyyyMMdd-HHmmss-fff" }}-{{ title }}.flv',
    recommended: false
  },
  {
    id: 'postproduction',
    label: '后期友好',
    description: '附加三位分段序号和画质名称，排序更稳定。',
    template:
      '{{ roomId }}-{{ name }}/{{ qn | format_qn }}-{{ "now" | time_zone: "Asia/Shanghai" | format_date: "yyyyMMdd-HHmmss" }}-{{ title }}-{{ partIndex | format_number: "000" }}.flv',
    recommended: false
  }
] as const;

const WORKFLOW_PRESETS = [
  {
    id: 'safe',
    label: '稳妥录制',
    description: '原画优先并保存封面，适合大多数场景。',
    icon: ShieldCheck,
    values: {
      optionalRecordMode: 0,
      optionalRecordingQuality: QUALITY_PRESETS[0].value,
      optionalSaveStreamCover: true,
      optionalRecordDanmakuRaw: false
    }
  },
  {
    id: 'archive',
    label: '高质量归档',
    description: '优先最高画质，并完整保存直播互动。',
    icon: HardDrive,
    values: {
      optionalRecordMode: 0,
      optionalRecordingQuality: QUALITY_PRESETS[1].value,
      optionalSaveStreamCover: true,
      optionalRecordDanmaku: true,
      optionalRecordDanmakuRaw: false,
      optionalRecordDanmakuSuperChat: true,
      optionalRecordDanmakuGift: true,
      optionalRecordDanmakuGuard: true
    }
  },
  {
    id: 'light',
    label: '轻量省空间',
    description: '优先较低画质，减少文件占用。',
    icon: Activity,
    values: {
      optionalRecordMode: 0,
      optionalRecordingQuality: QUALITY_PRESETS[3].value,
      optionalSaveStreamCover: false,
      optionalRecordDanmakuRaw: false
    }
  }
] as const;

function copyValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function optionalFrom(
  config: GlobalConfig | RoomConfig | null,
  key: string
): OptionalConfigValue | null {
  const value = config?.[key];
  if (!value || typeof value !== 'object' || !('hasValue' in value)) return null;
  return value as OptionalConfigValue;
}

function humanValue(value: unknown) {
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (value === null || value === undefined || value === '') return '空';
  return String(value);
}

export default function ConfigurationCenter({
  open,
  connection,
  rooms,
  initialRoomId,
  onClose,
  onRoomsChanged,
  notify
}: Props) {
  const [tab, setTab] = useState<ConfigTab>('quick');
  const [defaultConfig, setDefaultConfig] = useState<DefaultConfig | null>(null);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [globalDraft, setGlobalDraft] = useState<GlobalConfig | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [roomDetail, setRoomDetail] = useState<Room | null>(null);
  const [roomStats, setRoomStats] = useState<RecordingStats | null>(null);
  const [roomIoStats, setRoomIoStats] = useState<IoStats | null>(null);
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null);
  const [roomDraft, setRoomDraft] = useState<RoomConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState('');
  const [partIndex, setPartIndex] = useState(1);
  const [qualityNumber, setQualityNumber] = useState(10000);
  const [contextJson, setContextJson] = useState('{}');
  const [templateResult, setTemplateResult] = useState<FileNameTemplateOutput | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.roomId === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );
  const roomIdsKey = useMemo(() => rooms.map((room) => room.roomId).join(','), [rooms]);

  const globalDirty = useMemo(
    () =>
      Boolean(
        globalConfig && globalDraft && JSON.stringify(globalConfig) !== JSON.stringify(globalDraft)
      ),
    [globalConfig, globalDraft]
  );

  const roomDirty = useMemo(
    () =>
      Boolean(roomConfig && roomDraft && JSON.stringify(roomConfig) !== JSON.stringify(roomDraft)),
    [roomConfig, roomDraft]
  );

  const getGlobalEffective = useCallback(
    (field: FieldDescriptor, draft = globalDraft) => {
      const optional = optionalFrom(draft, field.key);
      if (optional?.hasValue) return optional.value;
      return defaultConfig?.[field.defaultKey] ?? null;
    },
    [defaultConfig, globalDraft]
  );

  const getRoomEffective = useCallback(
    (field: FieldDescriptor) => {
      const optional = optionalFrom(roomDraft, field.key);
      if (optional?.hasValue) return optional.value;
      return getGlobalEffective(field, globalConfig);
    },
    [getGlobalEffective, globalConfig, roomDraft]
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [defaults, globals] = await Promise.all([
        bilirecRequest<DefaultConfig>(connection, '/api/config/default'),
        bilirecRequest<GlobalConfig>(connection, '/api/config/global')
      ]);
      setDefaultConfig(defaults);
      setGlobalConfig(globals);
      setGlobalDraft(copyValue(globals));
      const templateField = FIELDS.find((field) => field.key === 'optionalFileNameRecordTemplate');
      if (templateField) {
        const optional = optionalFrom(globals, templateField.key);
        const initialTemplate = optional?.hasValue
          ? optional.value
          : defaults[templateField.defaultKey];
        setTemplate(typeof initialTemplate === 'string' ? initialTemplate : '');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [connection, notify]);

  const loadRoom = useCallback(
    async (room: Room) => {
      setRoomLoading(true);
      try {
        const objectPath = encodeURIComponent(room.objectId);
        const [detail, config, stats, ioStats] = await Promise.all([
          bilirecRequest<Room>(connection, `/api/room/${room.roomId}`),
          bilirecRequest<RoomConfig>(connection, `/api/room/${objectPath}/config`),
          bilirecRequest<RecordingStats>(connection, `/api/room/${objectPath}/stats`),
          bilirecRequest<IoStats>(connection, `/api/room/${objectPath}/iostats`)
        ]);
        setRoomDetail(detail);
        setRoomConfig(config);
        setRoomDraft(copyValue(config));
        setRoomStats(stats);
        setRoomIoStats(ioStats);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        setRoomLoading(false);
      }
    },
    [connection, notify]
  );

  useEffect(() => {
    if (!open) return;
    setTemplateResult(null);
    void loadBase();
  }, [loadBase, open]);

  useEffect(() => {
    if (!open) return;
    setSelectedRoomId((current) => {
      if (initialRoomId && rooms.some((room) => room.roomId === initialRoomId)) {
        return initialRoomId;
      }
      if (current && rooms.some((room) => room.roomId === current)) {
        return current;
      }
      return rooms[0]?.roomId ?? null;
    });
  }, [initialRoomId, open, roomIdsKey, rooms]);

  useEffect(() => {
    if (!open || !selectedRoom) return;
    void loadRoom(selectedRoom);
  }, [loadRoom, open, selectedRoom?.objectId]);

  const setGlobalOptional = (field: FieldDescriptor, patch: Partial<OptionalConfigValue>) => {
    setGlobalDraft((current) => {
      if (!current) return current;
      const existing = optionalFrom(current, field.key) || {
        hasValue: false,
        value: defaultConfig?.[field.defaultKey] ?? null
      };
      return {
        ...current,
        [field.key]: { ...existing, ...patch }
      };
    });
  };

  const setRoomOptional = (field: FieldDescriptor, patch: Partial<OptionalConfigValue>) => {
    setRoomDraft((current) => {
      if (!current) return current;
      const existing = optionalFrom(current, field.key) || {
        hasValue: false,
        value: getGlobalEffective(field, globalConfig)
      };
      return {
        ...current,
        [field.key]: { ...existing, ...patch }
      };
    });
  };

  const enableOverride = (scope: 'global' | 'room', field: FieldDescriptor, enabled: boolean) => {
    const config = scope === 'global' ? globalDraft : roomDraft;
    const existing = optionalFrom(config, field.key);
    const fallback =
      scope === 'global'
        ? (defaultConfig?.[field.defaultKey] ?? null)
        : getGlobalEffective(field, globalConfig);
    const patch: Partial<OptionalConfigValue> = {
      hasValue: enabled,
      value: existing?.value ?? fallback
    };
    if (scope === 'global') setGlobalOptional(field, patch);
    else setRoomOptional(field, patch);
  };

  const updateFieldValue = (
    scope: 'global' | 'room',
    field: FieldDescriptor,
    value: boolean | number | string | null
  ) => {
    if (scope === 'global') setGlobalOptional(field, { value });
    else setRoomOptional(field, { value });
  };

  const applyGlobalOverrides = (
    values: Record<string, boolean | number | string>,
    label: string
  ) => {
    setGlobalDraft((current) => {
      if (!current) return current;
      const next = { ...current };
      Object.entries(values).forEach(([key, value]) => {
        next[key] = { hasValue: true, value };
      });
      return next;
    });
    notify(`已选择“${label}”，保存后生效`, 'success');
  };

  const chooseTemplatePreset = (preset: (typeof TEMPLATE_PRESETS)[number]) => {
    setTemplate(preset.template);
    setTemplateResult(null);
  };

  const applyTemplateToGlobal = () => {
    const field = FIELDS.find((item) => item.key === 'optionalFileNameRecordTemplate');
    if (!field || !template.trim()) return;
    setGlobalOptional(field, { hasValue: true, value: template });
    notify('已应用文件名模板，保存后生效', 'success');
  };

  const renderField = (scope: 'global' | 'room', field: FieldDescriptor) => {
    const config = scope === 'global' ? globalDraft : roomDraft;
    const optional = optionalFrom(config, field.key);
    const overridden = Boolean(optional?.hasValue);
    const effective = scope === 'global' ? getGlobalEffective(field) : getRoomEffective(field);
    const value = overridden ? optional?.value : effective;

    return (
      <article className={`config-field ${overridden ? 'is-overridden' : ''}`} key={field.key}>
        <div className="config-field-head">
          <div>
            <strong>{field.label}</strong>
            <p>{field.hint}</p>
          </div>
          <label className="inherit-toggle" title={overridden ? '使用独立值' : '继承上级设置'}>
            <span>{overridden ? '独立' : scope === 'global' ? '默认' : '继承'}</span>
            <input
              type="checkbox"
              checked={overridden}
              onChange={(event) => enableOverride(scope, field, event.target.checked)}
            />
            <i />
          </label>
        </div>

        {field.kind === 'boolean' ? (
          <div className="config-bool-control">
            <button
              className={value === true ? 'active is-on' : ''}
              type="button"
              disabled={!overridden}
              onClick={() => updateFieldValue(scope, field, true)}
            >
              开启
            </button>
            <button
              className={value === false ? 'active' : ''}
              type="button"
              disabled={!overridden}
              onClick={() => updateFieldValue(scope, field, false)}
            >
              关闭
            </button>
          </div>
        ) : field.kind === 'select' ? (
          <select
            className="config-input"
            disabled={!overridden}
            value={typeof value === 'number' ? value : 0}
            onChange={(event) =>
              updateFieldValue(scope, field, Number.parseInt(event.target.value, 10))
            }
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.kind === 'textarea' ? (
          <textarea
            className="config-input"
            disabled={!overridden}
            rows={field.key.includes('Template') || field.key.includes('Script') ? 4 : 2}
            value={value == null ? '' : String(value)}
            onChange={(event) => updateFieldValue(scope, field, event.target.value)}
          />
        ) : (
          <div className="config-input-with-unit">
            <input
              className="config-input"
              type={
                field.kind === 'number' ? 'number' : field.kind === 'secret' ? 'password' : 'text'
              }
              min={field.kind === 'number' ? 0 : undefined}
              disabled={!overridden}
              value={value == null ? '' : String(value)}
              onChange={(event) =>
                updateFieldValue(
                  scope,
                  field,
                  field.kind === 'number'
                    ? Math.max(0, Number.parseInt(event.target.value || '0', 10))
                    : event.target.value
                )
              }
            />
            {field.unit && <span>{field.unit}</span>}
          </div>
        )}

        {!overridden && (
          <small className="effective-value">
            当前生效：{field.kind === 'secret' && value ? '••••••••' : humanValue(value)}
          </small>
        )}
      </article>
    );
  };

  const saveGlobal = async () => {
    if (!globalDraft) return;
    setSaving(true);
    try {
      const saved = await bilirecRequest<GlobalConfig>(
        connection,
        '/api/config/global',
        'POST',
        globalDraft
      );
      setGlobalConfig(saved);
      setGlobalDraft(copyValue(saved));
      notify('全局设置已保存', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveRoom = async () => {
    if (!selectedRoom || !roomDraft) return;
    setSaving(true);
    try {
      const saved = await bilirecRequest<RoomConfig>(
        connection,
        `/api/room/${encodeURIComponent(selectedRoom.objectId)}/config`,
        'POST',
        roomDraft
      );
      setRoomConfig(saved);
      setRoomDraft(copyValue(saved));
      await onRoomsChanged();
      notify(`${selectedRoom.name || selectedRoom.roomId} 的独立设置已保存`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const generateFileName = async () => {
    if (!selectedRoom) {
      notify('请先选择一个房间', 'error');
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contextJson || '{}');
    } catch {
      notify('扩展数据格式不正确', 'error');
      return;
    }

    const context: FileNameTemplateContext = {
      roomId: selectedRoom.roomId,
      shortId: selectedRoom.shortId || 0,
      name: selectedRoom.name,
      uid: selectedRoom.uid,
      title: selectedRoom.title,
      areaParent: selectedRoom.areaNameParent,
      areaChild: selectedRoom.areaNameChild,
      partIndex,
      qn: qualityNumber,
      json: JSON.stringify(parsedJson)
    };

    setSaving(true);
    try {
      const result = await bilirecRequest<FileNameTemplateOutput>(
        connection,
        '/api/misc/generatefilename',
        'POST',
        { template, context }
      );
      setTemplateResult(result);
      notify(
        result.status === 0 ? '路径预览已生成' : '请检查模板设置',
        result.status === 0 ? 'success' : 'info'
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyGeneratedPath = async () => {
    const value = templateResult?.relativePath || templateResult?.fullPath;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      notify('已复制路径', 'success');
    } catch {
      notify('复制路径失败', 'error');
    }
  };

  const qualityField = FIELDS.find((field) => field.key === 'optionalRecordingQuality');
  const currentQuality = qualityField ? String(getGlobalEffective(qualityField) || '') : '';

  if (!open) return null;

  return (
    <div className="config-center-backdrop">
      <section className="config-center" role="dialog" aria-modal="true" aria-label="配置中心">
        <header className="config-center-header">
          <div className="config-center-title">
            <span className="config-center-icon">
              <Settings2 size={22} />
            </span>
            <div>
              <span className="section-kicker">RECORDING SETUP</span>
              <h2>录制设置</h2>
              <p>快速完成常用设置，也可按需细调</p>
            </div>
          </div>
          <div className="config-header-status">
            <span className={globalDirty ? 'has-draft' : ''}>
              {globalDirty ? <Save size={14} /> : <CheckCircle2 size={14} />}
              {globalDirty ? '有未保存修改' : '设置已同步'}
            </span>
            <button
              className="button button-secondary"
              type="button"
              disabled={loading}
              onClick={() => void loadBase()}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              刷新
            </button>
            <button
              className="modal-close"
              type="button"
              onClick={onClose}
              aria-label="关闭配置中心"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <nav className="config-tabs">
          <button
            className={tab === 'quick' ? 'active' : ''}
            type="button"
            onClick={() => setTab('quick')}
          >
            <WandSparkles size={16} />
            快捷方案
          </button>
          <button
            className={tab === 'global' ? 'active' : ''}
            type="button"
            onClick={() => setTab('global')}
          >
            <SlidersHorizontal size={16} />
            详细设置
          </button>
          <button
            className={tab === 'room' ? 'active' : ''}
            type="button"
            onClick={() => setTab('room')}
          >
            <Radio size={16} />
            房间设置
          </button>
          <button
            className={tab === 'filename' ? 'active' : ''}
            type="button"
            onClick={() => setTab('filename')}
          >
            <FileCode2 size={16} />
            文件名工具
          </button>
        </nav>

        <div className="config-center-body">
          {loading && !globalDraft ? (
            <div className="config-loading">
              <RefreshCw size={28} className="spin" />
              <strong>正在加载设置</strong>
              <span>请稍候…</span>
            </div>
          ) : tab === 'quick' ? (
            <div className="config-page quick-setup-page">
              <div className="config-page-intro">
                <div>
                  <span className="section-kicker">QUICK START</span>
                  <h3>选择一个录制方案</h3>
                  <p>选择方案后，点击保存即可应用。</p>
                </div>
                <div className="config-page-actions">
                  <span className={globalDirty ? 'dirty-chip is-dirty' : 'dirty-chip'}>
                    {globalDirty ? '等待保存' : '配置已同步'}
                  </span>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!globalDirty || saving}
                    onClick={() => void saveGlobal()}
                  >
                    <Save size={16} />
                    保存设置
                  </button>
                </div>
              </div>

              <section className="quick-section">
                <header>
                  <div>
                    <span>01</span>
                    <div>
                      <h4>常用录制方案</h4>
                      <p>一次完成画质、封面和弹幕设置。</p>
                    </div>
                  </div>
                </header>
                <div className="workflow-preset-grid">
                  {WORKFLOW_PRESETS.map((preset, index) => {
                    const PresetIcon = preset.icon;
                    return (
                      <button
                        className={
                          index === 0 ? 'workflow-preset is-recommended' : 'workflow-preset'
                        }
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          applyGlobalOverrides(
                            preset.values as Record<string, boolean | number | string>,
                            preset.label
                          )
                        }
                      >
                        <span className="preset-icon">
                          <PresetIcon size={20} />
                        </span>
                        <span className="preset-copy">
                          <strong>{preset.label}</strong>
                          <small>{preset.description}</small>
                        </span>
                        {index === 0 && <em>推荐</em>}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="quick-section">
                <header>
                  <div>
                    <span>02</span>
                    <div>
                      <h4>画质快捷设置</h4>
                      <p>按优先顺序尝试可用画质。</p>
                    </div>
                  </div>
                  <button
                    className="quick-text-link"
                    type="button"
                    onClick={() => setTab('global')}
                  >
                    查看详细参数
                  </button>
                </header>
                <div className="quality-preset-grid">
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      className={`quality-preset ${currentQuality === preset.value ? 'active' : ''}`}
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        applyGlobalOverrides(
                          { optionalRecordingQuality: preset.value },
                          `画质 · ${preset.label}`
                        )
                      }
                    >
                      <span>
                        <strong>{preset.label}</strong>
                        {preset.recommended && <em>推荐</em>}
                      </span>
                      <small>{preset.description}</small>
                      <code>{preset.value}</code>
                    </button>
                  ))}
                </div>
                <div className="inline-guide quality-guide">
                  <Info size={17} />
                  <p>已保留原画作为兜底，避免开播初期漏录。</p>
                </div>
              </section>

              <section className="quick-section">
                <header>
                  <div>
                    <span>03</span>
                    <div>
                      <h4>文件名与目录方案</h4>
                      <p>选择目录结构后，可继续调整并预览。</p>
                    </div>
                  </div>
                </header>
                <div className="template-preset-grid compact">
                  {TEMPLATE_PRESETS.map((preset) => (
                    <button
                      className={`template-preset ${template === preset.template ? 'active' : ''}`}
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        chooseTemplatePreset(preset);
                        setTab('filename');
                      }}
                    >
                      <FileCode2 size={18} />
                      <span>
                        <strong>{preset.label}</strong>
                        <small>{preset.description}</small>
                      </span>
                      {preset.recommended && <em>推荐</em>}
                    </button>
                  ))}
                </div>
              </section>

              <div className="setup-guide-grid">
                <article>
                  <ShieldCheck size={19} />
                  <div>
                    <strong>标准模式更省心</strong>
                    <p>适合大多数场景，并支持流修复和分段。</p>
                  </div>
                </article>
                <article>
                  <Braces size={19} />
                  <div>
                    <strong>保存前先预览</strong>
                    <p>确认文件名和目录符合预期。</p>
                  </div>
                </article>
                <article>
                  <Radio size={19} />
                  <div>
                    <strong>房间设置优先生效</strong>
                    <p>关闭“独立”即可恢复全局设置。</p>
                  </div>
                </article>
              </div>
            </div>
          ) : tab === 'global' ? (
            <div className="config-page">
              <div className="config-page-intro">
                <div>
                  <span className="section-kicker">DETAILED SETTINGS</span>
                  <h3>详细录制设置</h3>
                  <p>常用选项优先显示，高级选项可按需展开。</p>
                </div>
                <div className="config-page-actions">
                  <span className={globalDirty ? 'dirty-chip is-dirty' : 'dirty-chip'}>
                    {globalDirty ? '有未保存修改' : '设置已同步'}
                  </span>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!globalDirty || saving}
                    onClick={() => void saveGlobal()}
                  >
                    <Save size={16} />
                    保存全局设置
                  </button>
                </div>
              </div>

              <div className="config-notice">
                <ShieldCheck size={19} />
                <p>修改将在保存后生效。敏感信息会隐藏显示。</p>
              </div>

              <section className="detail-quality-shortcuts">
                <header>
                  <div>
                    <h4>画质快速选择</h4>
                    <p>选择常用画质，也可在下方自定义。</p>
                  </div>
                </header>
                <div>
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      className={currentQuality === preset.value ? 'active' : ''}
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        applyGlobalOverrides(
                          { optionalRecordingQuality: preset.value },
                          `画质 · ${preset.label}`
                        )
                      }
                    >
                      <strong>{preset.label}</strong>
                      <small>{preset.recommended ? '推荐' : preset.description}</small>
                    </button>
                  ))}
                </div>
              </section>

              {GROUPS.filter(
                (group) =>
                  showAdvanced ||
                  !(['network', 'timing', 'desktop'] as const).includes(
                    group.key as 'network' | 'timing' | 'desktop'
                  )
              ).map((group) => {
                const fields = FIELDS.filter((field) => field.group === group.key);
                if (!fields.length) return null;
                return (
                  <section className="config-group" key={group.key}>
                    <header>
                      <div>
                        <h4>{group.label}</h4>
                        <p>{group.hint}</p>
                      </div>
                      <span>{fields.length} 项</span>
                    </header>
                    <div className="config-field-grid">
                      {fields.map((field) => renderField('global', field))}
                    </div>
                  </section>
                );
              })}

              <button
                className="advanced-settings-toggle"
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
              >
                <Settings2 size={16} />
                <span>
                  <strong>{showAdvanced ? '收起高级设置' : '显示高级设置'}</strong>
                  <small>一般无需调整</small>
                </span>
              </button>
            </div>
          ) : tab === 'room' ? (
            <div className="config-page">
              <div className="config-page-intro room-config-intro">
                <div>
                  <span className="section-kicker">ROOM CONFIG & DETAILS</span>
                  <h3>房间独立设置</h3>
                  <p>为指定房间设置独立规则。</p>
                </div>
                <div className="room-picker">
                  <span>当前房间</span>
                  <select
                    value={selectedRoomId ?? ''}
                    onChange={(event) => setSelectedRoomId(Number(event.target.value))}
                  >
                    {rooms.map((room) => (
                      <option key={room.objectId} value={room.roomId}>
                        {room.name || `房间 ${room.roomId}`} · {room.roomId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {roomLoading && !roomDraft ? (
                <div className="config-loading compact">
                  <RefreshCw size={24} className="spin" />
                  <strong>正在读取房间详情</strong>
                </div>
              ) : selectedRoom && roomDraft ? (
                <>
                  <div className="room-detail-strip">
                    <article>
                      <Video size={18} />
                      <span>房间状态</span>
                      <strong>
                        {roomDetail?.recording
                          ? '录制中'
                          : roomDetail?.streaming
                            ? '直播中'
                            : '离线'}
                      </strong>
                    </article>
                    <article>
                      <Clock3 size={18} />
                      <span>本次录制</span>
                      <strong>{formatDuration(roomStats?.sessionDuration || 0)}</strong>
                    </article>
                    <article>
                      <Wifi size={18} />
                      <span>网络速率</span>
                      <strong>{formatRate(roomIoStats?.networkMbps || 0)}</strong>
                    </article>
                    <article>
                      <HardDrive size={18} />
                      <span>当前文件</span>
                      <strong>{formatBytes(roomStats?.currentFileSize || 0)}</strong>
                    </article>
                  </div>

                  <section className="config-group room-auto-group">
                    <header>
                      <div>
                        <h4>房间行为</h4>
                        <p>仅影响当前房间。</p>
                      </div>
                      <div className="config-page-actions">
                        <span className={roomDirty ? 'dirty-chip is-dirty' : 'dirty-chip'}>
                          {roomDirty ? '有未保存修改' : '已同步'}
                        </span>
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={!roomDirty || saving}
                          onClick={() => void saveRoom()}
                        >
                          <Save size={16} />
                          保存房间设置
                        </button>
                      </div>
                    </header>
                    <label className="room-auto-record">
                      <div>
                        <Radio size={19} />
                        <span>
                          <strong>自动录制</strong>
                          <small>检测到该房间开播后自动开始录制</small>
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(roomDraft.autoRecord)}
                        onChange={(event) =>
                          setRoomDraft((current) =>
                            current ? { ...current, autoRecord: event.target.checked } : current
                          )
                        }
                      />
                      <i />
                    </label>
                  </section>

                  {GROUPS.map((group) => {
                    const fields = FIELDS.filter(
                      (field) => field.room && field.group === group.key
                    );
                    if (!fields.length) return null;
                    return (
                      <section className="config-group" key={group.key}>
                        <header>
                          <div>
                            <h4>{group.label}</h4>
                            <p>关闭“独立”后使用全局设置。</p>
                          </div>
                          <span>{fields.length} 项</span>
                        </header>
                        <div className="config-field-grid">
                          {fields.map((field) => renderField('room', field))}
                        </div>
                      </section>
                    );
                  })}
                </>
              ) : (
                <div className="config-empty">
                  <Radio size={30} />
                  <h4>暂无可配置房间</h4>
                  <p>先在主界面添加直播间。</p>
                </div>
              )}
            </div>
          ) : (
            <div className="config-page filename-page">
              <div className="config-page-intro">
                <div>
                  <span className="section-kicker">FILENAME GENERATOR</span>
                  <h3>录制文件名模板工具</h3>
                  <p>预览文件路径，不会创建文件。</p>
                </div>
                <div className="room-picker">
                  <span>模拟房间</span>
                  <select
                    value={selectedRoomId ?? ''}
                    onChange={(event) => setSelectedRoomId(Number(event.target.value))}
                  >
                    {rooms.map((room) => (
                      <option key={room.objectId} value={room.roomId}>
                        {room.name || `房间 ${room.roomId}`} · {room.roomId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <section className="filename-preset-section">
                <header>
                  <div>
                    <h4>选择目录结构</h4>
                    <p>选择后仍可继续调整。</p>
                  </div>
                </header>
                <div className="template-preset-grid">
                  {TEMPLATE_PRESETS.map((preset) => (
                    <button
                      className={`template-preset ${template === preset.template ? 'active' : ''}`}
                      key={preset.id}
                      type="button"
                      onClick={() => chooseTemplatePreset(preset)}
                    >
                      <FileCode2 size={18} />
                      <span>
                        <strong>{preset.label}</strong>
                        <small>{preset.description}</small>
                      </span>
                      {preset.recommended && <em>推荐</em>}
                    </button>
                  ))}
                </div>
              </section>

              <div className="filename-workspace">
                <section className="filename-editor">
                  <label>
                    <span>Liquid 文件名模板</span>
                    <textarea
                      rows={7}
                      value={template}
                      onChange={(event) => setTemplate(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <div className="filename-context-row">
                    <label>
                      <span>分段序号</span>
                      <input
                        type="number"
                        min="0"
                        value={partIndex}
                        onChange={(event) => setPartIndex(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      <span>画质编号</span>
                      <input
                        type="number"
                        min="0"
                        value={qualityNumber}
                        onChange={(event) => setQualityNumber(Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <details className="filename-advanced-context">
                    <summary>高级：扩展数据</summary>
                    <label>
                      <span>仅在模板需要额外数据时填写</span>
                      <textarea
                        rows={5}
                        value={contextJson}
                        onChange={(event) => setContextJson(event.target.value)}
                        spellCheck={false}
                      />
                    </label>
                  </details>
                  <div className="filename-action-row">
                    <button
                      className="button button-primary filename-generate"
                      type="button"
                      disabled={!selectedRoom || saving || !template.trim()}
                      onClick={() => void generateFileName()}
                    >
                      <WandSparkles size={17} />
                      预览生成路径
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={!template.trim()}
                      onClick={applyTemplateToGlobal}
                    >
                      <Save size={16} />
                      应用到全局设置
                    </button>
                  </div>
                  <div className="template-variable-guide">
                    <span>
                      <code>{'{{ name }}'}</code> 主播名
                    </span>
                    <span>
                      <code>{'{{ title }}'}</code> 标题
                    </span>
                    <span>
                      <code>{'{{ roomId }}'}</code> 房间号
                    </span>
                    <span>
                      <code>{'{{ areaParent }}'}</code> 主分区
                    </span>
                    <span>
                      <code>{'{{ qn | format_qn }}'}</code> 画质名
                    </span>
                    <span>
                      <code>{'{{ partIndex }}'}</code> 分段序号
                    </span>
                  </div>
                </section>

                <aside className="filename-preview">
                  <header>
                    <FileCode2 size={20} />
                    <div>
                      <strong>生成结果</strong>
                      <span>使用当前房间信息预览</span>
                    </div>
                  </header>
                  {templateResult ? (
                    <>
                      <div className={`template-status status-${templateResult.status}`}>
                        {templateResult.status === 0 ? (
                          <CheckCircle2 size={18} />
                        ) : (
                          <AlertTriangle size={18} />
                        )}
                        <span>
                          {templateResult.status === 0
                            ? '模板有效'
                            : `状态码 ${templateResult.status}`}
                        </span>
                      </div>
                      {templateResult.errorMessage && (
                        <div className="template-error">{templateResult.errorMessage}</div>
                      )}
                      <div className="template-path">
                        <span>相对路径</span>
                        <code>{templateResult.relativePath || '—'}</code>
                      </div>
                      <div className="template-path">
                        <span>完整路径</span>
                        <code>{templateResult.fullPath || '—'}</code>
                      </div>
                      {(templateResult.relativePath || templateResult.fullPath) && (
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => void copyGeneratedPath()}
                        >
                          {copied ? <Check size={15} /> : <Copy size={15} />}
                          {copied ? '已复制' : '复制生成路径'}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="filename-placeholder">
                      <Braces size={34} />
                      <strong>等待预览</strong>
                      <p>填写模板后即可预览结果。</p>
                    </div>
                  )}
                  {selectedRoom && (
                    <div className="filename-room-context">
                      <span>当前房间</span>
                      <strong>{selectedRoom.name || selectedRoom.roomId}</strong>
                      <small>
                        roomId {selectedRoom.roomId} · uid {selectedRoom.uid} · qn {qualityNumber}
                      </small>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          )}
        </div>

        <footer className="config-center-footer">
          <span>
            <Network size={14} /> 设置保存在录播姬中
          </span>
          <span>
            <Activity size={14} /> 连接状态正常
          </span>
        </footer>
      </section>
    </div>
  );
}
