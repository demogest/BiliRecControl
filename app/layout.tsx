import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'REC / CTRL · 录播姬控制中心',
  description: '简洁、可靠的录播姬桌面控制工具'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
