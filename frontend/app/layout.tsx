import type { Metadata } from "next";
import { Suspense } from "react";
import { Montserrat } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ThemeProvider } from "next-themes";
import { SidebarNav } from "@/components/sidebar-nav";
import { HeaderMessages } from "@/components/header-messages";
import { CookieConsentManager } from "@/features/cookie-consent";
import { ToastHost } from "@/components/toast-host";
import { resolveDDragonVersion } from "@/lib/core/data-dragon-version";
import { SHOULD_ALLOW_INDEXING, SITE_URL } from "@/lib/core/site-url";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-sans",
});

const leagueFont = localFont({
  src: "./fonts/League.otf",
  variable: "--font-league",
  display: "swap",
});

const robotsMetadata: Metadata["robots"] = SHOULD_ALLOW_INDEXING
  ? {
      index: true,
      follow: true,
    }
  : {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
        "max-snippet": -1,
        "max-image-preview": "none",
        "max-video-preview": -1,
      },
    };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "League Analysis",
  description:
    "Analyze League of Legends players for smurf behavior using match history and performance metrics",
  robots: robotsMetadata,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ddragonVersion = await resolveDDragonVersion();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${montserrat.variable} ${leagueFont.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers ddragonVersion={ddragonVersion}>
            <HeaderMessages />
            <div className="flex min-h-screen">
              <Suspense fallback={null}>
                <SidebarNav />
              </Suspense>
              {/* `min-w-0` because a flex item defaults to `min-width: auto`
                  and so refuses to shrink below its content. Without it, one
                  wide child stretches the whole document sideways and every
                  `overflow-x-auto` beneath this element is inert. */}
              <main id="content" className="min-w-0 flex-1 bg-background">
                {children}
              </main>
            </div>
            <CookieConsentManager />
            <ToastHost />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
