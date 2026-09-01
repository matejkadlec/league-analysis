import type { ReactNode } from "react";

/**
 * Pages under `app/` are client components and cannot export `metadata`, so a
 * route needs a server `layout.tsx` purely to carry it.
 */
export function PassthroughLayout({ children }: { children: ReactNode }) {
  return children;
}
