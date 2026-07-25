export function parseBilibiliRoomId(value: string): number | null {
  const input = value.trim();
  if (!input) return null;

  const toRoomId = (candidate: string) => {
    if (!/^\d+$/.test(candidate)) return null;
    const roomId = Number(candidate);
    return Number.isSafeInteger(roomId) && roomId > 0 ? roomId : null;
  };

  const directRoomId = toRoomId(input);
  if (directRoomId) return directRoomId;

  const urlValue = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(urlValue);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'live.bilibili.com') return null;
    const firstPathSegment = url.pathname.split('/').filter(Boolean)[0] || '';
    return toRoomId(firstPathSegment);
  } catch {
    return null;
  }
}
