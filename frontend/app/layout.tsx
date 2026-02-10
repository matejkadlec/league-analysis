import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarNav } from "@/components/sidebar-nav";
import { HeaderMessages } from "@/components/header-messages";
import { CookieConsentManager } from "@/features/cookie-consent";
import { Toaster } from "sonner";

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

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://leagueanalysis.gg"
).replace(/\/+$/, "");
const SHOULD_ALLOW_INDEXING = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
          <Providers>
            <HeaderMessages />
            <div className="flex min-h-screen">
              <SidebarNav />
              <main id="content" className="flex-1 bg-background">
                {children}
              </main>
            </div>
            <CookieConsentManager />
            <Toaster position="top-right" richColors />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
