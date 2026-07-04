import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "소방관 진출입 관제",
  description: "BLE 소방관 진출입 감지 시스템 실시간 관제 대시보드",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// 첫 페인트 전에 저장된 테마 적용 (깜빡임 방지). 기본은 다크(관제).
const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
