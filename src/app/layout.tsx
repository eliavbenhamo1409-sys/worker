import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/components/worker/worker.css";
import { DataProvider } from "@/lib/store";
import { ThemeProvider, THEME_BOOT_SCRIPT } from "@/lib/theme";

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
    <html lang="he" dir="rtl" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; see src/lib/theme.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <DataProvider>{children}</DataProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
