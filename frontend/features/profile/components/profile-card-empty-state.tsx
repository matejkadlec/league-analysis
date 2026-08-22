import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What a profile card shows before there are enough matches to say anything.
 *
 * All three cards reach this state for the same reason and said so in the same
 * shape; only the icon, the heading and the tail of the sentence differ. The
 * wording is passed in whole rather than assembled from a template because
 * four unit tests and `e2e/player-context.spec.ts` match these strings exactly.
 *
 * `id` is not optional. The section is on the page either way -- same heading,
 * same position -- and `SectionQuickNavigation` registers a section by finding
 * its anchor in the DOM. An empty state that drops the id makes a visible
 * section vanish from the page navigation, which is the common case on this
 * data: nearly every tracked player has too few ranked games for these three
 * cards. Requiring it means a new caller cannot forget.
 */
export function ProfileCardEmptyState({
  icon: Icon,
  id,
  title,
  message,
}: {
  icon: LucideIcon;
  id: string;
  title: string;
  message: string;
}) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
