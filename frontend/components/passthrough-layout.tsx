import type { ReactNode } from "react";

/**
 * A layout that adds nothing, which is the point.
 *
 * Every page under `app/` is a client component, and a client component cannot
 * export `metadata` -- so each route needs a server-side `layout.tsx` purely to
 * carry its title and description. Eight of them had written out the same
 * identity function to do it. The metadata still lives per route, because
 * that is the part Next.js reads and the part that genuinely differs.
 */
export function PassthroughLayout({ children }: { children: ReactNode }) {
  return children;
}
