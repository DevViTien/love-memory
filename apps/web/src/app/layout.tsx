import { APP_CONFIG } from "@love-memory/shared";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";
import { getWebEnvironment } from "@/config/environment";

import "./globals.css";

const { appUrl } = getWebEnvironment();

export const metadata: Metadata = {
  description: APP_CONFIG.description,
  ...(appUrl ? { metadataBase: appUrl } : {}),
  title: {
    default: APP_CONFIG.name,
    template: "%s · " + APP_CONFIG.name,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fffaf8",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
