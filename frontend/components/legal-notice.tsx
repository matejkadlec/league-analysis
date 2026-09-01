import type { ReactNode } from "react";

import Link from "next/link";
import { Fragment } from "react";

import { LEGAL_PAGES } from "@/lib/core/legal-pages";
import { cn } from "@/lib/core/utils";

/**
 * Exported because `CookieSettingsTrigger` is a button rather than a `Link`
 * and has to be handed the same styling.
 */
export const LEGAL_LINK_CLASS =
  "underline transition-colors duration-300 hover:text-[#cfa93a]";

export function LegalNotice({
  className,
  children,
}: {
  className?: string;
  /** Appended after the legal links, behind the same separator. */
  children?: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-center text-xs leading-relaxed text-white/70",
        className,
      )}
    >
      © 2026 All rights reserved.
      <br />
      {LEGAL_PAGES.map((page, index) => (
        <Fragment key={page.href}>
          {index > 0 && " | "}
          <Link href={page.href} className={LEGAL_LINK_CLASS}>
            {page.label}
          </Link>
        </Fragment>
      ))}
      {children ? (
        <>
          {" | "}
          {children}
        </>
      ) : null}
    </p>
  );
}
