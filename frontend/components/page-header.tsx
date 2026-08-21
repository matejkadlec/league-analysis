import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/core/utils";

/**
 * The branded header card every primary page opens with.
 *
 * `titleSub` renders directly under the heading inside the title row (the
 * jobs page's refresh countdown); `children` render below the whole row.
 */
export function PageHeader({
  title,
  titleSub,
  children,
  className,
}: {
  title: string;
  titleSub?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card id="header-card" className={cn("p-6 text-white", className)}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {titleSub}
        </div>
      </div>
      {children}
    </Card>
  );
}
