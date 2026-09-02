import type { Metadata } from "next";
import "./globals.css";
import { BottomBar } from "@/components/bottom-bar";
import { Shell } from "@/components/shell";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = {
  title: "火塘",
  description: "每个圈子都是一堆火：拼车、二手、组队，从同校同小区开始。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col bg-page text-foreground">
        <TopBar />
        <Shell>{children}</Shell>
        <BottomBar />
      </body>
    </html>
  );
}
