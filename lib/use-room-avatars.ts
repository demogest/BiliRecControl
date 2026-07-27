'use client';

import { useEffect, useState } from 'react';
import { loadRoomAvatars } from './api';

const RETRY_INTERVAL_MS = 15 * 60 * 1000;
const REQUEST_BATCH_SIZE = 4;

export function useRoomAvatars(roomIds: number[], enabled = true) {
  const [avatarByRoom, setAvatarByRoom] = useState<Record<number, string | null>>({});
  const roomKey = [...new Set(roomIds.filter((roomId) => roomId > 0))]
    .sort((left, right) => left - right)
    .join(',');

  useEffect(() => {
    if (!enabled || !roomKey) return;
    let active = true;
    let retryTimer: number | undefined;
    const requestedRoomIds = roomKey.split(',').map(Number);

    const loadAll = async () => {
      for (let index = 0; index < requestedRoomIds.length; index += REQUEST_BATCH_SIZE) {
        if (!active) return;
        try {
          const avatars = await loadRoomAvatars(
            requestedRoomIds.slice(index, index + REQUEST_BATCH_SIZE)
          );
          if (!active) return;
          setAvatarByRoom((current) => {
            const next = { ...current };
            for (const avatar of avatars) {
              next[avatar.roomId] = avatar.dataUrl;
            }
            return next;
          });
        } catch {
          // 单批 IPC 失败不阻断其余房间，并由低频定时器再次尝试。
        }
      }
      if (active) {
        retryTimer = window.setTimeout(() => void loadAll(), RETRY_INTERVAL_MS);
      }
    };

    void loadAll();

    return () => {
      active = false;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [enabled, roomKey]);

  return avatarByRoom;
}
