import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/components/worker/worker.css";
import { DataProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "מחסן · אפליקציית עובד",
  description: "קליטת סחורה, מסירה ללקוח ודיווח תקלות",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="light" className="h-full antialiased">
      <body className="min-h-full">
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
