import type { ReactNode } from "react";

/**
 * A layout that adds nothing, which is the point: every page under `app/` is a
 * client component and so cannot export `metadata`, leaving each route needing
 * a server `layout.tsx` purely to carry it. The metadata stays per route.
 */
export function PassthroughLayout({ children }: { children: ReactNode }) {
  return children;
}
