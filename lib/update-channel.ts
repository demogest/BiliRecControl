export type UpdateChannel = 'stable' | 'preview';

export const UPDATE_CHANNEL_STORAGE_KEY = 'bilirec-control.update-channel.v1';

export function parseUpdateChannel(value: unknown): UpdateChannel {
  return value === 'preview' ? 'preview' : 'stable';
}

export function readStoredUpdateChannel(): UpdateChannel {
  if (typeof window === 'undefined') return 'stable';
  return parseUpdateChannel(window.localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY));
}

export function storeUpdateChannel(channel: UpdateChannel) {
  window.localStorage.setItem(UPDATE_CHANNEL_STORAGE_KEY, channel);
}

export function updateChannelLabel(channel: UpdateChannel) {
  return channel === 'preview' ? '测试版' : '稳定版';
}
