import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deding UAT Lab｜上線前共同驗收工作台",
  description: "Deding 官網報名系統的六人 UAT 測試、回饋與改善提案工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
