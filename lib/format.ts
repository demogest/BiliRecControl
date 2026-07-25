import type { LogEntry } from './types';

export function finiteNumber(value: number | string | null | undefined) {
  const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatBytes(value: number, fractionDigits = 1) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(index === 0 ? 0 : fractionDigits)} ${units[index]}`;
}

export function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '00:00:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function formatRate(value: number | string) {
  const rate = finiteNumber(value);
  return `${rate.toFixed(rate >= 10 ? 1 : 2)} Mbps`;
}

export function parseLog(entry: LogEntry | string): LogEntry {
  if (typeof entry !== 'string') return entry;
  try {
    const parsed = JSON.parse(entry);
    return parsed && typeof parsed === 'object' ? parsed : { '@m': entry };
  } catch {
    return { '@m': entry };
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  return JSON.stringify(value);
}

export function formatLogMessage(log: LogEntry) {
  const template = String(log['@m'] || log['@mt'] || '系统事件');
  return template.replace(/\{@?([^}:]+)(?::[^}]+)?\}/g, (_match, key: string) =>
    displayValue(log[key])
  );
}

export function logLevel(log: LogEntry) {
  const level = String(log['@l'] || 'Information').toLowerCase();
  if (level.includes('fatal') || level.includes('error')) return 'error';
  if (level.includes('warn')) return 'warning';
  if (level.includes('debug') || level.includes('verbose')) return 'debug';
  return 'information';
}

export function formatLogTime(value: unknown) {
  if (!value) return '--:--:--';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

export function shortHost(host: string | null) {
  if (!host) return '未连接';
  return host.length > 25 ? `${host.slice(0, 22)}…` : host;
}
