export type ConnectionSettings = {
  apiUrl: string;
  username: string;
  password: string;
  rememberPassword: boolean;
};

export type RecordingStats = {
  sessionDuration: number;
  totalInputBytes: number;
  totalOutputBytes: number;
  currentFileSize: number;
  sessionMaxTimestamp: number;
  fileMaxTimestamp: number;
  addedDuration: number;
  passedTime: number;
  durationRatio: number | string;
  inputVideoBytes: number;
  inputAudioBytes: number;
  outputVideoFrames: number;
  outputAudioFrames: number;
  outputVideoBytes: number;
  outputAudioBytes: number;
  totalInputVideoBytes: number;
  totalInputAudioBytes: number;
  totalOutputVideoFrames: number;
  totalOutputAudioFrames: number;
  totalOutputVideoBytes: number;
  totalOutputAudioBytes: number;
};

export type IoStats = {
  streamHost: string | null;
  startTime: string;
  endTime: string;
  duration: number;
  networkBytesDownloaded: number;
  networkMbps: number | string;
  diskWriteDuration: number;
  diskBytesWritten: number;
  diskMBps: number | string;
};

export type Room = {
  objectId: string;
  roomId: number;
  autoRecord: boolean;
  shortId: number;
  name: string | null;
  uid: number;
  title: string | null;
  areaNameParent: string | null;
  areaNameChild: string | null;
  recording: boolean;
  streaming: boolean;
  danmakuConnected: boolean;
  autoRecordForThisSession: boolean;
  recordingStats: RecordingStats;
  ioStats: IoStats;
};

export type RecorderVersion = {
  semVer: string;
  informationalVersion: string;
  commitDate: string;
};

export type LogEntry = Record<string, unknown> & {
  '@t'?: string;
  '@mt'?: string;
  '@m'?: string;
  '@l'?: string;
  RoomId?: number;
  SourceContext?: string;
};

export type LogPayload = {
  continuous: boolean;
  cursor: number;
  logs: Array<LogEntry | string> | null;
};

export type RoomFilter = 'all' | 'recording' | 'live' | 'offline';

export type ToastItem = {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
};

export type HistoryFile = {
  roomId: number;
  roomName: string;
  folderPath: string;
  name: string;
  url: string;
  size: number;
  lastModified: string;
  extension: string;
  isVideo: boolean;
  isDanmaku: boolean;
};

export type RoomHistory = {
  roomId: number;
  roomName: string;
  folderPath: string;
  videoCount: number;
  danmakuCount: number;
  otherCount: number;
  totalVideoBytes: number;
  totalBytes: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  lastActivityAt: string | null;
  files: HistoryFile[];
};

export type HistoryOverview = {
  roomCount: number;
  videoCount: number;
  danmakuCount: number;
  totalVideoBytes: number;
  totalBytes: number;
  latestRecordedAt: string | null;
  rooms: RoomHistory[];
};

export type MpvStatus = {
  installed: boolean;
  path: string | null;
  version: string | null;
};

export type MpvPlayResult = {
  pid: number;
  playerPath: string;
};

export type ConfigPrimitive = boolean | number | string | null;

export type OptionalConfigValue<T extends ConfigPrimitive = ConfigPrimitive> = {
  hasValue: boolean;
  value: T;
};

export type DefaultConfig = Record<string, ConfigPrimitive>;

export type GlobalConfig = Record<string, OptionalConfigValue>;

export type RoomConfig = {
  autoRecord: boolean;
  [key: string]: boolean | OptionalConfigValue;
};

export type FileNameTemplateContext = {
  roomId: number;
  shortId: number;
  name: string | null;
  uid: number;
  title: string | null;
  areaParent: string | null;
  areaChild: string | null;
  partIndex: number;
  qn: number;
  json: string;
};

export type FileNameTemplateOutput = {
  status: number;
  errorMessage: string | null;
  relativePath: string | null;
  fullPath: string | null;
};
