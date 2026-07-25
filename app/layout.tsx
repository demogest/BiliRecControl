import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'REC / CTRL · 录播姬控制中心',
  description: '录播姬本地控制中心与实时监控大屏'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
