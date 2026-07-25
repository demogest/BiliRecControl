import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionSettings,
  HistoryOverview,
  MpvPlayResult,
  MpvStatus
} from './types';

type TauriApiResponse<T> = {
  ok: boolean;
  status: number;
  data: T | { message?: string } | string | null;
};

function errorMessage(data: TauriApiResponse<unknown>['data'], status: number) {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (data && typeof data === 'object' && 'message' in data) {
    const message = data.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (status === 401) {
    return '认证失败，请检查用户名和密码';
  }
  if (status === 404) {
    return '目标房间或接口不存在';
  }
  return `服务请求失败（HTTP ${status}）`;
}

export async function bilirecRequest<T>(
  connection: ConnectionSettings,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const response = await invoke<TauriApiResponse<T>>('bilirec_request', {
    connection,
    path,
    method,
    body: body ?? null
  });

  if (!response.ok) {
    throw new Error(errorMessage(response.data, response.status));
  }

  return response.data as T;
}

export function loadRecordingHistory(connection: ConnectionSettings) {
  return invoke<HistoryOverview>('bilirec_history', { connection });
}

export function getMpvStatus() {
  return invoke<MpvStatus>('mpv_status');
}

export function openLiveRoom(roomId: number) {
  return invoke<void>('open_live_room', { roomId });
}

export function openExternalUrl(url: string) {
  return invoke<void>('open_external_url', { url });
}

export function playRecordingWithMpv(
  connection: ConnectionSettings,
  fileUrl: string,
  title?: string
) {
  return invoke<MpvPlayResult>('play_with_mpv', {
    connection,
    fileUrl,
    title: title || null
  });
}
