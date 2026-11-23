import { Children, isValidElement, type ReactNode } from "react";

import { cn } from "@/lib/core/utils";

/**
 * The one layout rule every card page follows (LGA-152). A page is a single
 * column of sections, each one as wide as its content needs: `Section` for a
 * card on its own, `SectionRow` for cards that are read side by side.
 */
export function PageSections({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-layout="page-sections"
      className={cn("flex flex-col gap-6", className)}
    >
      {children}
    </div>
  );
}

export type SectionWidth = "full" | "half";

/**
 * One card with nothing beside it. `half` is for sparse cards such as a form
 * with one action: stretched across the page it reads empty. It lines up with
 * the first column of a `SectionRow`, and the rest of the line stays open.
 */
export function Section({
  children,
  width = "full",
  id,
  className,
}: {
  children: ReactNode;
  width?: SectionWidth;
  id?: string;
  className?: string;
}) {
  return (
    <div
      data-layout="section"
      data-width={width}
      id={id}
      className={cn(
        "min-w-0",
        width === "half" && "xl:w-[calc(50%-0.75rem)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Cards read side by side: two to a line from `xl` (narrower, the sidebar
 * leaves too little), stretched to that line, so only balanced cards belong
 * here. `e2e/page-layout.spec.ts` measures the balance on every page.
 */
export function SectionRow({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      data-layout="section-row"
      id={id}
      className={cn("grid grid-cols-1 gap-6 xl:grid-cols-2", className)}
    >
      {Children.toArray(children).map((child, index) => (
        <div
          key={isValidElement(child) && child.key !== null ? child.key : index}
          data-layout="section-slot"
          className="flex min-w-0 flex-col *:flex-1"
        >
          {child}
        </div>
      ))}
    </div>
  );
}
