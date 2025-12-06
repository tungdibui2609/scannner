import type { Metadata, Viewport } from "next";
import "./globals.css";
import UIProvider from "@/components/UIProvider";

export const metadata: Metadata = {
  title: "Scanner - AnyWarehouse",
  description: "Ứng dụng quét mã kho",
  manifest: "/manifest-scanner.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'dark' : prefersDark;
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
  } catch {}
})();`,
          }}
        />
      </head>
      <body className="antialiased font-sans">
        <UIProvider>
          {children}
        </UIProvider>
      </body>
    </html>
  );
}
