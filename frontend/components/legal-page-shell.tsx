"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/features/auth";
import { PublicBackButton } from "@/components/public-back-button";
import { PublicPageFooter } from "@/components/public-page-footer";

interface LegalPageShellProps {
  title: string;
  children: React.ReactNode;
  isAuthenticatedHint?: boolean;
}

export function LegalPageShell({
  title,
  children,
  isAuthenticatedHint = false,
}: LegalPageShellProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const isSignedIn = isAuthenticated || (isLoading && isAuthenticatedHint);
  const contentSpacingClass = isSignedIn ? "py-8" : "pb-8 pt-0";

  const content = (
    <div className={`container mx-auto max-w-4xl px-4 ${contentSpacingClass}`}>
      <Card id="header-card" className="py-2 text-white">
        <div className="flex flex-col">
          <div className="flex items-start justify-between px-8 pb-2 pt-4">
            <h1 className="text-3xl font-[family-name:var(--font-league)]">
              {title}
            </h1>
          </div>
        </div>
        <CardContent className="max-w-none space-y-4 px-8 pb-4 pt-0">
          {children}
        </CardContent>
      </Card>
    </div>
  );

  if (isSignedIn) {
    return content;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex-1 pt-16">
        <PublicBackButton href="/sign-in" label="Back to Sign In page" />
        {content}
      </div>
      <PublicPageFooter />
    </div>
  );
}
